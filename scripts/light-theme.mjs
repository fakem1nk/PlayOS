// Светлая тема без ручного дублирования стилей: PostCSS-плагин сборки. Для каждого правила с нейтральными
// цветами добавляет рядом его вариант под html[data-theme='light'], где светлое и тёмное поменяны местами
// (белый текст → почти чёрный, тёмный фон → светлый), а насыщенные акценты остаются как есть.
// Тени остаются тенями — только мягче. Правила с [data-theme в селекторе (ручная доводка) не трогаются.
// Интро и аутро — экран ЭЛТ, он тёмный в любой теме.

const LIGHT = "[data-theme='light']"
const SKIP_FILES = /styles-(intro|outro)\.css$/
const COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^()]*\)/gi
const SHADOW_PROPS = /^(box-shadow|text-shadow|filter|-webkit-filter)$/
// Цветовые свойства копируются в светлую тему, даже если цвет не поменялся: иначе светлый вариант
// базового правила (.switch) перевесил бы исходное состояние (.switch.is-on) — у копий одинаковая добавка веса
const COLOR_PROPS = /^(--|background|color$|border(-(top|right|bottom|left))?(-color)?$|outline(-color)?$|box-shadow|text-shadow|fill$|stroke$|caret-color|-webkit-text-fill-color|filter$|-webkit-filter$|opacity$)/

function parse(token) {
  if (token[0] === '#') {
    let h = token.slice(1)
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const n = (i) => parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
  }
  const parts = token
    .slice(token.indexOf('(') + 1, -1)
    .split(/[\s,/]+/)
    .filter(Boolean)
  if (parts.length < 3 || parts.some((p) => /var|calc|none/.test(p))) return null
  const num = (p, max) => (p.endsWith('%') ? (parseFloat(p) / 100) * max : parseFloat(p))
  return { r: num(parts[0], 255), g: num(parts[1], 255), b: num(parts[2], 255), a: parts[3] === undefined ? 1 : num(parts[3], 1) }
}

function toHsl({ r, g, b }) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s, l }
}

function fromHsl({ h, s, l }) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
  return { r: f(0), g: f(8), b: f(4) }
}

const fmt = ({ r, g, b }, a) => (a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`)

/** Нейтральный, очень тёмный или почти белый цвет — меняет светлоту на противоположную; яркий акцент остаётся */
function invert(c) {
  const hsl = toHsl(c)
  if (hsl.s > 0.3 && hsl.l >= 0.25 && hsl.l <= 0.88) return null
  const l = Math.min(0.97, Math.max(0.07, 1 - hsl.l))
  return fmt(fromHsl({ h: hsl.h, s: hsl.l < 0.25 ? hsl.s * 0.5 : hsl.s, l }), c.a)
}

/** Маски работают только по прозрачности, а переписанный -webkit-mask сбросил бы mask-composite */
const SKIP_PROPS = /^(-webkit-)?mask/

function swap(prop, value) {
  if (SKIP_PROPS.test(prop)) return value
  if (prop === 'color-scheme') return value.replace(/\bdark\b/, 'light')
  const shadow = SHADOW_PROPS.test(prop)
  return value.replace(COLOR, (token) => {
    const c = parse(token)
    if (!c) return token
    if (shadow) {
      // Тёмная тень на светлом — заметно легче, тень под текстом почти не нужна; светлые блики оставляем
      if (toHsl(c).l >= 0.5) return token
      return fmt(c, c.a * (prop === 'text-shadow' ? 0.12 : 0.45))
    }
    return invert(c) ?? token
  })
}

function lightSelector(sel) {
  const s = sel.trim()
  if (s === ':root') return `html${LIGHT}`
  if (/^html\b/.test(s)) return s.replace(/^html/, `html${LIGHT}`)
  return `html${LIGHT} ${s}`
}

export default function lightTheme() {
  return {
    postcssPlugin: 'playos-light-theme',
    OnceExit(root) {
      if (SKIP_FILES.test(root.source?.input.file ?? '')) return
      const pairs = []
      root.walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return
        if (rule.selector.includes('[data-theme')) return
        const decls = []
        let changed = false
        rule.each((node) => {
          if (node.type !== 'decl') return
          const value = swap(node.prop, node.value)
          if (value !== node.value) {
            changed = true
            decls.push(node.clone({ value }))
          } else if (COLOR_PROPS.test(node.prop) && !SKIP_PROPS.test(node.prop)) decls.push(node.clone())
        })
        if (!changed && !decls.some((d) => !d.prop.startsWith('--'))) return
        const light = rule.clone({ selectors: rule.selectors.map(lightSelector) })
        light.removeAll()
        light.append(decls)
        pairs.push([rule, light])
      })
      for (const [rule, light] of pairs) rule.after(light)
    }
  }
}
lightTheme.postcss = true
