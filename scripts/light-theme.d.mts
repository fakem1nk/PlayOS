import type { Plugin } from 'postcss'

/** PostCSS-плагин: добавляет к стилям светлую тему под html[data-theme='light'] */
declare function lightTheme(): Plugin
declare namespace lightTheme {
  const postcss: true
}
export default lightTheme
