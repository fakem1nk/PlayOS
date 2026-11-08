import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { UpdateSplash } from '@shared/types'
import { api } from '../lib/api'
import { useInputLayer } from '../lib/input'
import { play } from '../lib/sound'
import { INSTALL, INSTALLED, INSTALLED_AT } from '../lib/tivi-faces'
import { endFinished, useFinished } from '../lib/update'
import { TiviArt } from './Tivi'
import { t } from '@shared/i18n'

/**
 * Экран установки обновления. PlayOS закрывается, установщик работает молча, и без этого экрана всё выглядело бы
 * как внезапное выключение. Тиви по кругу набирает обновление в уши и полоску во рту, втягивает его и перезагружается
 * (сценка INSTALL в tivi-faces.ts). Когда окно закроется, заставка-помощник (main/splash.ts) держит снимок этого
 * экрана и крутит ту же сценку картинками, пока не откроется новая версия. Двигается только Тиви на сплошном фоне:
 * всё остальное на снимке замрёт, и подмены не видно.
 */

/** Сценка по кругу; кадр считается от общих часов — заставка продолжит с того же места */
const LOOP_MS = INSTALL.reduce((sum, frame) => sum + frame.ms, 0)
/** Кусок вокруг Тиви в координатах рисунка — с запасом на прыжок, уши и значки вокруг корпуса */
const AREA = { x: 0, y: -12, width: 256, height: 252 }

/** Кадр сценки в момент t и сколько ему ещё держаться */
function at(t: number): [number, number] {
  let pos = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS
  for (let i = 0; i < INSTALL.length; i++) {
    if (pos < INSTALL[i].ms) return [i, INSTALL[i].ms - pos]
    pos -= INSTALL[i].ms
  }
  return [0, INSTALL[0].ms]
}

export function UpdateInstall({ version, onFail }: { version?: string; onFail: () => void }) {
  const [t0] = useState(() => Date.now())
  const [frame, setFrame] = useState(0)
  const art = useRef<HTMLDivElement>(null)
  const fail = useRef(onFail)
  fail.current = onFail

  // Пока идёт установка, интерфейс под экраном не управляется
  useInputLayer(() => {}, 100)

  useEffect(() => {
    let timer = 0
    const tick = () => {
      const [i, left] = at(Date.now() - t0)
      setFrame(i)
      timer = window.setTimeout(tick, left)
    }
    tick()
    return () => clearTimeout(timer)
  }, [t0])

  useEffect(() => {
    let alive = true
    // Картинки для заставки готовятся, пока экран проявляется; закрываемся на установку не раньше чем через секунду
    const go = window.setTimeout(async () => {
      const [splash] = await Promise.all([
        splashOf(art.current?.querySelector('svg'), t0).catch(() => undefined),
        new Promise((r) => setTimeout(r, 550))
      ])
      if (!alive) return
      if (!(await api.installUpdate(splash)) && alive) fail.current()
    }, 450)
    // Установщик так и не закрыл PlayOS — что-то пошло не так, возвращаем интерфейс
    const stuck = window.setTimeout(() => fail.current(), 30_000)
    return () => {
      alive = false
      clearTimeout(go)
      clearTimeout(stuck)
    }
  }, [t0])

  const { face, fx, pose, ears } = INSTALL[frame]
  return (
    <motion.div className="upd-install" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
      <div className="upd-install-tivi" ref={art}>
        <TiviArt face={face} fx={fx} pose={pose} ears={ears} />
      </div>
      <div className="upd-install-title">{version ? t('Устанавливаем PlayOS {v}', { v: version }) : t('Устанавливаем обновление')}</div>
      <div className="upd-install-status">{t('PlayOS запустится сам. Не выключайте компьютер')}</div>
    </motion.div>
  )
}

/**
 * Первый запуск после обновления: тот же экран, что держала заставка установки, — окно появляется под ней, и подмены
 * не видно. Тиви доделывает круг, радуется, гаснет как кинескоп; экран растворяется, и начинается интро (App его ждёт)
 */
export function AfterUpdate() {
  const version = useFinished()
  return <AnimatePresence>{version && <UpdateDone key="done" version={version} />}</AnimatePresence>
}

