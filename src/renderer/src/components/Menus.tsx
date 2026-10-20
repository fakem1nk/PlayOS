import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { PLATFORM_NAMES, type Game, type PowerAction, type RunningGame } from '@shared/types'
import { api } from '../lib/api'
import { playtime } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { Hint } from './Glyph'
import { IconClose, IconEdit, IconExit, IconFolder, IconInfo, IconMoon, IconPlay, IconPower, IconReset, IconRestart, IconStar, IconTrash, IconTrophy } from './Icons'
import { Cover } from './Tile'

interface Item {
  id: string
  label: string
  icon: ReactNode
  danger?: boolean
  confirm?: { title: string; text: string; button: string }
  run: () => void
}

/** Боковая шторка со списком действий (как меню Options на PS5). */
function SideMenu({ title, header, items, onClose }: { title: string; header?: ReactNode; items: Item[]; onClose: () => void }) {
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
        <h2 className="side-title">{title}</h2>
        <div className="menu-list">
          {items.map((item) => (
            <button key={item.id} data-nav className={`menu-item ${item.danger ? 'is-danger' : ''}`} onClick={() => choose(item)}>
              <span className="menu-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
        <footer className="sheet-hints">
          <Hint glyph="confirm" label="Выбрать" />
          <Hint glyph="back" label="Закрыть" />
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
            Отмена
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
      ? { id: 'close', label: 'Закрыть игру', icon: <IconClose />, run: () => (onClose(), onCloseGame()) }
      : { id: 'play', label: 'Играть', icon: <IconPlay />, run: () => (onClose(), onLaunch(game)) },
    { id: 'info', label: 'Об игре', icon: <IconInfo />, run: () => onInfo(game) },
    { id: 'trophies', label: 'Трофеи', icon: <IconTrophy />, run: () => onTrophies(game) },
    { id: 'edit', label: 'Изменить', icon: <IconEdit />, run: () => (onClose(), onEdit(game)) },
    {
      id: 'fav',
      label: game.favorite ? 'Убрать из избранного' : 'Добавить в избранное',
      icon: <IconStar filled={game.favorite} />,
      run: () => api.setFavorite(game.id, !game.favorite)
    },
    { id: 'folder', label: 'Открыть папку игры', icon: <IconFolder />, run: () => api.openFolder(game.path) },
    {
      id: 'reset',
      label: 'Сбросить время игры',
      icon: <IconReset />,
      confirm: { title: 'Сбросить время игры?', text: `Наигранные ${playtime(game.playtime)} в «${game.title}» обнулятся.`, button: 'Сбросить' },
      run: () => api.resetPlaytime(game.id)
    },
    {
      id: 'delete',
      label: 'Удалить из библиотеки',
      icon: <IconTrash />,
      danger: true,
      confirm: { title: 'Удалить игру из библиотеки?', text: `«${game.title}» пропадёт из PlayOS вместе со статистикой. Файлы игры на диске останутся.`, button: 'Удалить' },
      run: () => (onClose(), api.deleteGame(game.id))
    }
  ]
  return (
    <SideMenu
      title="Параметры"
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
              {PLATFORM_NAMES[game.platform]}, {playtime(game.playtime).toLowerCase()}
            </div>
          </div>
        </div>
      }
    />
  )
}

/** Меню питания. Само действие выполняет аутро (onPower), чтобы выход и выключение были с анимацией. */
export function PowerMenu({ onClose, onPower }: { onClose: () => void; onPower: (a: PowerAction) => void }) {
  const run = (a: PowerAction) => () => {
    onClose()
    onPower(a)
  }
  const items: Item[] = [
    { id: 'sleep', label: 'Спящий режим', icon: <IconMoon />, run: run('sleep') },
    {
      id: 'restart',
      label: 'Перезагрузить ПК',
      icon: <IconRestart />,
      confirm: { title: 'Перезагрузить компьютер?', text: 'Несохранённый прогресс в открытых программах будет потерян.', button: 'Перезагрузить' },
      run: run('restart')
    },
    {
      id: 'shutdown',
      label: 'Выключить ПК',
      icon: <IconPower />,
      confirm: { title: 'Выключить компьютер?', text: 'Несохранённый прогресс в открытых программах будет потерян.', button: 'Выключить' },
      run: run('shutdown')
    },
    { id: 'quit', label: 'Выйти из PlayOS', icon: <IconExit />, run: run('quit') }
  ]
  return <SideMenu title="Питание" items={items} onClose={onClose} />
}
