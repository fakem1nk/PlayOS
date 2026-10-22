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
import { LogoMark, Wordmark } from './Logo'
import { locale, t } from '@shared/i18n'

const num = (v: number, digits = 1) => v.toLocaleString(locale(), { maximumFractionDigits: digits })
const gb = (b: number) => t('{v} ГБ', { v: num(b / 2 ** 30) })
const size = (b: number) => (b >= 2 ** 30 ? gb(b) : t('{v} МБ', { v: num(b / 2 ** 20, 0) }))
const uptime = (m: number) => (m >= 1440 ? t('{v} д {v2} ч', { v: Math.floor(m / 1440), v2: Math.floor((m % 1440) / 60) }) : m >= 60 ? t('{v} ч {v2} мин', { v: Math.floor(m / 60), v2: m % 60 }) : t('{m} мин', { m }))
const BATTERY_LEVEL = { empty: 0, low: 1, medium: 2, full: 3 } as const

/** Сведения одним текстом — для «Скопировать» */
function asText(i: SystemInfo) {
  return [
    `PlayOS ${i.app.version} (Electron ${i.app.electron}, Chromium ${i.app.chrome})`,
    t('{name}, сборка {build}', { name: i.os.name, build: i.os.build }),
    t('Процессор: {model}, {threads} потоков', { model: i.cpu.model, threads: i.cpu.threads }),
    t('Видеокарта: {gpu}', { gpu: i.gpu }),
    t('Память: {v}, свободно {v2}', { v: gb(i.memory.total), v2: gb(i.memory.free) }),
    ...i.displays.map((d) => t('Экран {name}: {w}×{h}, {hz} Гц', { name: d.name, w: d.width, h: d.height, hz: d.hz }) + (d.primary ? t(', основной') : '')),
    ...i.pads.map((p) => t('Геймпад {name}', { name: p.name }) + (p.via ? ` (${p.via})` : '') + (p.percent !== undefined ? `, ${p.percent}%` : '')),
    t('Библиотека: {v}, {v2} ч, данные {v3}', { v: gamesCount(i.library.games), v2: num(i.library.hours), v3: size(i.library.totalBytes) })
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
      toast({ title: t('Сведения скопированы'), message: t('Их можно вставить в сообщение или отчёт об ошибке'), tone: 'success' })
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
        { label: t('Обложки и фоны'), bytes: info.library.artBytes, cls: 'is-art' },
        { label: t('Видео живого фона'), bytes: info.library.videoBytes, cls: 'is-video' },
        { label: t('Кэш и остальное'), bytes: other, cls: 'is-other' }
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
              <Wordmark className="si-wordmark" />
            </h2>
            <p>{info ? t('Версия {v}', { v: info.app.version }) + (info.app.packaged ? '' : ` ${t('(из исходников)')}`) : t('Собираем сведения…')}</p>
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
                <h3>{t('Компьютер')}</h3>
                <dl className="si-list">
                  <div>
                    <dt>{t('Система')}</dt>
                    <dd>
                      {info.os.name} <span className="si-faint">{info.os.build}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Процессор')}</dt>
                    <dd>
                      {info.cpu.model} <span className="si-faint">{t('{n} потоков', { n: info.cpu.threads })}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('Видеокарта')}</dt>
                    <dd>{info.gpu}</dd>
                  </div>
                  <div>
                    <dt>{t('Включён')}</dt>
                    <dd>{uptime(info.os.uptimeMin)}</dd>
                  </div>
                </dl>
              </section>

              <section className="si-card">
                <h3>{t('Память')}</h3>
                <div className="si-big">
                  {gb(info.memory.total)}
                  <span>{t('занято {pct}%', { pct: usedPct })}</span>
                </div>
                <div className="si-meter" role="img" aria-label={t('Занято {v} из {v2}', { v: gb(used), v2: gb(info.memory.total) })}>
                  <span style={{ width: `${usedPct}%` }} />
                </div>
                <p className="si-caption">
                  {t('Занято {used}, свободно {free}', { used: gb(used), free: gb(info.memory.free) })}
                </p>
              </section>

              <section className="si-card">
                <h3>{t('Геймпады')}</h3>
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
                  <p className="si-caption">{t('Геймпады не подключены')}</p>
                )}
              </section>

              <section className="si-card is-wide">
                <h3>{t('Экраны')}</h3>
                <div className="si-screens">
                  {info.displays.map((d) => (
                    <div key={d.name + d.width} className={`si-screen ${d.current ? 'is-current' : ''}`}>
                      <div className="si-screen-shape" style={{ width: `${(d.width / maxW) * 22}rem`, aspectRatio: `${d.width} / ${d.height}` }}>
                        {d.current && <LogoMark className="si-screen-logo" />}
                      </div>
                      <div className="si-screen-name">{d.name}</div>
                      <div className="si-screen-meta">
                        {t('{w}×{h}, {hz} Гц', { w: d.width, h: d.height, hz: d.hz })}
                      </div>
                      <div className="si-badges">
                        {d.primary && <span>{t('Основной')}</span>}
                        {d.current && <span className="is-accent">{t('Здесь PlayOS')}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="si-card">
                <h3>{t('Библиотека и место')}</h3>
                <div className="si-big">
                  {gamesCount(info.library.games)}
                  <span>{t('{h} ч в играх', { h: num(info.library.hours) })}</span>
                </div>
                <div className="si-stack" role="img" aria-label={t('Данные PlayOS занимают {v}', { v: size(info.library.totalBytes) })}>
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
          <Hint glyph="back" label={t('Закрыть')} />
          <span className="si-actions-buttons">
            <button data-nav className="btn btn-glass" onClick={copy} disabled={!info}>
              {t('Скопировать сведения')}
            </button>
            <button data-nav className="btn btn-primary si-done" onClick={onClose}>
              {t('Готово')}
            </button>
          </span>
        </footer>
      </motion.div>
    </motion.div>,
    document.querySelector('.app') ?? document.body
  )
}
