/**
 * Минимальный разбор YAML для манифеста Ludusavi: его пишет машина (serde_yaml), поэтому хватает подмножества —
 * блочные словари и списки с отступами, пустые {} и [], строки в двойных/одинарных кавычках и без них.
 * Многострочных строк, якорей и потоковых коллекций с содержимым в манифесте нет.
 */

type Value = string | number | boolean | null | Value[] | { [k: string]: Value }

interface Line {
  indent: number
  text: string
}

function scalar(raw: string): Value {
  const s = raw.trim()
  if (s === '{}') return {}
  if (s === '[]') return []
  if (s.startsWith('"')) return JSON.parse(s.replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1'))
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  if (s === 'true' || s === 'false') return s === 'true'
  if (s === '~' || s === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

/** Ключ и остаток строки: «"a: b": c» → ['a: b', 'c'] */
function splitKey(text: string): [string, string] | null {
  if (text.startsWith('"')) {
    let i = 1
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    if (text[i + 1] !== ':') return null
    return [JSON.parse(text.slice(0, i + 1)), text.slice(i + 2)]
  }
  if (text.startsWith("'")) {
    let i = 1
    while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) i += text[i] === "'" ? 2 : 1
    if (text[i + 1] !== ':') return null
    return [text.slice(1, i).replace(/''/g, "'"), text.slice(i + 2)]
  }
  const m = /^(.*?):(?:\s|$)/.exec(text)
  return m ? [m[1], text.slice(m[0].length)] : null
}

export function parseYaml(src: string): Value {
  const lines: Line[] = []
  for (const raw of src.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#') || raw === '---') continue
    const indent = raw.length - raw.trimStart().length
    lines.push({ indent, text: raw.slice(indent) })
  }
  let i = 0

  const block = (indent: number): Value => {
    if (i >= lines.length || lines[i].indent < indent) return null
    return lines[i].text.startsWith('- ') || lines[i].text === '-' ? list(lines[i].indent) : map(lines[i].indent)
  }

  const map = (indent: number): Value => {
    const out: { [k: string]: Value } = {}
    while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith('- ')) {
      const kv = splitKey(lines[i].text)
      if (!kv) throw new Error(`YAML: строка ${i + 1}`)
      i++
      const rest = kv[1].trim()
      out[kv[0]] = rest ? scalar(rest) : block(indent + 1)
    }
    return out
  }

  const list = (indent: number): Value => {
    const out: Value[] = []
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
      const body = lines[i].text.slice(2)
      if (!body.trim()) {
        i++
        out.push(block(indent + 1))
      } else if (splitKey(body)) {
        // «- key: value» — словарь, следующие ключи идут с отступом +2
        lines[i] = { indent: indent + 2, text: body }
        out.push(map(indent + 2))
      } else {
        i++
        out.push(scalar(body))
      }
    }
    return out
  }

  return block(0)
}
