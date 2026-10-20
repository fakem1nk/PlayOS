import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SystemInfo } from '@shared/types'
import { api } from '../lib/api'
import { gamesCount } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { toast } from '../lib/state'
import { play } from '../lib/sound'
import { Hint } from './Glyph'
import { IconBattery, IconGamepad, IconPlug } from './Icons'
import { LogoMark } from './Logo'

const num = (v: number, digits = 1) => v.toLocaleString('ru-RU', { maximumFractionDigits: digits })
const gb = (b: number) => `${num(b / 2 ** 30)} ГБ`
const size = (b: number) => (b >= 2 ** 30 ? gb(b) : `${num(b / 2 ** 20, 0)} МБ`)
const uptime = (m: number) => (m >= 1440 ? `${Math.floor(m / 1440)} д ${Math.floor((m % 1440) / 60)} ч` : m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`)
const BATTERY_LEVEL = { empty: 0, low: 1, medium: 2, full: 3 } as const

/** Сведения одним текстом — для «Скопировать» */
function asText(i: SystemInfo) {
  return [
    `PlayOS ${i.app.version} (Electron ${i.app.electron}, Chromium ${i.app.chrome})`,
    `${i.os.name}, сборка ${i.os.build}`,
    `Процессор: ${i.cpu.model}, ${i.cpu.threads} потоков`,
    `Видеокарта: ${i.gpu}`,
    `Память: ${gb(i.memory.total)}, свободно ${gb(i.memory.free)}`,
    ...i.displays.map((d) => `Экран ${d.name}: ${d.width}×${d.height}, ${d.hz} Гц${d.primary ? ', основной' : ''}`),
    ...i.pads.map((p) => `Геймпад ${p.name}${p.via ? ` (${p.via})` : ''}${p.percent !== undefined ? `, ${p.percent}%` : ''}`),
    `Библиотека: ${gamesCount(i.library.games)}, ${num(i.library.hours)} ч, данные ${size(i.library.totalBytes)}`
  ].join('\n')
}

/** «О системе»: шапка с версией и карточки — компьютер, память, экраны, геймпады, место на диске */
export function SystemInfoDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  useEffect(() => {
    api.systemInfo().then(setInfo)
  }, [])

  useSpatialNav(ref, {
    priority: 40,
    onBack: onClose,
    autoFocus: '.si-done',
    // Вверх/вниз за пределами кнопок листают карточки, если они не поместились
    onEdge: (dir) => {
      if (dir === 'up' || dir === 'down') bodyRef.current?.scrollBy({ top: (dir === 'down' ? 1 : -1) * window.innerHeight * 0.3, behavior: 'smooth' })
    },
    // Окно забирает всё управление: вкладки L1/R1 под ним не переключаются
    onAction: () => {}
  })

  const copy = async () => {
    if (!info) return
    try {
      await navigator.clipboard.writeText(asText(info))
      play('select')
      toast({ title: 'Сведения скопированы', message: 'Их можно вставить в сообщение или отчёт об ошибке', tone: 'success' })
    } catch {
      play('error')
    }
  }

  const used = info ? info.memory.total - info.memory.free : 0
  const usedPct = info ? Math.round((used / info.memory.total) * 100) : 0
  const maxW = info ? Math.max(...info.displays.map((d) => d.width)) : 1
  const other = info ? Math.max(0, info.library.totalBytes - info.library.artBytes - info.library.videoBytes) : 0
  const storage = info
    ? [
        { label: 'Обложки и фоны', bytes: info.library.artBytes, cls: 'is-art' },
        { label: 'Видео живого фона', bytes: info.library.videoBytes, cls: 'is-video' },
        { label: 'Кэш и остальное', bytes: other, cls: 'is-other' }
      ]
    : []

  return createPortal(
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className="si"
        ref={ref}
        initial={{ opacity: 0, transform: 'scale(0.96) translateY(1.2rem)' }}
        animate={{ opacity: 1, transform: 'scale(1) translateY(0rem)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      >
        <header className="si-head">
          <LogoMark className="si-logo" />
          <div className="si-title">
            <h2>
              Play<span>OS</span>
            </h2>
            <p>{info ? `Версия ${info.app.version}${info.app.packaged ? '' : ' (из исходников)'}` : 'Собираем сведения…'}</p>
          </div>
          {info && (
            <div className="si-chips">
              <span>Electron {info.app.electron}</span>
              <span>Chromium {info.app.chrome.split('.')[0]}</span>
            </div>
          )}
        </header>

        <div className="si-body" ref={bodyRef}>
          {!info ? (
            <div className="si-grid">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="si-card is-skeleton" />
              ))}
            </div>
          ) : (
            <div className="si-grid">
              <section className="si-card">
                <h3>Компьютер</h3>
                <dl className="si-list">
                  <div>
                    <dt>Система</dt>
                    <dd>
                      {info.os.name} <span className="si-faint">{info.os.build}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Процессор</dt>
                    <dd>
                      {info.cpu.model} <span className="si-faint">{info.cpu.threads} потоков</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Видеокарта</dt>
                    <dd>{info.gpu}</dd>
                  </div>
                  <div>
                    <dt>Без перезагрузки</dt>
                    <dd>{uptime(info.os.uptimeMin)}</dd>
                  </div>
                </dl>
              </section>

              <section className="si-card">
                <h3>Память</h3>
                <div className="si-big">
                  {gb(info.memory.total)}
                  <span>занято {usedPct}%</span>
                </div>
                <div className="si-meter" role="img" aria-label={`Занято ${gb(used)} из ${gb(info.memory.total)}`}>
                  <span style={{ width: `${usedPct}%` }} />
                </div>
                <p className="si-caption">
                  Занято {gb(used)}, свободно {gb(info.memory.free)}
                </p>
              </section>

              <section className="si-card is-wide">
                <h3>Экраны</h3>
                <div className="si-screens">
                  {info.displays.map((d) => (
                    <div key={d.name + d.width} className={`si-screen ${d.current ? 'is-current' : ''}`}>
                      <div className="si-screen-shape" style={{ width: `${(d.width / maxW) * 22}rem`, aspectRatio: `${d.width} / ${d.height}` }}>
                        {d.current && <LogoMark className="si-screen-logo" />}
                      </div>
                      <div className="si-screen-name">{d.name}</div>
                      <div className="si-screen-meta">
                        {d.width}×{d.height}, {d.hz} Гц
                      </div>
                      <div className="si-badges">
                        {d.primary && <span>Основной</span>}
                        {d.current && <span className="is-accent">Здесь PlayOS</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="si-card">
                <h3>Геймпады</h3>
                {info.pads.length ? (
                  <ul className="si-pads">
                    {info.pads.map((p) => (
                      <li key={p.name + (p.via ?? '')}>
                        <span className="si-pad-icon">
                          <IconGamepad />
                        </span>
                        <span className="si-pad-text">
                          <span>{p.name}</span>
                          {p.via && <span className="si-faint">{p.via}</span>}
                        </span>
                        <span className="si-pad-battery">
                          {p.battery === 'wired' ? (
                            <IconPlug />
                          ) : p.battery ? (
                            <IconBattery level={BATTERY_LEVEL[p.battery]} />
                          ) : null}
                          {p.percent !== undefined && `${p.percent}%`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="si-caption">Геймпады не подключены</p>
                )}
              </section>

              <section className="si-card">
                <h3>Библиотека и место</h3>
                <div className="si-big">
                  {gamesCount(info.library.games)}
                  <span>{num(info.library.hours)} ч в играх</span>
                </div>
                <div className="si-stack" role="img" aria-label={`Данные PlayOS занимают ${size(info.library.totalBytes)}`}>
                  {storage.map((x) => (x.bytes > 0 ? <span key={x.label} className={x.cls} style={{ flexGrow: x.bytes }} /> : null))}
                </div>
                <ul className="si-legend">
                  {storage.map((x) => (
                    <li key={x.label}>
                      <i className={x.cls} />
                      {x.label}
                      <b>{size(x.bytes)}</b>
                    </li>
                  ))}
                </ul>
                <p className="si-caption si-path">{info.app.dataDir}</p>
              </section>
            </div>
          )}
        </div>

        <footer className="si-actions">
          <Hint glyph="back" label="Закрыть" />
          <span className="si-actions-buttons">
            <button data-nav className="btn btn-glass" onClick={copy} disabled={!info}>
              Скопировать сведения
            </button>
            <button data-nav className="btn btn-primary si-done" onClick={onClose}>
              Готово
            </button>
          </span>
        </footer>
      </motion.div>
    </motion.div>,
    document.querySelector('.app') ?? document.body
  )
}
