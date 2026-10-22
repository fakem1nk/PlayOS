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
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startInput } from './lib/input'
import { OverlayApp } from './OverlayApp'
import { getLang, missingKeys } from '@shared/i18n'

// Одно и то же приложение работает в двух окнах: основной лаунчер и прозрачный оверлей поверх игры
const isOverlay = location.hash === '#overlay'
if (isOverlay) document.documentElement.classList.add('overlay-mode')

document.documentElement.lang = getLang()
// В режиме разработки — список строк без перевода: window.__i18nMissing()
if (import.meta.env.DEV) Object.assign(window, { __i18nMissing: missingKeys })

startInput()
createRoot(document.getElementById('root')!).render(isOverlay ? <OverlayApp /> : <App />)
