import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { platformName, type Game, type GameCollection, type PowerAction, type RunningGame } from '@shared/types'
import { api } from '../lib/api'
import { createCollection, deleteCollection, renameCollection, toggleInCollection } from '../lib/collections'
import { lastInputDevice } from '../lib/input'
import { beginEdit, openKeyboard } from '../lib/osk'
import { notInstalled, playtime } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { rumble } from '../lib/haptics'
import { Hint } from './Glyph'
import { IconCheck, IconClose, IconDownload, IconEdit, IconExit, IconFolder, IconGrid, IconInfo, IconMonitor, IconMoon, IconPlay, IconPlus, IconPower, IconReset, IconRestart, IconStar, IconSun, IconTrash, IconTrophy } from './Icons'
import { Cover } from './Tile'
import { installNow } from './UpdateNotice'
import { nextTheme, themeMode, themeName } from '../lib/theme'
import { t } from '@shared/i18n'

interface Item {
  id: string
  label: string
  icon: ReactNode
  danger?: boolean
  /** Тонкий разделитель перед пунктом: начало новой группы */
  group?: boolean
  confirm?: { title: string; text: string; button: string }
  run: () => void
}

/** Боковая шторка со списком действий (как меню Options на PS5). */
function SideMenu({ title, titleAction, header, items, onClose }: { title: string; titleAction?: ReactNode; header?: ReactNode; items: Item[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState<Item | null>(null)

  useSpatialNav(ref, { priority: 30, active: !confirming, onBack: onClose, autoFocus: '.menu-item' })
  useEffect(() => rumble('open'), [])

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
            <Fragment key={item.id}>
              {item.group && <hr className="menu-divider" />}
              <button data-nav className={`menu-item ${item.danger ? 'is-danger' : ''}`} onClick={() => choose(item)}>
                <span className="menu-icon">{item.icon}</span>
                {item.label}
              </button>
            </Fragment>
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

/**
 * Вопрос с двумя кнопками. tone="danger" — опасное действие, фокус на «Отмене»;
 * tone="primary" — предложение что-то поправить, фокус сразу на нём.
 */
export function ConfirmDialog({ title, text, button, cancel, tone = 'danger', onCancel, onConfirm }: {
  title: string
  text: string
  button: string
  cancel?: string
  tone?: 'danger' | 'primary'
  onCancel: () => void
  onConfirm: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useSpatialNav(ref, { priority: 40, onBack: onCancel, autoFocus: tone === 'primary' ? '.btn-primary' : '.btn-glass' })
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
            {cancel ?? t('Отмена')}
          </button>
          <button data-nav className={`btn ${tone === 'primary' ? 'btn-primary' : 'btn-danger'}`} onClick={onConfirm}>
            {button}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/**
 * Ввод короткого текста (название подборки). Поле открывается сразу: с геймпада — экранная клавиатура,
 * с клавиатуры — ввод на месте; Enter или «Готово» на клавиатуре сохраняет.
 */
export function PromptDialog({ title, value = '', placeholder, button, onCancel, onSubmit }: {
  title: string
  value?: string
  placeholder?: string
  button: string
  onCancel: () => void
  onSubmit: (v: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(value)
  const submit = () => {
    const v = text.trim()
    if (!v) return play('bump')
    play('select')
    onSubmit(v)
  }
  useSpatialNav(ref, { priority: 40, onBack: onCancel, autoFocus: 'input' })
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const id = setTimeout(() => (lastInputDevice() === 'keyboard' ? beginEdit(el) : openKeyboard(el)), 120)
    return () => clearTimeout(id)
  }, [])
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
        <input
          ref={inputRef}
          data-nav
          className="input prompt-input"
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          maxLength={40}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <div className="dialog-actions">
          <button data-nav className="btn btn-glass" onClick={onCancel}>
            {t('Отмена')}
          </button>
          <button data-nav className="btn btn-primary" onClick={submit}>
            {button}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/** △ на фишке подборки: переименовать или удалить */
export function CollectionMenu({ collection, all, onClose }: { collection: GameCollection; all: GameCollection[]; onClose: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const items: Item[] = [
    { id: 'rename', label: t('Переименовать'), icon: <IconEdit />, run: () => setRenaming(true) },
    {
      id: 'delete',
      label: t('Удалить подборку'),
      icon: <IconTrash />,
      danger: true,
      confirm: { title: t('Удалить подборку «{name}»?', { name: collection.name }), text: t('Игры останутся в библиотеке, пропадёт только подборка.'), button: t('Удалить') },
      run: () => (onClose(), void deleteCollection(all, collection.id))
    }
  ]
  return (
    <>
      <SideMenu title={collection.name} onClose={onClose} items={items} header={<div className="side-sub">{t('Подборка')} · {gamesInText(collection.games.length)}</div>} />
      <AnimatePresence>
        {renaming && (
          <PromptDialog
            title={t('Новое название')}
            value={collection.name}
            button={t('Сохранить')}
            onCancel={() => setRenaming(false)}
            onSubmit={(name) => {
              void renameCollection(all, collection.id, name)
              onClose()
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

const gamesInText = (n: number) => (n ? t('игр: {n}', { n }) : t('пока пусто'))

/** Отметить, в каких подборках игра; «Новая подборка» сразу кладёт игру в неё */
function CollectionPicker({ game, collections, onClose }: { game: Game; collections: GameCollection[]; onClose: () => void }) {
  const [naming, setNaming] = useState(false)
  const items: Item[] = [
    ...collections.map((c) => {
      const inside = c.games.includes(game.id)
      return {
        id: c.id,
        label: c.name,
        icon: inside ? <IconCheck /> : <span className="menu-check-empty" />,
        run: () => void toggleInCollection(collections, c.id, game.id)
      }
    }),
    { id: 'new', label: t('Новая подборка'), icon: <IconPlus />, run: () => setNaming(true) }
  ]
  return (
    <>
      <SideMenu title={t('Подборки')} onClose={onClose} items={items} header={<div className="side-sub">{game.title}</div>} />
      <AnimatePresence>
        {naming && (
          <PromptDialog
            title={t('Новая подборка')}
            placeholder={t('Например, «Кооператив»')}
            button={t('Создать')}
            onCancel={() => setNaming(false)}
            onSubmit={(name) => {
              createCollection(collections, name, game.id)
              setNaming(false)
            }}
          />
        )}
      </AnimatePresence>
    </>
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
  collections: GameCollection[]
}

export function GameMenu({ game, running, onClose, onLaunch, onCloseGame, onEdit, onTrophies, onInfo, collections }: GameMenuProps) {
  const [picking, setPicking] = useState(false)
  const isRunning = running?.gameId === game.id
  const inCount = collections.filter((c) => c.games.includes(game.id)).length
  const items: Item[] = [
    isRunning
      ? { id: 'close', label: t('Закрыть игру'), icon: <IconClose />, run: () => (onClose(), onCloseGame()) }
      : notInstalled(game)
        ? { id: 'play', label: t('Указать файл игры'), icon: <IconFolder />, run: () => (onClose(), onEdit(game)) }
        : { id: 'play', label: t('Играть'), icon: <IconPlay />, run: () => (onClose(), onLaunch(game)) },
    { id: 'info', label: t('Об игре'), icon: <IconInfo />, run: () => onInfo(game) },
    { id: 'trophies', label: t('Трофеи'), icon: <IconTrophy />, run: () => onTrophies(game) },
    { id: 'edit', label: t('Изменить'), icon: <IconEdit />, group: true, run: () => (onClose(), onEdit(game)) },
    {
      id: 'fav',
      label: game.favorite ? t('Убрать из избранного') : t('Добавить в избранное'),
      icon: <IconStar filled={game.favorite} />,
      run: () => api.setFavorite(game.id, !game.favorite)
    },
    {
      id: 'collections',
      label: inCount ? t('Подборки: {n}', { n: inCount }) : t('Добавить в подборку'),
      icon: <IconGrid />,
      run: () => setPicking(true)
    },
    ...(game.path ? [{ id: 'folder', label: t('Открыть папку игры'), icon: <IconFolder />, group: true, run: () => api.openFolder(game.path) }] : []),
    {
      id: 'reset',
      label: t('Сбросить время игры'),
      icon: <IconReset />,
      group: !game.path,
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
  // Выбор подборок — та же шторка; «Назад» возвращает к параметрам игры
  if (picking) return <CollectionPicker key="pick" game={game} collections={collections} onClose={() => setPicking(false)} />
  return (
    <SideMenu
      key="menu"
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
