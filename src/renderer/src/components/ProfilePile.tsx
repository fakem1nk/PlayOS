import { useEffect, useState, type CSSProperties } from 'react'
import { Reorder } from 'motion/react'
import { platformName, type Game, type Settings } from '@shared/types'
import { locale, plural, t } from '@shared/i18n'
import { api } from '../lib/api'
import { playtime } from '../lib/format'
import { activeBuild, buildsOf, hoursLeft, looksDone, pileEta, pileOf, shelf, useHltb } from '../lib/shelf'
import { DotText } from './DotText'
import { PixelBar } from './PixelBar'
import { Glyph } from './Glyph'
import { IconCheck, IconDice, IconPlay, IconPlus } from './Icons'
import { Banner, Box3D } from './Box3D'

const dateFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' })
const longDate = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' })
export const hrs = (h: number) => (h >= 10 ? Math.round(h) : Math.round(h * 2) / 2).toString().replace('.', locale().startsWith('ru') ? ',' : '.')
/** Сколько карточек видно в стопке; остальные — «и ещё N» */
const PILE_MAX = 8

interface Props {
  games: Game[]
  settings: Settings
  moving: string | null
  /** Только что взятая из стопки игра — встаёт на место текущей */
  enterId: string | null
  onMenu: (g: Game) => void
  onBuildMenu: (id: string) => void
  onNewBuild: () => void
  onDone: (g: Game) => void
  onPlay: (g: Game) => void
  onAdd: () => void
  onPick: () => void
}

/**
 * «Сейчас прохожу» + «Стопка» в профиле. Текущая игра — 3D-коробка «в руках»; остальные — колода широких карточек из
 * арта Steam: следующая видна целиком, за ней полосками выглядывают остальные, в фокусе карточка раскрывается вверх
 */
