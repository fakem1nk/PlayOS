import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import type { AppState, Game, GameMood } from '@shared/types'
import { api } from '../lib/api'
import { gamesCount, playtime } from '../lib/format'
import { focusEl, nudge, revealEl, useSpatialNav } from '../lib/nav'
import { useInputLayer } from '../lib/input'
import { play } from '../lib/sound'
import { tivi } from '../lib/tivi'
import { toast } from '../lib/state'
import { earnedNow, TIER_NAMES, TROPHIES, type Tier } from '../lib/trophies'
import { activeBuild, buildsOf, figureName, moodOf, newFigures, pileOf, shelf, shelfOf, useHltb, type FigureDef } from '../lib/shelf'
import { Avatar } from './Avatar'
import { ActivityCalendar } from './ActivityCalendar'
import { IconArrowUp, IconCheck, IconClose, IconEdit, IconImage, IconPlay, IconRestart, IconSort, IconTrash, IconTrophy } from './Icons'
import { locale, t } from '@shared/i18n'
import { DotText } from './DotText'
import { PromptDialog, SideMenu, type MenuItem } from './Menus'
import { ProfilePile } from './ProfilePile'
import { FigureShelf, ProfileShelf } from './ProfileShelf'
import { CompletedDialog, FigureDialog, Flyer, PilePicker, TiviPick, YearRecap, type Rect } from './ShelfDialogs'
import { AppPortal } from './ShelfBits'
import '../styles-shelf.css'

const dayMonth = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' })

interface Props {
  state: AppState
  active: boolean
  onExitTop: () => void
  onLaunch: (g: Game) => void
}

interface Flight {
  game: Game
  from: DOMRect
  to: Rect
  figures: FigureDef[]
  mood: GameMood
}

type Prompt = { kind: 'new' } | { kind: 'rename'; id: string }

