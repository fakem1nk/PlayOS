import fs from 'node:fs'
import path from 'node:path'

/** Кэш магазина на диске: прочитать что есть, записать через временный файл */

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

export function writeJson(file: string, data: unknown) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8')
    fs.renameSync(tmp, file)
  } catch {
    /* кэш не критичен */
  }
}
