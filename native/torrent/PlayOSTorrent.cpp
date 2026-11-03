// PlayOSTorrent — торрент-клиент PlayOS на libtorrent. Запускается из main (src/main/downloads/torrent.ts)
// и живёт, пока идут торрент-загрузки.
//
// Команды — строками в stdin, поля через табуляцию:
//   add    <id> <папка> <magnet или путь к .torrent>   — начать или продолжить (есть файл докачки — с него)
//   pause  <id>                                       — пауза, состояние докачки сохраняется
//   remove <id> <0|1>                                 — убрать из сессии; 1 — вместе со скачанными файлами
//   quit                                              — сохранить докачку и выйти
// События — строками JSON в stdout:
//   {"ev":"ready"}
//   {"ev":"status","id":…,"state":"metadata|checking|downloading|finished","done":…,"total":…,"rate":…,"peers":…,"seeds":…,"name":…}
//   {"ev":"finished","id":…,"path":…}    — скачано целиком; раздача сразу останавливается
//   {"ev":"error","id":…,"message":…}
//   {"ev":"removed","id":…}
// stdin закрылся (PlayOS завершился или упал) — сохраняемся и выходим: торрент не качается сиротой.
// Файлы докачки и состояние DHT — в папке из аргумента --state.

#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/alert_types.hpp>
#include <libtorrent/load_torrent.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/read_resume_data.hpp>
#include <libtorrent/session.hpp>
#include <libtorrent/session_params.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/version.hpp>
#include <libtorrent/write_resume_data.hpp>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#endif

namespace fs = std::filesystem;
using namespace std::chrono_literals;

static fs::path stateDir;
static std::mutex outLock;

// ───────────── Вывод ─────────────

static std::string esc(const std::string& s) {
  std::string o;
  o.reserve(s.size() + 8);
  for (unsigned char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20) {
          char b[8];
          std::snprintf(b, sizeof b, "\\u%04x", c);
          o += b;
        } else o += static_cast<char>(c);
    }
  }
  return o;
}

static void emit(const std::string& json) {
  std::lock_guard<std::mutex> g(outLock);
  std::fwrite(json.data(), 1, json.size(), stdout);
  std::fputc('\n', stdout);
  std::fflush(stdout);
}

static void emitError(const std::string& id, const std::string& message) {
  emit("{\"ev\":\"error\",\"id\":\"" + esc(id) + "\",\"message\":\"" + esc(message) + "\"}");
}

// ───────────── Файлы ─────────────

#ifdef _WIN32
// Пути приходят в UTF-8, файловой системе Windows нужны широкие строки
static fs::path u8path(const std::string& s) {
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
  std::wstring w(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
  return fs::path(w);
}
#else
static fs::path u8path(const std::string& s) { return fs::path(s); }
#endif

static fs::path resumeFile(const std::string& id) { return stateDir / u8path(id + ".resume"); }

static bool readFile(const fs::path& p, std::vector<char>& out) {
  std::ifstream f(p, std::ios::binary);
  if (!f) return false;
  out.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
  return !out.empty();
}

static void writeFile(const fs::path& p, const std::vector<char>& data) {
  fs::path tmp = p;
  tmp += L".tmp";
  {
    std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
    f.write(data.data(), static_cast<std::streamsize>(data.size()));
  }
  std::error_code ec;
  fs::rename(tmp, p, ec);
}

// ───────────── Команды ─────────────

static std::mutex queueLock;
static std::deque<std::string> commands;
static std::atomic<bool> inputClosed{false};

static void readInput() {
  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    std::lock_guard<std::mutex> g(queueLock);
    commands.push_back(line);
  }
  inputClosed = true;
}

static std::vector<std::string> split(const std::string& s) {
  std::vector<std::string> out;
  std::string cur;
  std::istringstream in(s);
  while (std::getline(in, cur, '\t')) out.push_back(cur);
  return out;
}

static const char* stateName(lt::torrent_status::state_t s) {
  switch (s) {
    case lt::torrent_status::downloading_metadata: return "metadata";
    case lt::torrent_status::checking_files:
    case lt::torrent_status::checking_resume_data: return "checking";
    case lt::torrent_status::finished:
    case lt::torrent_status::seeding: return "finished";
    default: return "downloading";
  }
}