function UpdateDone({ version }: { version: string }) {
  const [frame, setFrame] = useState(0)
  // Звуки включены — Тиви улыбается под аккорд; пока настройки не загрузились, лучше промолчать
  const [sounds, setSounds] = useState(false)
  useInputLayer(() => {}, 100)
  useEffect(() => {
    void api.getState().then((s) => setSounds(s.settings.sounds), () => {})
  }, [])
  const done = frame >= INSTALLED_AT
  useEffect(() => {
    if (done && sounds) play('installed')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  useEffect(() => {
    // Нарисовались (и шрифт загружен) — главный процесс показывает окно и убирает заставку
    let alive = true
    void document.fonts.ready.then(() => setTimeout(() => alive && api.updateShown(), 60))
    let timer = 0
    const next = (i: number) => {
      if (i >= INSTALLED.length) return endFinished()
      setFrame(i)
      timer = window.setTimeout(() => next(i + 1), INSTALLED[i].ms)
    }
    next(0)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  const { face, fx, pose, ears } = INSTALLED[frame]
  return (
    <motion.div className="upd-install is-done" exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
      <div className="upd-install-tivi">
        <TiviArt face={face} fx={fx} pose={pose} ears={ears} />
      </div>
      {/* Надпись перетекает: старая уходит вверх и гаснет, новая проявляется снизу */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={done ? 'done' : 'installing'}
          className="upd-install-text"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
        >
          <div className="upd-install-title">{done ? t('PlayOS {v} установлен', { v: version }) : t('Устанавливаем PlayOS {v}', { v: version })}</div>
          <div className="upd-install-status">{done ? t('Всё готово') : t('PlayOS запустится сам. Не выключайте компьютер')}</div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

/**
 * Все кадры сценки картинками в пикселях устройства — кусок вокруг Тиви вместе со сплошным фоном экрана,
 * одинаковые кадры один раз; steps — порядок и длительность. Рисуются тем же TiviArt в отдельном корне
 */
async function splashOf(svg: SVGSVGElement | null | undefined, t0: number): Promise<UpdateSplash | undefined> {
  const m = svg?.getScreenCTM()
  if (!svg || !m) return
  const dpr = window.devicePixelRatio || 1
  // Chrome рисует корень SVG от целого пикселя устройства, а getScreenCTM этого не учитывает
  const box = svg.getBoundingClientRect()
  const e = m.e + Math.round(box.left * dpr) / dpr - box.left
  const f = m.f + Math.round(box.top * dpr) / dpr - box.top
  // Кусок — по целым пикселям устройства, а рисунок в нём стоит ровно там же, где на экране
  const x = Math.floor((e + m.a * AREA.x) * dpr)
  const y = Math.floor((f + m.d * AREA.y) * dpr)
  const w = Math.ceil((e + m.a * (AREA.x + AREA.width)) * dpr) - x
  const h = Math.ceil((f + m.d * (AREA.y + AREA.height)) * dpr) - y
  const view = [(x / dpr - e) / m.a, (y / dpr - f) / m.d, w / dpr / m.a, h / dpr / m.d].join(' ')
  const bg = getComputedStyle(svg.closest('.upd-install') ?? document.body).backgroundColor
  const host = document.createElement('div')
  const root = createRoot(host)
  const known = new Map<string, number>()
  const frames: Uint8Array[] = []
  const steps: [number, number][] = []
  try {
    for (const { face, fx, pose, ears, ms } of INSTALL) {
      flushSync(() => root.render(<TiviArt face={face} fx={fx} pose={pose} ears={ears} />))
      const markup = new XMLSerializer().serializeToString(host.firstElementChild!)
      let k = known.get(markup)
      if (k === undefined) {
        known.set(markup, (k = frames.length))
        const sized = markup.replace('viewBox="8 0 240 236"', `viewBox="${view}" width="${w}" height="${h}" preserveAspectRatio="none"`)
        frames.push(await raster(sized, w, h, bg))
      }
      const last = steps.at(-1)
      if (last?.[0] === k) last[1] += ms
      else steps.push([k, ms])
    }
  } finally {
    root.unmount()
  }
  return { frames, steps, rect: { x: x / dpr, y: y / dpr, width: w / dpr, height: h / dpr }, t0 }
}

/** SVG поверх фона экрана → PNG */
async function raster(svg: string, w: number, h: number, bg: string) {
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d')!
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)
  g.drawImage(img, 0, 0, w, h)
  const png = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await png.arrayBuffer())
}
