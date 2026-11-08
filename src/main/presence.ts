import fs from 'node:fs'
import path from 'node:path'
import type { Game } from '@shared/types'

/**
 * Игры, удалённые мимо PlayOS: папку или образ стёрли проводником, Steam-игру удалили в клиенте Steam.
 * Такая игра остаётся в библиотеке неустановленной — как после «Удалить с компьютера».
 * Диск, которого сейчас нет (внешний, сетевой, флешка, закрытый BitLocker), не в счёт: его просто не подключили.
 */

/** Ссылки (steam://…) — не файлы на диске */
const URL_LIKE = /^[a-z][a-z0-9+.-]+:\/\//i
/** Вторая проверка через паузу: игра могла как раз обновляться (EXE заменяют новым) */
const CONFIRM_MS = 2000

/** Файла точно нет. Нет доступа, занят, сеть не ответила — неизвестно, значит считаем, что есть */
async function gone(p: string): Promise<boolean> {
  try {
    await fs.promises.stat(p)
    return false
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
}

/** Диск (или сетевая папка) с этим путём сейчас подключён */
async function driveOnline(p: string): Promise<boolean> {
  const root = path.parse(path.resolve(p)).root
  if (!root) return false
  try {
    await fs.promises.stat(root)
    return true
  } catch {
    return false
  }
}

export interface MissingGame {
  game: Game
  /** Путь, которого не стало: игру успели поправить в редакторе — уже не трогаем */
  path: string
}

/** Установленные игры, файлов которых больше нет на подключённом диске. skip — запущенная игра */
export async function missingGames(games: Game[], skip?: string): Promise<MissingGame[]> {
  const check = async (list: MissingGame[]) => {
    const res = await Promise.all(list.map(async (m) => ((await gone(m.path)) && (await driveOnline(m.path)) ? m : null)))
    return res.filter((m): m is MissingGame => !!m)
  }
  // Со своей командой запуска игра может обходиться и без файла из path
  const installed = games
    .filter((g) => g.path && g.id !== skip && !URL_LIKE.test(g.path) && !g.customCommand?.trim())
    .map((game) => ({ game, path: game.path }))
  const first = await check(installed)
  if (!first.length) return []
  await new Promise((r) => setTimeout(r, CONFIRM_MS))
  return check(first)
}
