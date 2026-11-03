import fs from 'node:fs'
import path from 'node:path'

/** Данные магазина на диске: прочитать что есть, записать через временный файл */

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** false — не записалось. Кэшу Steam это не страшно, а список источников и «Не та игра» вызывающий проверяет сам */
export function writeJson(file: string, data: unknown): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8')
    fs.renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}
