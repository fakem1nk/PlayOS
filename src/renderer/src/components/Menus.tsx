import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { platformName, type Game, type PowerAction, type RunningGame } from '@shared/types'
import { api } from '../lib/api'
import { playtime } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { Hint } from './Glyph'
import { IconClose, IconDownload, IconEdit, IconExit, IconFolder, IconInfo, IconMonitor, IconMoon, IconPlay, IconPower, IconReset, IconRestart, IconStar, IconSun, IconTrash, IconTrophy } from './Icons'
import { Cover } from './Tile'
import { installNow } from './UpdateNotice'
import { nextTheme, themeMode, themeName } from '../lib/theme'
import { t } from '@shared/i18n'

interface Item {
  id: string
  label: string
  icon: ReactNode
  danger?: boolean
  confirm?: { title: string; text: string; button: string }
  run: () => void
}

/** Боковая шторка со списком действий (как меню Options на PS5). */
function SideMenu({ title, titleAction, header, items, onClose }: { title: string; titleAction?: ReactNode; header?: ReactNode; items: Item[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState<Item | null>(null)

  useSpatialNav(ref, { priority: 30, active: !confirming, onBack: onClose, autoFocus: '.menu-item' })

  const choose = (item: Item) => {
    if (item.confirm) {
      play('select')
      setConfirming(item)
      return
    }
    play('select')
    item.run()
  }

  return (
    <>
      <motion.div
        className="scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.18 } }}
        onClick={onClose}
      />
      <motion.aside
        className="side-menu"
        ref={ref}
        initial={{ transform: 'translateX(100%)' }}
        animate={{ transform: 'translateX(0%)' }}
        exit={{ transform: 'translateX(100%)', transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] } }}
        transition={{ duration: 0.36, ease: [0.32, 0.72, 0, 1] }}
      >
        {header}
        {titleAction ? (
          <div className="side-title-row">
            <h2 className="side-title">{title}</h2>
            {titleAction}
          </div>
        ) : (
          <h2 className="side-title">{title}</h2>
        )}
        <div className="menu-list">
          {items.map((item) => (
            <button key={item.id} data-nav className={`menu-item ${item.danger ? 'is-danger' : ''}`} onClick={() => choose(item)}>
              <span className="menu-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
        <footer className="sheet-hints">
          <Hint glyph="confirm" label={t('Выбрать')} />
          <Hint glyph="back" label={t('Закрыть')} />
        </footer>
      </motion.aside>
      <AnimatePresence>
        {confirming?.confirm && (
          <ConfirmDialog
            {...confirming.confirm}
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              setConfirming(null)
              confirming.run()
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

export function ConfirmDialog({ title, text, button, onCancel, onConfirm }: { title: string; text: string; button: string; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useSpatialNav(ref, { priority: 40, onBack: onCancel, autoFocus: '.btn-glass' })
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className="dialog"
        ref={ref}
        initial={{ opacity: 0, transform: 'scale(0.96)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        <h2 className="dialog-title">{title}</h2>
        <p className="dialog-text">{text}</p>
        <div className="dialog-actions">
          <button data-nav className="btn btn-glass" onClick={onCancel}>
            {t('Отмена')}
          </button>
          <button data-nav className="btn btn-danger" onClick={onConfirm}>
            {button}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

interface GameMenuProps {
  game: Game
  running: RunningGame | null
  onClose: () => void
  onLaunch: (g: Game) => void
  onCloseGame: () => void
  onEdit: (g: Game) => void
  onTrophies: (g: Game) => void
  onInfo: (g: Game) => void
}

export function GameMenu({ game, running, onClose, onLaunch, onCloseGame, onEdit, onTrophies, onInfo }: GameMenuProps) {
  const isRunning = running?.gameId === game.id
  const items: Item[] = [
    isRunning
      ? { id: 'close', label: t('Закрыть игру'), icon: <IconClose />, run: () => (onClose(), onCloseGame()) }
      : { id: 'play', label: t('Играть'), icon: <IconPlay />, run: () => (onClose(), onLaunch(game)) },
    { id: 'info', label: t('Об игре'), icon: <IconInfo />, run: () => onInfo(game) },
    { id: 'trophies', label: t('Трофеи'), icon: <IconTrophy />, run: () => onTrophies(game) },
    { id: 'edit', label: t('Изменить'), icon: <IconEdit />, run: () => (onClose(), onEdit(game)) },
    {
      id: 'fav',
      label: game.favorite ? t('Убрать из избранного') : t('Добавить в избранное'),
      icon: <IconStar filled={game.favorite} />,
      run: () => api.setFavorite(game.id, !game.favorite)
    },
    { id: 'folder', label: t('Открыть папку игры'), icon: <IconFolder />, run: () => api.openFolder(game.path) },
    {
      id: 'reset',
      label: t('Сбросить время игры'),
      icon: <IconReset />,
      confirm: { title: t('Сбросить время игры?'), text: t('Наигранные {v} в «{title}» обнулятся.', { v: playtime(game.playtime), title: game.title }), button: t('Сбросить') },
      run: () => api.resetPlaytime(game.id)
    },
    {
      id: 'delete',
      label: t('Удалить из библиотеки'),
      icon: <IconTrash />,
      danger: true,
      confirm: { title: t('Удалить игру из библиотеки?'), text: t('«{title}» пропадёт из PlayOS вместе со статистикой. Файлы игры на диске останутся.', { title: game.title }), button: t('Удалить') },
      run: () => (onClose(), api.deleteGame(game.id))
    }
  ]
  return (
    <SideMenu
      title={t('Параметры')}
      onClose={onClose}
      items={items}
      header={
        <div className="side-game">
          <div className="side-cover">
            <Cover game={game} />
          </div>
          <div>
            <div className="side-game-title">{game.title}</div>
            <div className="side-game-sub">
              {platformName(game)}, {playtime(game.playtime).toLowerCase()}
            </div>
          </div>
        </div>
      }
    />
  )
}

/** Меню питания. Само действие выполняет аутро (onPower), чтобы выход и выключение были с анимацией. */
export function PowerMenu({ update, onClose, onPower }: { update?: string; onClose: () => void; onPower: (a: PowerAction) => void }) {
  const run = (a: PowerAction) => () => {
    onClose()
    onPower(a)
  }
  // Тема переключается прямо отсюда, меню остаётся открытым: тёмная → светлая → как в системе
  const [theme, setThemeLabel] = useState(themeMode())
  const switchTheme = () => {
    play('select')
    const next = nextTheme(theme)
    setThemeLabel(next)
    void api.saveSettings({ theme: next })
  }
  const themeLabel = t('Тема: {name}', { name: themeName(theme).toLowerCase() })
  const themeButton = (
    <button data-nav className="btn btn-round theme-switch" onClick={switchTheme} aria-label={themeLabel} title={themeLabel}>
      {theme === 'light' ? <IconSun /> : theme === 'system' ? <IconMonitor /> : <IconMoon />}
    </button>
  )
  const items: Item[] = [
    ...(update ? [{ id: 'update', label: t('Обновить PlayOS до {update}', { update }), icon: <IconDownload />, run: () => (onClose(), installNow()) }] : []),
    { id: 'sleep', label: t('Спящий режим'), icon: <IconMoon />, run: run('sleep') },
    {
      id: 'restart',
      label: t('Перезагрузить ПК'),
      icon: <IconRestart />,
      confirm: { title: t('Перезагрузить компьютер?'), text: t('Несохранённый прогресс в открытых программах будет потерян.'), button: t('Перезагрузить') },
      run: run('restart')
    },
    {
      id: 'shutdown',
      label: t('Выключить ПК'),
      icon: <IconPower />,
      confirm: { title: t('Выключить компьютер?'), text: t('Несохранённый прогресс в открытых программах будет потерян.'), button: t('Выключить') },
      run: run('shutdown')
    },
    { id: 'quit', label: t('Выйти из PlayOS'), icon: <IconExit />, run: run('quit') }
  ]
  return <SideMenu title={t('Питание')} titleAction={themeButton} items={items} onClose={onClose} />
}
