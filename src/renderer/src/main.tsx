import '@fontsource-variable/onest'
import './styles.css'
import './styles-extra.css'
import './styles-overlay.css'
import './styles-cc.css'
import './styles-v6.css'
import './styles-tint.css'
import './styles-intro.css'
import './styles-outro.css'
import './styles-update.css'
import './styles-glass.css'
import './styles-light.css'
import { createRoot } from 'react-dom/client'
import { startInput } from './lib/input'
import { startLiquidGlass } from './lib/liquid'
import { setTheme } from './lib/theme'
import { getLang, missingKeys } from '@shared/i18n'
import type { ThemeMode } from '@shared/types'

// Одно и то же приложение работает в двух окнах: основной лаунчер и прозрачный оверлей поверх игры
const isOverlay = location.hash === '#overlay'
if (isOverlay) document.documentElement.classList.add('overlay-mode')

document.documentElement.lang = getLang()
// Тема известна до первой отрисовки: из PlayOS (preload) или ?theme= в браузерном превью
setTheme((new URLSearchParams(location.search).get('theme') ?? (window as { pcsTheme?: string }).pcsTheme) as ThemeMode | undefined)
// В режиме разработки — список строк без перевода: window.__i18nMissing()
if (import.meta.env.DEV) Object.assign(window, { __i18nMissing: missingKeys })

startInput()
// Окна грузят только свой код: оверлею не нужны библиотека, настройки и интро
const root = createRoot(document.getElementById('root')!)
if (isOverlay) void import('./OverlayApp').then(({ OverlayApp }) => root.render(<OverlayApp />))
else void import('./App').then(({ App }) => root.render(<App />))
startLiquidGlass()