export function ProfilePile({ games, settings, moving, enterId, onMenu, onBuildMenu, onNewBuild, onDone, onPlay, onAdd, onPick }: Props) {
  const build = activeBuild(settings)
  const builds = buildsOf(settings)
  const list = pileOf(games, build.id)
  // Порядок при перетаскивании мышью — сразу на экране, не дожидаясь ответа main-процесса
  const [order, setOrder] = useState<string[] | null>(null)
  useEffect(() => setOrder(null), [list.map((g) => g.id).join()])
  const shown = order ? order.map((id) => list.find((g) => g.id === id)).filter((g): g is Game => !!g) : list
  const [cur, ...rest] = shown
  const deck = rest.slice(0, PILE_MAX)
  const more = rest.length - deck.length
  const hltb = useHltb(shown.slice(0, PILE_MAX + 1))
  const eta = pileEta(shown, games, hltb)
  const curH = cur ? hltb(cur) : null
  const pct = cur && curH ? Math.min(1, cur.playtime / 3600 / curH) : 0
  const enter = !!cur && cur.id === enterId

  return (
    <section className="hub" data-reveal>
      <div className="hub-now">
        {cur ? (
          <>
            <button
              key={cur.id}
              data-nav
              data-plan-id={cur.id}
              className={`now-box ${enter ? 'is-enter' : ''}`}
              onClick={() => onMenu(cur)}
              onContextMenu={(e) => (e.preventDefault(), onMenu(cur))}
              aria-label={cur.title}
            >
              <span className="now-floor" />
              <Box3D game={cur} w={21} h={31.5} d={3.2} className="now-3d" />
            </button>
            <div key={`i-${cur.id}`} className={`now-info ${enter ? 'is-enter' : ''}`}>
              <span className="now-kicker">{t('Сейчас прохожу')}</span>
              <h2 className="now-title">{cur.title}</h2>
              <span className="now-meta">
                {platformName(cur)} · {cur.playtime ? playtime(cur.playtime) : t('ещё не начата')}
                {curH ? ` ${t('из ≈ {v} ч', { v: hrs(curH) })}` : ''}
              </span>
              {curH ? (
                <div className="now-progress">
                  <PixelBar value={pct} tone="get" live size={1} />
                  <DotText className="now-pct" text={`${Math.round(pct * 100)}%`} />
                </div>
              ) : null}
              {looksDone(cur, curH) && <span className="now-hunch">{t('Наиграно больше сюжета — может, уже пройдено?')}</span>}
              <div className="now-actions">
                <button data-nav className="btn btn-primary btn-sm" onClick={() => onPlay(cur)}>
                  <IconPlay /> {t('Играть')}
                </button>
                <button data-nav className="btn btn-glass btn-sm now-done" onClick={() => onDone(cur)}>
                  <IconCheck /> {t('Пройдено')}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="now-empty">
            <span className="now-empty-box" />
            <div>
              <h2 className="now-title">{t('Нечего проходить')}</h2>
              <p className="now-empty-text">{t('Соберите стопку из игр, которые хотите пройти. Верхняя станет текущей.')}</p>
            </div>
          </div>
        )}
      </div>

      <div className="hub-pile">
        <header className="pile-head">
          <h2 className="pile-title">{t('Стопка')}</h2>
          {eta.known && (
            <span className="pile-sum" title={t('В вашем темпе — около {v} ч в неделю', { v: hrs(eta.week) })}>
              <DotText text={hrs(eta.total)} /> {t('ч')}
              <span className="pile-sep" />
              {t('до {date}', { date: longDate.format(eta.end) })}
            </span>
          )}
          {!eta.known && <span className="pile-sum" />}
          <button data-nav className="pile-icon pp-ring" onClick={onPick} disabled={rest.length < 2} aria-label={t('Тиви выбирает')}>
            <IconDice />
          </button>
          <button data-nav className="pile-icon pp-ring" onClick={onAdd} aria-label={t('Положить в стопку')}>
            <IconPlus />
          </button>
        </header>
        <div className="pile-builds">
          {builds.map((b) => (
            <button
              key={b.id}
              data-nav
              data-build-id={b.id}
              className={`chip pile-build ${b.id === build.id ? 'is-active' : ''}`}
              onClick={() => b.id !== build.id && void api.saveSettings({ build: b.id })}
              onContextMenu={(e) => (e.preventDefault(), onBuildMenu(b.id))}
            >
              {b.name}
              <span className="pile-build-n">{pileOf(games, b.id).length}</span>
            </button>
          ))}
          <button data-nav className="chip pile-build pile-build-add" aria-label={t('Новая сборка')} onClick={onNewBuild}>
            <IconPlus />
          </button>
        </div>

        {deck.length > 0 ? (
          <div className="deck">
            <Reorder.Group
              as="div"
              axis="y"
              values={deck.map((g) => g.id)}
              onReorder={(ids) => {
                const next = [cur.id, ...ids, ...rest.slice(PILE_MAX).map((g) => g.id)]
                setOrder(next)
                void shelf.reorder(shown, build.id, next)
              }}
              className="deck-stack"
            >
              {deck.map((g, i) => {
                const h = hltb(g)
                const left = hoursLeft(g, h)
                return (
                  <Reorder.Item as="div" key={g.id} value={g.id} className={`deck-slot ${moving === g.id ? 'is-moving' : ''}`} style={{ '--i': i } as CSSProperties} dragListener={!moving}>
                    {/* z-index — на карточке: свой zIndex у Reorder.Item motion перезаписывает */}
                    <button data-nav data-plan-id={g.id} className="deck-card" style={{ zIndex: 50 - i }} onClick={() => onMenu(g)} onContextMenu={(e) => (e.preventDefault(), onMenu(g))} aria-label={g.title}>
                      <Banner game={g}>
                        <span className="deck-fill" />
                        {looksDone(g, h) && <span className="deck-hunch">{t('финал?')}</span>}
                        {left !== null && <span className="deck-date">{t('к {date}', { date: dateFmt.format(eta.at[i + 1]) })}</span>}
                        {left !== null && (
                          <span className="deck-hours">
                            {left > 0 ? (
                              <>
                                <DotText text={hrs(left)} /> {t('ч')}
                              </>
                            ) : (
                              t('финал')
                            )}
                          </span>
                        )}
                      </Banner>
                      <span className="deck-dim" />
                    </button>
                  </Reorder.Item>
                )
              })}
            </Reorder.Group>
            {more > 0 && <div className="pile-more">{t('и ещё {n} {games}', { n: more, games: plural(more, ['игра', 'игры', 'игр'], ['game', 'games']) })}</div>}
          </div>
        ) : (
          <button data-nav className="pile-add pp-ring" onClick={onAdd}>
            <IconPlus /> {t('Положить в стопку')}
          </button>
        )}
        {moving && (
          <p className="pile-moving">
            <Glyph name="adjust" /> {t('вверх-вниз по стопке')} <Glyph name="confirm" /> {t('положить')}
          </p>
        )}
      </div>
    </section>
  )
}