export function Profile({ state, active, onExitTop, onLaunch }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const { games, settings } = state
  const [focusedTrophy, setFocusedTrophy] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; zone: 'plan' | 'shelf' } | null>(null)
  const [buildMenu, setBuildMenu] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [completing, setCompleting] = useState<string | null>(null)
  const [flying, setFlying] = useState(false)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [arriving, setArriving] = useState<string | null>(null)
  const [landed, setLanded] = useState<string | null>(null)
  const [freshFig, setFreshFig] = useState<string | null>(null)
  const [enterId, setEnterId] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [pick, setPick] = useState(false)
  const [recap, setRecap] = useState<number | null>(null)
  const [figure, setFigure] = useState<FigureDef | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const modal = !!menu || !!buildMenu || !!prompt || !!completing || !!flight || picker || pick || recap !== null || !!figure

  const build = activeBuild(settings)
  const builds = buildsOf(settings)
  const list = pileOf(games, build.id)
  const shelfGames = useMemo(() => shelfOf(games), [games])
  const hltb = useHltb(list)
  const byId = (id: string | null) => (id ? games.find((g) => g.id === id) : undefined)

  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 10
  const focusId = (id: string, attr: 'plan' | 'shelf' = 'plan') => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-${attr}-id="${id}"]`)
    if (el) focusEl(el)
  }

  useSpatialNav(ref, {
    priority: 0,
    active: active && !modal && !moving,
    onBack: onExitTop,
    onEdge: (dir) => {
      if (dir === 'up') return onExitTop()
      // Колонки разной высоты: из левой вправо — к первому пункту справа, обратно — к аватару
      const root = ref.current
      const inMain = !!root?.querySelector('.profile-main')?.contains(document.activeElement)
      const target =
        dir === 'right' && !inMain ? root?.querySelector<HTMLElement>('.profile-main [data-nav]') : dir === 'left' && inMain ? root?.querySelector<HTMLElement>('.profile-avatar-btn') : null
      if (!target) {
        play('bump')
        return nudge(document.activeElement, dir)
      }
      play('move')
      focusEl(target)
    },
    // △ — меню того, что в фокусе: игры стопки, игры полки или сборки
    onAction: (a) => {
      if (a !== 'menu') return false
      const el = document.activeElement as HTMLElement | null
      if (el?.dataset.buildId) {
        play('select')
        return setBuildMenu(el.dataset.buildId)
      }
      const id = el?.dataset.planId ?? el?.dataset.shelfId
      if (!id) return false
      play('select')
      setMenu({ id, zone: el?.dataset.planId ? 'plan' : 'shelf' })
    },
    autoFocus: '.profile-avatar-btn'
  })

  // «Переложить»: стрелки двигают коробку по стопке, ✕ или ○ кладёт
  useInputLayer(
    (a) => {
      if (!moving) return false
      const g = byId(moving)
      if (a === 'left' || a === 'up' || a === 'right' || a === 'down') {
        if (g && shelf.move(list, build.id, g, a === 'left' || a === 'up' ? -1 : 1)) play('move')
        else {
          play('bump')
          nudge(document.activeElement, a)
        }
      } else if (a === 'confirm' || a === 'back') {
        play('select')
        setMoving(null)
      }
    },
    20,
    !!moving
  )
  // После перестановки карточка рисуется на новом месте — фокус за ней
  useLayoutEffect(() => {
    if (!moving) return
    const el = ref.current?.querySelector<HTMLElement>(`[data-plan-id="${moving}"]`)
    if (el && document.activeElement !== el) el.focus({ preventScroll: true })
    if (el) revealEl(el)
  }, [moving, list.map((g) => g.id).join()])
  // Игру убрали из стопки или прошли — «переложить» больше нечего
  useEffect(() => {
    if (moving && !list.some((g) => g.id === moving)) setMoving(null)
  }, [moving, list])

  const stats = useMemo(() => {
    const total = games.reduce((a, g) => a + g.playtime, 0)
    const since = games.length ? Math.min(...games.map((g) => g.addedAt)) : Date.now()
    return { total, since }
  }, [games])
  const earned = earnedNow(state)
  // Три последних полученных трофея PlayOS — под статистикой в левой колонке
  const recent = TROPHIES.filter((tr) => earned.has(tr.id) && settings.trophies[tr.id])
    .sort((a, b) => settings.trophies[b.id] - settings.trophies[a.id])
    .slice(0, 3)
  const trophy = TROPHIES.find((tr) => tr.id === focusedTrophy)

  const pickAvatar = async () => {
    const p = await api.pickFile('image')
    if (!p) return
    await api.saveSettings({ avatar: p })
  }

  const take = (g: Game) => {
    setEnterId(g.id)
    void shelf.place(list, build.id, g, 0)
    window.setTimeout(() => setEnterId(null), 1600)
  }

  /**
   * На полку: игра отмечается пройденной (на полке её место уже есть, но пустое), профиль при необходимости докручивается
   * до него, копия коробки летит из окна на это место и встаёт корешком; тем временем с верха стопки берётся следующая
   */
  const confirmDone = async (mood: GameMood, full: boolean, from: DOMRect | null) => {
    const game = byId(completing)
    if (!game) return
    const figures = newFigures(shelfGames, game, full)
    const next = list[0]?.id === game.id ? list[1]?.id : undefined
    if (!from) {
      await shelf.complete(game, mood, full)
      setCompleting(null)
      return
    }
    setFlying(true)
    setArriving(game.id)
    await shelf.complete(game, mood, full)
    // Два кадра: полка успела перестроиться с новым местом
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const slot = ref.current?.querySelector<HTMLElement>(`[data-shelf-id="${game.id}"]`)
        const main = ref.current?.querySelector<HTMLElement>('.profile-main')
        setCompleting(null)
        if (!slot || !main) return landedNow({ game, from, to: { left: 0, top: 0, width: 0, height: 0 }, figures, mood })
        let r = slot.getBoundingClientRect()
        const m = main.getBoundingClientRect()
        const pad = rem() * 6
        if (r.bottom + pad > m.bottom || r.top - pad * 2 < m.top) {
          main.scrollTop += r.bottom + pad - m.bottom
          r = slot.getBoundingClientRect()
        }
        setFlight({ game, from, to: { left: r.left, top: r.top, width: r.width, height: r.height }, figures, mood })
        if (next) setEnterId(next)
      })
    )
  }

  const landedNow = (f: Flight | null = flight) => {
    if (!f) return
    setFlight(null)
    setFlying(false)
    setArriving(null)
    setLanded(f.game.id)
    play('toggleOn')
    tivi({ act: moodOf(f.mood)?.act ?? 'happy', ms: 2600, priority: 5 })
    window.setTimeout(() => focusId(f.game.id, 'shelf'), 250)
    const fresh = f.figures.filter((x) => !settings.figuresSeen?.includes(x.id))
    if (fresh.length) {
      window.setTimeout(() => {
        setFreshFig(fresh[0].id)
        tivi({ act: 'news', ms: 2400, priority: 6 })
        toast({ title: t('Новая фигурка Тиви'), message: fresh.map((x) => figureName(x.id)).join(', '), tone: 'success' })
        void api.saveSettings({ figuresSeen: [...(settings.figuresSeen ?? []), ...fresh.map((x) => x.id)] })
      }, 900)
    }
    window.setTimeout(() => (setLanded(null), setFreshFig(null)), 3600)
    window.setTimeout(() => setEnterId(null), 1600)
  }

  const close = () => setMenu(null)
  const menuGame = byId(menu?.id ?? null)
  const isCurrent = !!menu && list[0]?.id === menu.id
  const menuItems: MenuItem[] = !menu
    ? []
    : menu.zone === 'plan'
      ? [
          {
            id: 'play',
            label: isCurrent ? t('Играть') : t('Взять и играть'),
            icon: <IconPlay />,
            run: () => {
              close()
              if (!isCurrent && menuGame) take(menuGame)
              if (menuGame) onLaunch(menuGame)
            }
          },
          { id: 'done', label: t('Пройдено'), icon: <IconCheck />, run: () => (close(), setCompleting(menu.id)) },
          ...(!isCurrent
            ? [
                { id: 'take', label: t('Взять сейчас'), icon: <IconArrowUp />, run: () => (close(), menuGame && take(menuGame)) },
                { id: 'top', label: t('Наверх стопки'), icon: <IconArrowUp />, run: () => (close(), menuGame && void shelf.place(list, build.id, menuGame, 1)) },
                { id: 'move', label: t('Переложить'), icon: <IconSort />, run: () => (close(), setMoving(menu.id)) }
              ]
            : [{ id: 'back', label: t('Положить обратно в стопку'), icon: <IconSort />, run: () => (close(), menuGame && shelf.move(list, build.id, menuGame, 1)) }]),
          { id: 'remove', label: t('Убрать из стопки'), icon: <IconClose />, group: true, run: () => (close(), menuGame && void shelf.remove(menuGame, build.id)) }
        ]
      : [
          { id: 'replay', label: t('Пройти заново'), icon: <IconRestart />, run: () => (close(), menuGame && void shelf.uncomplete(menuGame, { list, build: build.id })) },
          {
            id: 'unmark',
            label: t('Снять с полки'),
            icon: <IconClose />,
            group: true,
            confirm: { title: t('Снять с полки?'), text: t('Отметка «Пройдено» и оценка пропадут. Время игры и трофеи останутся.'), button: t('Снять') },
            run: () => (close(), menuGame && void shelf.uncomplete(menuGame))
          }
        ]

  const buildItems: MenuItem[] = !buildMenu
    ? []
    : [
        { id: 'rename', label: t('Переименовать'), icon: <IconEdit />, run: () => (setPrompt({ kind: 'rename', id: buildMenu }), setBuildMenu(null)) },
        ...(builds.length > 1
          ? [
              {
                id: 'delete',
                label: t('Удалить сборку'),
                icon: <IconTrash />,
                danger: true,
                confirm: { title: t('Удалить сборку?'), text: t('Игры останутся в библиотеке и других стопках.'), button: t('Удалить') },
                run: () => {
                  const id = buildMenu
                  setBuildMenu(null)
                  const rest = builds.filter((b) => b.id !== id)
                  void api.saveSettings({ builds: rest, build: settings.build === id ? rest[0].id : settings.build })
                  void api.shelfPatch(
                    games
                      .filter((g) => g.pile?.[id] !== undefined)
                      .map((g) => {
                        const pile = { ...g.pile }
                        delete pile[id]
                        return { id: g.id, pile: Object.keys(pile).length ? pile : null }
                      })
                  )
                }
              }
            ]
          : [])
      ]

  const submitPrompt = (name: string) => {
    if (prompt?.kind === 'new') {
      const id = `b${Date.now().toString(36)}`
      void api.saveSettings({ builds: [...builds, { id, name }], build: id })
    } else if (prompt?.kind === 'rename') {
      void api.saveSettings({ builds: builds.map((b) => (b.id === prompt.id ? { ...b, name } : b)) })
    }
    setPrompt(null)
  }

  const pickable = games.filter((g) => !g.done && g.pile?.[build.id] === undefined).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.title.localeCompare(b.title))

  return (
    <div className="profile-page" ref={ref}>
      <section className="profile-card">
        <button data-nav className="profile-avatar-btn" onClick={pickAvatar} aria-label={t('Сменить аватар')}>
          <Avatar name={settings.userName} src={settings.avatar} className="avatar-xl" />
          <span className="profile-avatar-edit">
            <IconImage />
          </span>
        </button>
        <NameField name={settings.userName} />
        <p className="profile-since">{t('В PlayOS с {date}', { date: dayMonth.format(stats.since) })}</p>

        <div className="profile-hero">
          <DotText className="profile-hero-value" text={stats.total ? playtime(stats.total) : t('0 мин')} />
          <span className="profile-hero-label">{t('наиграно всего')}</span>
        </div>
        <dl className="profile-stats">
          <div>
            <dt>{t('Библиотека')}</dt>
            <dd>{gamesCount(games.length)}</dd>
          </div>
          <div>
            <dt>{t('На полке')}</dt>
            <dd>{shelfGames.length}</dd>
          </div>
          <div>
            <dt>{t('Трофеи')}</dt>
            <dd>{t('{earned} из {total}', { earned: earned.size, total: TROPHIES.length })}</dd>
          </div>
        </dl>

        {recent.length > 0 && (
          <div className="profile-recent">
            <h2 className="profile-recent-title">{t('Последние трофеи')}</h2>
            <ul>
              {recent.map((tr) => (
                <li key={tr.id} className={`profile-recent-item trophy-${tr.tier}`}>
                  <IconTrophy />
                  <span className="profile-recent-text">
                    <span className="profile-recent-name">{tr.title}</span>
                    <span className="profile-recent-date">{dayMonth.format(settings.trophies[tr.id])}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="profile-main">
        <ProfilePile
          games={games}
          settings={settings}
          moving={moving}
          enterId={enterId}
          onMenu={(g) => (play('select'), setMenu({ id: g.id, zone: 'plan' }))}
          onBuildMenu={(id) => (play('select'), setBuildMenu(id))}
          onNewBuild={() => (play('select'), setPrompt({ kind: 'new' }))}
          onDone={(g) => (play('select'), setCompleting(g.id))}
          onPlay={onLaunch}
          onAdd={() => (play('select'), setPicker(true))}
          onPick={() => (play('select'), setPick(true))}
        />
        <ProfileShelf shelfGames={shelfGames} arriving={arriving} landed={landed} onMenu={(g) => (play('select'), setMenu({ id: g.id, zone: 'shelf' }))} onYear={(y) => (play('select'), setRecap(y))} />
        <FigureShelf shelfGames={shelfGames} fresh={freshFig} onOpen={(f) => (play('select'), setFigure(f))} />
        <ActivityCalendar games={games} />

        <section className="profile-block" data-reveal>
          <header className="block-head">
            <h2 className="block-title">{t('Трофеи PlayOS')}</h2>
            <span className="block-meta">{t('{earned} из {total}', { earned: earned.size, total: TROPHIES.length })}</span>
          </header>
          <div className="trophies">
            {TROPHIES.map((tr) => {
              const got = earned.has(tr.id)
              return (
                <button
                  key={tr.id}
                  data-nav
                  className={`trophy trophy-${tr.tier} ${got ? 'is-earned' : ''}`}
                  onFocus={() => setFocusedTrophy(tr.id)}
                  onMouseEnter={() => setFocusedTrophy(tr.id)}
                  aria-label={`${tr.title}: ${tr.desc}`}
                >
                  <IconTrophy />
                </button>
              )
            })}
          </div>
          <p className="trophy-detail">
            {trophy ? (
              <>
                <strong>{trophy.title}</strong> <TierBadge tier={trophy.tier} /> {trophy.desc}
                {earned.has(trophy.id) && settings.trophies[trophy.id] && <span className="trophy-date">{t(', получен {date}', { date: dayMonth.format(settings.trophies[trophy.id]) })}</span>}
              </>
            ) : (
              t('Выберите трофей, чтобы узнать условие')
            )}
          </p>
        </section>
      </div>

      <AnimatePresence>
        {menu && menuGame && (
          <AppPortal key="menu">
            <SideMenu title={menuGame.title} items={menuItems} onClose={() => (play('back'), setMenu(null))} />
          </AppPortal>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {buildMenu && (
          <AppPortal key="build">
            <SideMenu title={builds.find((b) => b.id === buildMenu)?.name ?? ''} items={buildItems} onClose={() => (play('back'), setBuildMenu(null))} />
          </AppPortal>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {prompt && (
          <AppPortal key="prompt">
            <PromptDialog
              title={prompt.kind === 'new' ? t('Новая сборка') : t('Название сборки')}
              value={prompt.kind === 'rename' ? (builds.find((b) => b.id === prompt.id)?.name ?? '') : ''}
              placeholder={t('Например, Souls-марафон')}
              button={prompt.kind === 'new' ? t('Создать') : t('Сохранить')}
              onCancel={() => (play('back'), setPrompt(null))}
              onSubmit={submitPrompt}
            />
          </AppPortal>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {completing && byId(completing) && <CompletedDialog key="done" game={byId(completing)!} flying={flying} onCancel={() => (play('back'), setCompleting(null))} onConfirm={confirmDone} />}
      </AnimatePresence>
      {flight && <Flyer game={flight.game} from={flight.from} to={flight.to} onDone={() => landedNow()} />}
      <AnimatePresence>
        {picker && (
          <PilePicker
            key="picker"
            games={pickable}
            buildName={build.name}
            onClose={() => (play('back'), setPicker(false))}
            onAdd={(ids) => {
              play('select')
              void shelf.add(list, build.id, ids.map((id) => byId(id)).filter((g): g is Game => !!g))
              setPicker(false)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {pick && list.length > 2 && (
          <TiviPick
            key="pick"
            list={list.slice(1)}
            hltb={hltb}
            onClose={() => (play('back'), setPick(false))}
            onChoose={(g, now) => {
              play('select')
              setPick(false)
              if (now) take(g)
              else void shelf.place(list, build.id, g, 1)
              window.setTimeout(() => focusId(g.id), 300)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {recap !== null && (
          <YearRecap key="recap" year={recap} games={shelfGames.filter((g) => new Date(g.done!.at).getFullYear() === recap)} onClose={() => (play('back'), setRecap(null))} />
        )}
      </AnimatePresence>
      <AnimatePresence>{figure && <FigureDialog key="fig" figure={figure} shelfGames={shelfGames} onClose={() => (play('back'), setFigure(null))} />}</AnimatePresence>
    </div>
  )
}

/** Имя — само поле ввода в виде заголовка: ✕ на нём открывает клавиатуру, Enter или уход фокуса сохраняет */
function NameField({ name }: { name: string }) {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const commit = () => {
    const v = draft.trim() || t('Игрок')
    setDraft(v)
    if (v !== name) void api.saveSettings({ userName: v })
  }
  return (
    <h1 className="profile-title">
      <input
        data-nav
        className="profile-name-input"
        aria-label={t('Имя пользователя')}
        value={draft}
        maxLength={32}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </h1>
  )
}

function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`tier-badge tier-${tier}`}>{TIER_NAMES[tier]}</span>
}
