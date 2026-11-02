// Заставка установки обновления (main/splash.ts). PlayOS закрылся, установщик работает молча — заставка держит
// снимок экрана установки и крутит поверх него сценку Тиви, пока новая версия не покажет окно.
// Запуск: PlayOSHelper.exe splash <папка> <x> <y> <w> <h> <fx> <fy> <fw> <fh> <t0> <pid> <exe>
//   x y w h — окно PlayOS, fx fy fw fh — кусок вокруг Тиви (пиксели экрана); t0 — от него идёт сценка (Unix, мс);
//   pid — старый PlayOS; exe — его exe, чтобы запустить PlayOS, если установщик так его и не открыл.
// В папке: screen.png, frame0..N.png, timeline.txt (строки «кадр мс», по кругу) и wait — пока он есть, заставка ждёт.
// Встав поверх всех окон, пишет ready.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PCStation
{
    static class UpdateSplash
    {
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        public static void Run(string[] a)
        {
            // Координаты приходят в настоящих пикселях экрана — масштаб Windows к ним не применяем
            try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
            catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
            var n = new int[8];
            for (int i = 0; i < n.Length; i++) n[i] = int.Parse(a[i + 2], CultureInfo.InvariantCulture);
            var form = new SplashForm(
                a[1],
                new Rectangle(n[0], n[1], n[2], n[3]),
                new Rectangle(n[4], n[5], n[6], n[7]),
                long.Parse(a[10], CultureInfo.InvariantCulture),
                int.Parse(a[11], CultureInfo.InvariantCulture),
                a[12]);
            Application.Run(form);
        }
    }

    class SplashForm : Form
    {
        /** Установщик так и не открыл новую версию — запускаем PlayOS сами */
        const long GiveUpMs = 180000;
        /** Старый PlayOS так и не закрылся — установка не началась, заставка ему только мешает */
        const long StuckMs = 20000;

        delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);

        static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        readonly string dir, exe;
        readonly Bitmap screen;
        readonly Bitmap[] frames;
        /** Сценка: номер кадра и сколько он держится */
        readonly int[][] steps;
        readonly long total;
        readonly Rectangle spot;
        readonly int oldPid;
        readonly long t0;
        readonly Stopwatch age = Stopwatch.StartNew();
        readonly Timer timer = new Timer();
        int shown = -1;
        long checkedAt;

        public SplashForm(string dir, Rectangle bounds, Rectangle frame, long t0, int oldPid, string exe)
        {
            this.dir = dir;
            this.exe = exe;
            this.t0 = t0;
            this.oldPid = oldPid;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = bounds;
            TopMost = true;
            ShowInTaskbar = false;
            BackColor = Color.Black;
            DoubleBuffered = true;
            KeyPreview = true;
            Text = "PlayOS";
            screen = Picture(Path.Combine(dir, "screen.png"), bounds.Size);
            spot = new Rectangle(frame.X - bounds.X, frame.Y - bounds.Y, frame.Width, frame.Height);
            var list = new List<int[]>();
            int count = 0;
            foreach (string line in File.ReadAllLines(Path.Combine(dir, "timeline.txt")))
            {
                string[] p = line.Split(' ');
                int k, ms;
                if (p.Length < 2 || !int.TryParse(p[0], out k) || !int.TryParse(p[1], out ms) || k < 0 || ms < 1) continue;
                list.Add(new[] { k, ms });
                total += ms;
                count = Math.Max(count, k + 1);
            }
            steps = list.ToArray();
            // Не хватает картинки — на её месте остаётся снимок
            frames = new Bitmap[count];
            for (int i = 0; i < count; i++)
            {
                string file = Path.Combine(dir, "frame" + i + ".png");
                if (File.Exists(file)) frames[i] = Picture(file, spot.Size);
            }
            timer.Interval = 15;
            timer.Tick += Tick;
        }

        /** Картинка нужного размера в быстром формате; файл сразу отпускаем, чтобы папку можно было удалить */
        static Bitmap Picture(string file, Size size)
        {
            using (var src = Image.FromStream(new MemoryStream(File.ReadAllBytes(file))))
            {
                var bmp = new Bitmap(Math.Max(1, size.Width), Math.Max(1, size.Height), PixelFormat.Format32bppPArgb);
                using (var g = Graphics.FromImage(bmp))
                {
                    bool same = src.Width == size.Width && src.Height == size.Height;
                    g.InterpolationMode = same ? InterpolationMode.NearestNeighbor : InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.Half;
                    g.DrawImage(src, new Rectangle(0, 0, size.Width, size.Height));
                }
                return bmp;
            }
        }

        /** Номер кадра по общим часам — тот же, что был бы на экране установки */
        int Frame()
        {
            if (total == 0) return -1;
            long now = (long)(DateTime.UtcNow - Epoch).TotalMilliseconds;
            long pos = (now - t0) % total;
            if (pos < 0) pos += total;
            foreach (int[] s in steps)
            {
                if (pos < s[1]) return frames[s[0]] != null ? s[0] : -1;
                pos -= s[1];
            }
            return -1;
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Activate();
            // Новая версия запустится из установщика, а на переднем плане — заставка: разрешаем PlayOS забрать фокус
            AllowSetForegroundWindow(-1);
            timer.Start();
            try { File.WriteAllText(Path.Combine(dir, "ready"), ""); } catch { }
        }

        // Фон целиком закрывает снимок
        protected override void OnPaintBackground(PaintEventArgs e) { }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.CompositingMode = CompositingMode.SourceCopy;
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            shown = Frame();
            if (shown < 0 || !spot.Contains(e.ClipRectangle)) g.DrawImage(screen, 0, 0, screen.Width, screen.Height);
            if (shown >= 0) g.DrawImage(frames[shown], spot.X, spot.Y, spot.Width, spot.Height);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) Close();
            base.OnKeyDown(e);
        }

        void Tick(object sender, EventArgs e)
        {
            if (Frame() != shown) Invalidate(spot);
            long now = age.ElapsedMilliseconds;
            if (now - checkedAt < 250) return;
            checkedAt = now;
            bool oldAlive = Alive(oldPid);
            if (!File.Exists(Path.Combine(dir, "wait"))) Close();
            else if (oldAlive && now > StuckMs) Close();
            // Новая версия могла открыться и без этой заставки в коде (откат на старую) — смотрим на её окно
            else if (!oldAlive && NewWindow()) Close();
            else if (now > GiveUpMs)
            {
                try { if (File.Exists(exe) && Process.GetProcessesByName(Path.GetFileNameWithoutExtension(exe)).Length == 0) Process.Start(exe); }
                catch { }
                Close();
            }
        }

        static bool Alive(int pid)
        {
            try
            {
                using (var p = Process.GetProcessById(pid)) return !p.HasExited;
            }
            catch { return false; }
        }

        /** Видимое окно процесса PlayOS (не старого) */
        bool NewWindow()
        {
            string name = Path.GetFileNameWithoutExtension(exe);
            IntPtr own = Handle;
            var pids = new HashSet<uint>();
            EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                uint pid;
                RECT r;
                if (h == own || !IsWindowVisible(h) || !GetWindowRect(h, out r) || r.Right - r.Left < 200 || r.Bottom - r.Top < 200) return true;
                GetWindowThreadProcessId(h, out pid);
                if (pid != oldPid) pids.Add(pid);
                return true;
            }, IntPtr.Zero);
            foreach (uint pid in pids)
            {
                try
                {
                    using (var p = Process.GetProcessById((int)pid))
                        if (string.Equals(p.ProcessName, name, StringComparison.OrdinalIgnoreCase)) return true;
                }
                catch { }
            }
            return false;
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            timer.Stop();
            base.OnFormClosed(e);
        }
    }
}