int main(int argc, char** argv) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  for (int i = 1; i + 1 < argc; i++)
    if (std::string(argv[i]) == "--state") stateDir = u8path(argv[i + 1]);
  if (stateDir.empty()) stateDir = fs::current_path();
  std::error_code mk;
  fs::create_directories(stateDir, mk);

  lt::settings_pack pack;
  pack.set_int(lt::settings_pack::alert_mask, lt::alert_category::error | lt::alert_category::status | lt::alert_category::storage);
  pack.set_str(lt::settings_pack::user_agent, "PlayOS/1.2 libtorrent/" LIBTORRENT_VERSION);
  // Одна загрузка за раз: очередь ведёт PlayOS
  pack.set_int(lt::settings_pack::active_downloads, 1);
  pack.set_int(lt::settings_pack::active_seeds, 0);

  // Состояние DHT с прошлого раза — быстрее находим раздающих
  lt::session_params params(pack);
  {
    std::vector<char> buf;
    if (readFile(stateDir / L"session.dat", buf)) {
      try {
        params = lt::read_session_params(buf, lt::session_handle::save_dht_state);
        params.settings = pack;
      } catch (...) {
        params = lt::session_params(pack);
      }
    }
  }
  lt::session ses(std::move(params));

  std::map<std::string, lt::torrent_handle> byId;
  std::map<lt::torrent_handle, std::string> idOf;
  int pendingResume = 0;
  bool quitting = false;

  auto saveResume = [&](const lt::torrent_handle& h) {
    if (!h.is_valid()) return;
    h.save_resume_data(lt::torrent_handle::save_info_dict | lt::torrent_handle::only_if_modified);
    pendingResume++;
  };

  auto add = [&](const std::string& id, const std::string& save, const std::string& source) {
    auto it = byId.find(id);
    if (it != byId.end() && it->second.is_valid()) {
      it->second.resume();
      return;
    }
    lt::add_torrent_params p;
    std::vector<char> buf;
    lt::error_code ec;
    if (readFile(resumeFile(id), buf)) p = lt::read_resume_data(buf, ec);
    if (buf.empty() || ec) {
      ec.clear();
      try {
        if (source.rfind("magnet:", 0) == 0) p = lt::parse_magnet_uri(source);
        else p = lt::load_torrent_file(source);
      } catch (const std::exception& e) {
        return emitError(id, e.what());
      }
    }
    p.save_path = save;
    p.flags &= ~lt::torrent_flags::paused;
    p.flags &= ~lt::torrent_flags::auto_managed;
    lt::torrent_handle h = ses.add_torrent(std::move(p), ec);
    if (ec) return emitError(id, ec.message());
    byId[id] = h;
    idOf[h] = id;
  };

  auto forget = [&](const lt::torrent_handle& h) {
    auto it = idOf.find(h);
    if (it == idOf.end()) return;
    byId.erase(it->second);
    idOf.erase(it);
  };

  auto handle = [&](const std::string& line) {
    auto f = split(line);
    if (f.empty()) return;
    const std::string& cmd = f[0];
    if (cmd == "add" && f.size() >= 4) add(f[1], f[2], f[3]);
    else if (cmd == "pause" && f.size() >= 2) {
      auto it = byId.find(f[1]);
      if (it == byId.end()) return;
      it->second.pause();
      saveResume(it->second);
    } else if (cmd == "remove" && f.size() >= 2) {
      const std::string id = f[1];
      std::error_code rm;
      fs::remove(resumeFile(id), rm);
      auto it = byId.find(id);
      if (it == byId.end()) return emit("{\"ev\":\"removed\",\"id\":\"" + esc(id) + "\"}");
      lt::torrent_handle h = it->second;
      forget(h);
      ses.remove_torrent(h, f.size() >= 3 && f[2] == "1" ? lt::session_handle::delete_files : lt::remove_flags_t{});
      emit("{\"ev\":\"removed\",\"id\":\"" + esc(id) + "\"}");
    } else if (cmd == "quit") quitting = true;
  };

  std::thread input(readInput);
  input.detach();
  emit("{\"ev\":\"ready\"}");

  auto lastStatus = std::chrono::steady_clock::now();
  auto lastSave = lastStatus;
  for (;;) {
    {
      std::deque<std::string> batch;
      {
        std::lock_guard<std::mutex> g(queueLock);
        batch.swap(commands);
      }
      for (auto& c : batch) handle(c);
    }
    if (inputClosed) quitting = true;
    if (quitting) break;

    auto now = std::chrono::steady_clock::now();
    if (now - lastStatus >= 1s) {
      ses.post_torrent_updates();
      lastStatus = now;
    }
    // Докачку — раз в минуту на случай, если PlayOS завершат без предупреждения
    if (now - lastSave >= 60s) {
      for (auto& [id, h] : byId) saveResume(h);
      lastSave = now;
    }

    ses.wait_for_alert(250ms);
    std::vector<lt::alert*> alerts;
    ses.pop_alerts(&alerts);
    for (lt::alert* a : alerts) {
      if (auto* st = lt::alert_cast<lt::state_update_alert>(a)) {
        for (const lt::torrent_status& s : st->status) {
          auto it = idOf.find(s.handle);
          if (it == idOf.end()) continue;
          std::ostringstream o;
          o << "{\"ev\":\"status\",\"id\":\"" << esc(it->second) << "\",\"state\":\"" << stateName(s.state) << "\",\"done\":" << s.total_wanted_done
            << ",\"total\":" << (s.has_metadata ? s.total_wanted : 0) << ",\"rate\":" << s.download_payload_rate << ",\"peers\":" << s.num_peers
            << ",\"seeds\":" << s.num_seeds << ",\"paused\":" << ((s.flags & lt::torrent_flags::paused) ? "true" : "false") << ",\"name\":\"" << esc(s.name)
            << "\"}";
          emit(o.str());
        }
      } else if (auto* fin = lt::alert_cast<lt::torrent_finished_alert>(a)) {
        auto it = idOf.find(fin->handle);
        if (it == idOf.end()) continue;
        const std::string id = it->second;
        lt::torrent_status s = fin->handle.status(lt::torrent_handle::query_save_path | lt::torrent_handle::query_name);
        // Пути libtorrent — UTF-8: собираем путь к корню раздачи (папке или файлу) строкой, без преобразований
        std::string root = s.save_path;
        if (!root.empty() && root.back() != '\\' && root.back() != '/') root += '\\';
        root += s.name;
        emit("{\"ev\":\"finished\",\"id\":\"" + esc(id) + "\",\"path\":\"" + esc(root) + "\"}");
        // Раздавать после загрузки не будем: торрент — из сессии, файлы остаются
        std::error_code rm;
        fs::remove(resumeFile(id), rm);
        forget(fin->handle);
        ses.remove_torrent(fin->handle);
      } else if (auto* rd = lt::alert_cast<lt::save_resume_data_alert>(a)) {
        pendingResume = pendingResume > 0 ? pendingResume - 1 : 0;
        auto it = idOf.find(rd->handle);
        if (it != idOf.end()) writeFile(resumeFile(it->second), lt::write_resume_data_buf(rd->params));
      } else if (lt::alert_cast<lt::save_resume_data_failed_alert>(a)) {
        pendingResume = pendingResume > 0 ? pendingResume - 1 : 0;
      } else if (auto* md = lt::alert_cast<lt::metadata_received_alert>(a)) {
        // Список файлов узнали — сохраняем сразу: после перезапуска его не придётся искать заново
        saveResume(md->handle);
      } else if (auto* te = lt::alert_cast<lt::torrent_error_alert>(a)) {
        auto it = idOf.find(te->handle);
        if (it != idOf.end()) emitError(it->second, te->error.message() + (te->filename() && *te->filename() ? std::string(": ") + te->filename() : ""));
      } else if (auto* fe = lt::alert_cast<lt::file_error_alert>(a)) {
        auto it = idOf.find(fe->handle);
        if (it != idOf.end()) emitError(it->second, fe->error.message() + ": " + fe->filename());
      }
    }
  }

  // Выход: докачку всех торрентов и состояние DHT — на диск
  for (auto& [id, h] : byId) {
    h.pause();
    saveResume(h);
  }
  auto deadline = std::chrono::steady_clock::now() + 5s;
  while (pendingResume > 0 && std::chrono::steady_clock::now() < deadline) {
    ses.wait_for_alert(200ms);
    std::vector<lt::alert*> alerts;
    ses.pop_alerts(&alerts);
    for (lt::alert* a : alerts) {
      if (auto* rd = lt::alert_cast<lt::save_resume_data_alert>(a)) {
        pendingResume--;
        auto it = idOf.find(rd->handle);
        if (it != idOf.end()) writeFile(resumeFile(it->second), lt::write_resume_data_buf(rd->params));
      } else if (lt::alert_cast<lt::save_resume_data_failed_alert>(a)) pendingResume--;
    }
  }
  writeFile(stateDir / L"session.dat", lt::write_session_params_buf(ses.session_state(lt::session_handle::save_dht_state)));
  return 0;
}
