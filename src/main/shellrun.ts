import { spawn } from 'node:child_process'
import path from 'node:path'

export interface ShellRun {
  pid?: number
  /** Код выхода — только с wait */
  code?: number
  /** Права администратора не дали (UAC «Нет») */
  cancelled?: boolean
  error?: string
}

/** Строка для PowerShell в одинарных кавычках: там ничего не подставляется, кавычка удваивается */
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`

/** Аргумент для командной строки Windows: с пробелами или пустой — в кавычках */
export const quoteArg = (a: string) => (a === '' || /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)

/**
 * Запуск через ShellExecute (.NET Process.Start из PowerShell): Windows сама спросит права администратора, если
 * программа их требует — манифестом или флагом «Запускать от имени администратора» (его ставят установщики сборок).
 * wait — дождаться, пока программа закроется, и вернуть её код выхода.
 * Не Start-Process: он читает [ ] в пути как шаблон и не находит «[Сборка] Игра\Setup.exe»
 */
export function shellRun(file: string, opts: { args?: string; cwd?: string; wait?: boolean; onStart?: (pid: number) => void } = {}): Promise<ShellRun> {
  const ps = [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    '$si = New-Object System.Diagnostics.ProcessStartInfo',
    `$si.FileName = ${psQuote(file)}`,
    `$si.WorkingDirectory = ${psQuote(opts.cwd ?? path.dirname(file))}`,
    opts.args ? `$si.Arguments = ${psQuote(opts.args)}` : '',
    '$si.UseShellExecute = $true',
    'try { $p = [System.Diagnostics.Process]::Start($si) } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; [Console]::Out.WriteLine("fail " + $e.NativeErrorCode + " " + $e.Message); exit }',
    "if (-not $p) { [Console]::Out.WriteLine('fail 0 no process'); exit }",
    "[Console]::Out.WriteLine('pid ' + $p.Id)",
    opts.wait ? "$p.WaitForExit(); [Console]::Out.WriteLine('exit ' + $p.ExitCode)" : ''
  ]
    .filter(Boolean)
    .join('; ')
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    let res: ShellRun = { error: 'no result' }
    p.stdout.on('data', (d) => {
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        let m: RegExpMatchArray | null
        if ((m = line.match(/^pid (\d+)/))) {
          res = { pid: Number(m[1]) }
          opts.onStart?.(Number(m[1]))
        } else if ((m = line.match(/^exit (-?\d+)/))) res = { ...res, code: Number(m[1]) }
        else if ((m = line.match(/^fail (\d*)\s*(.*)$/))) res = m[1] === '1223' || /cancel|отмен/i.test(m[2]) ? { cancelled: true } : { error: m[2] }
      }
    })
    p.on('error', (e) => resolve({ error: e.message }))
    p.on('close', () => resolve(res))
  })
}
