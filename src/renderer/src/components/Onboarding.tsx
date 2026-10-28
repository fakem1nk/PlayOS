import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { AppState, Settings } from '@shared/types'
import { api } from '../lib/api'
import { accentOf, gamesCount, media } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { toast } from '../lib/state'
import { play } from '../lib/sound'
import { Avatar } from './Avatar'
import { CloudPanel, stateLabel, useCloudStatus } from './Cloud'
import { ActionRow, BrowseButton, Cycler, Field, Toggle } from './Controls'
import { Glyph, GlyphText, type GlyphName } from './Glyph'
import { IconCloud, IconDisc, IconDownload, IconFolder, IconImage } from './Icons'
import { Wordmark } from './Logo'
import { DisplayPicker } from './Settings'
import { getLang, t } from '@shared/i18n'

type Step = 'hello' | 'cloud' | 'games' | 'emulators' | 'screen' | 'done'
const STEPS: { id: Step; label: string; title: string; text: string }[] = [
  { id: 'hello', label: t('Знакомство'), title: t('Добро пожаловать в PlayOS'), text: t('Пара минут — и всё готово. Любую настройку потом можно поменять.') },
  {
    id: 'cloud',
    label: t('Облако'),
    title: t('Облако'),
    text: t('Сохранения, библиотека и профиль на Яндекс Диске, Google Drive или в папке синхронизации. Если PlayOS уже стоял на другом ПК, всё вернётся. Шаг можно пропустить.')
  },
  { id: 'games', label: t('Игры'), title: t('Соберём библиотеку'), text: t('PlayOS сам найдёт игры Steam и образы для эмуляторов. Можно пропустить и добавить игры позже кнопкой {search}.') },
  { id: 'emulators', label: t('Эмуляторы'), title: t('Эмуляторы'), text: t('Для игр PS2 нужен PCSX2, для PS3 — RPCS3. Если чего-то нет, шаг можно пропустить.') },
  { id: 'screen', label: t('Экран'), title: t('Экран и звук'), text: t('Издалека, с дивана, удобнее крупный интерфейс. Он меняется прямо на картинке слева.') },
  { id: 'done', label: t('Готово'), title: t('Всё готово'), text: t('Вот кнопки, которые пригодятся чаще всего.') }
]

const greeting = () => {
  const h = new Date().getHours()
  return h >= 5 && h < 12 ? t('Доброе утро') : h < 17 && h >= 12 ? t('Добрый день') : h < 23 && h >= 17 ? t('Добрый вечер') : t('Доброй ночи')
}

interface Props {
  state: AppState
  onSteamImport: () => void
  /** Пока поверх открыт импорт Steam — мастер не забирает ввод */
  paused: boolean
}

/** Мастер первого запуска: слева живая иллюстрация шага, справа настройки, внизу шаги с подписями. */
export function Onboarding({ state, onSteamImport, paused }: Props) {
  const [i, setI] = useState(0)
  const [dir, setDir] = useState(1)
  const ref = useRef<HTMLDivElement>(null)
  const s = state.settings
  const step = STEPS[i]
  const save = (patch: Partial<Settings>) => api.saveSettings(patch)
  // Цвета последних игр — для сияния фона; без игр — фирменные
  const palette = [...new Set(state.games.map((g) => g.accent).filter(Boolean) as string[]), '#3d8bff', '#8a5cff', '#3fd0ff'].slice(0, 3)

  const go = (d: number) => {
    if (!STEPS[i + d]) return
    play(d > 0 ? 'select' : 'back')
    setDir(d)
    setI(i + d)
  }
  const finish = () => {
    play('launch')
    void save({ onboarded: true })
  }

  useSpatialNav(ref, {
    priority: 22,
    active: !paused,
    // ○ — шаг назад; на первом шаге ничего не делает, чтобы мастер не закрылся случайно
    onBack: () => i > 0 && go(-1),
    autoFocus: '.wiz-next',
    focusKey: i
  })

  const run = async (fn: () => Promise<number>, what: string) => {
    try {
      const n = await fn()
      toast({ title: what, message: n ? t('Добавлено: {v}', { v: gamesCount(n) }) : t('Новых игр не найдено'), tone: n ? 'success' : 'info', history: false })
    } catch (e) {
      toast({ title: what, message: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), tone: 'error' })
    }
  }
  const pickAvatar = async () => {
    const p = await api.pickFile('image')
    if (p) await save({ avatar: p })
  }
  const browse = async (key: 'pcsx2Path' | 'rpcs3Path') => {
    const p = await api.pickFile('emulator')
    if (p) await save({ [key]: p })
  }

  const style = { '--a1': palette[0], '--a2': palette[1], '--a3': palette[2] } as React.CSSProperties

  return (
    <motion.div className="wiz" style={style} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transform: 'scale(1.03)', transition: { duration: 0.45 } }}>
      <div className="wiz-aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>

      <div className="wiz-frame" ref={ref}>
        <header className="wiz-top">
          <span className="wiz-brand">
            <Wordmark className="wiz-wordmark" />
          </span>
          <span className="wiz-counter">
            {t('Шаг {n} из {total}', { n: i + 1, total: STEPS.length })}
          </span>
        </header>

        <motion.div
          key={step.id}
          className="wiz-stage"
          initial={{ opacity: 0, transform: `translateX(${dir * 4}rem)` }}
          animate={{ opacity: 1, transform: 'translateX(0rem)' }}
          transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
        >
          <div className="wiz-visual" aria-hidden>
            {step.id === 'hello' && <HelloArt name={s.userName} avatar={s.avatar} />}
            {step.id === 'cloud' && <CloudArt />}
            {step.id === 'games' && <GamesArt state={state} />}
            {step.id === 'emulators' && <EmuArt pcsx2={s.pcsx2Path} rpcs3={s.rpcs3Path} />}
            {step.id === 'screen' && <ScreenArt scale={s.uiScale} />}
            {step.id === 'done' && <ButtonsArt />}
          </div>

          <div className="wiz-panel">
            <h1 className="wiz-title">{step.title}</h1>
            <p className="wiz-text">
              <GlyphText text={step.text} />
            </p>
            <div className="wiz-controls">
              {step.id === 'hello' && (
                <>
                  <Cycler
                    label="Language · Язык"
                    value={s.language ?? getLang()}
                    options={[
                      { id: 'en', label: 'English' },
                      { id: 'ru', label: 'Русский' }
                    ]}
                    onChange={(v) => {
                      try {
                        // После перезагрузки окна сразу возвращаемся в мастер, без интро
                        sessionStorage.setItem('playos-skip-intro', '1')
                      } catch {
                        /* без хранилища просто покажем интро ещё раз */
                      }
                      void save({ language: v }).then(() => {
                        // В браузерном превью окно перезагружаем сами, в PlayOS это делает main-процесс
                        if (!('pcsLang' in window)) location.search = `?lang=${v}&welcome`
                      })
                    }}
                  />
                  <Field label={t('Как вас зовут')} value={s.userName} onCommit={(v) => save({ userName: v.trim() || t('Игрок') })} />
                  <ActionRow label={t('Аватар')} hint={t('Любая картинка, обрежется по кругу')} button={t('Выбрать картинку')} icon={<IconImage />} onClick={pickAvatar} />
                </>
              )}
              {step.id === 'cloud' && <CloudPanel s={s} save={save} compact />}
              {step.id === 'games' && (
                <>
                  <ActionRow label={t('Игры Steam')} hint={t('Установленные игры со всех дисков')} button={t('Выбрать игры')} icon={<IconDownload />} onClick={onSteamImport} />
                  <ActionRow label={t('Образы PS2')} hint={t('Папка с ISO, CHD, CSO')} button={t('Выбрать папку')} icon={<IconFolder />} onClick={() => run(api.scanPs2Folder, t('Сканирование PS2'))} />
                  <ActionRow label={t('Игры RPCS3')} hint={t('Список игр RPCS3 и dev_hdd0')} button={t('Импортировать')} onClick={() => run(api.importRpcs3, t('Импорт RPCS3'))} />
                </>
              )}
              {step.id === 'emulators' && (
                <>
                  <Field label={t('PCSX2: путь к pcsx2-qt.exe')} value={s.pcsx2Path} onCommit={(v) => save({ pcsx2Path: v })} mono>
                    <BrowseButton onClick={() => browse('pcsx2Path')} />
                  </Field>
                  <Field label={t('RPCS3: путь к rpcs3.exe')} value={s.rpcs3Path} placeholder={t('Не указан')} onCommit={(v) => save({ rpcs3Path: v })} mono>
                    <BrowseButton onClick={() => browse('rpcs3Path')} />
                  </Field>
                </>
              )}
              {step.id === 'screen' && (
                <>
                  <DisplayPicker s={s} save={save} />
                  <Cycler
                    label={t('Масштаб интерфейса')}
                    value={String(s.uiScale)}
                    options={[
                      { id: '0.9', label: '90%' },
                      { id: '1', label: '100%' },
                      { id: '1.1', label: '110%' },
                      { id: '1.2', label: '120%' },
                      { id: '1.25', label: '125%' }
                    ]}
                    onChange={(v) => save({ uiScale: Number(v) })}
                  />
                  <Toggle label={t('Звуки интерфейса')} value={s.sounds} onChange={(v) => save({ sounds: v })} />
                  <Toggle label={t('Фоновая музыка')} value={s.music} onChange={(v) => save({ music: v })} />
                </>
              )}
              {step.id === 'done' && (
                <p className="wiz-note">
                  <GlyphText text={t('Мастер больше не появится. Всё, что вы здесь выбрали, живёт в «Настройках», а игры добавляются кнопкой {search} на главном экране.')} />
                </p>
              )}
            </div>
          </div>
        </motion.div>

        <footer className="wiz-bottom">
          <ol className="wiz-steps">
            {STEPS.map((x, k) => (
              <li key={x.id} className={k === i ? 'is-current' : k < i ? 'is-done' : ''}>
                <span className="wiz-step-bar">
                  <span />
                </span>
                {x.label}
              </li>
            ))}
          </ol>
          <span className="wiz-buttons">
            {i > 0 ? (
              <button data-nav className="btn btn-glass" onClick={() => go(-1)}>
                {t('Назад')}
              </button>
            ) : (
              <button data-nav className="btn btn-glass" onClick={finish}>
                {t('Пропустить')}
              </button>
            )}
            <button data-nav className="btn btn-primary wiz-next" onClick={() => (step.id === 'done' ? finish() : go(1))}>
              {step.id === 'done' ? t('Начать играть') : t('Далее')}
            </button>
          </span>
        </footer>
      </div>
    </motion.div>
  )
}

/** Аватар с переливающимся кольцом и приветствие — имя меняется вместе с полем справа */
function HelloArt({ name, avatar }: { name: string; avatar?: string }) {
  return (
    <div className="wiz-hello">
      <div className="wiz-avatar">
        <span className="wiz-avatar-ring" />
        <Avatar name={name} src={avatar} className="avatar-xl" />
      </div>
      <div className="wiz-hello-greet">{greeting()},</div>
      <div className="wiz-hello-name">{name}</div>
    </div>
  )
}

/** Облако с устройствами вокруг: светится, когда вход выполнен */
function CloudArt() {
  const status = useCloudStatus()
  const account = status?.account
  return (
    <div className={`wiz-cloud ${account ? 'is-on' : ''}`}>
      <span className="wiz-cloud-orb">
        <IconCloud />
      </span>
      <span className="wiz-cloud-title">{account ? account.name : t('Облако не подключено')}</span>
      <span className="wiz-cloud-state">{account && status ? stateLabel(status.state, status.lastSync) : t('Сохранения останутся только на этом ПК')}</span>
    </div>
  )
}

/** Веер обложек из библиотеки (или заготовки PC / PS2 / PS3) и счётчик игр */
function GamesArt({ state }: { state: AppState }) {
  const covers = [...state.games].filter((g) => g.cover).sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt)).slice(0, 5)
  const cards = covers.length >= 3 ? covers : null
  const n = cards ? cards.length : 3
  return (
    <div className="wiz-games">
      <div className="wiz-fan">
        {Array.from({ length: n }, (_, k) => {
          const mid = (n - 1) / 2
          const g = cards?.[k]
          return (
            <span
              key={g?.id ?? k}
              className="wiz-fan-card"
              style={{
                transform: `translateX(${(k - mid) * 10.5}rem) translateY(${Math.abs(k - mid) * 2}rem) rotate(${(k - mid) * 8}deg)`,
                zIndex: 10 - Math.abs(Math.round(k - mid)),
                animationDelay: `${k * 0.25}s`,
                '--glow': g ? accentOf(g) : undefined
              } as React.CSSProperties}
            >
              {g ? <img src={media(g.cover, 'tile')} alt="" /> : <span className="wiz-fan-blank">{['PC', 'PS2', 'PS3'][k]}</span>}
            </span>
          )
        })}
      </div>
      <div className="wiz-games-count">{state.games.length ? gamesCount(state.games.length) : t('Библиотека пока пуста')}</div>
    </div>
  )
}

/** Диски PS2 и PS3: крутятся, если эмулятор найден */
function EmuArt({ pcsx2, rpcs3 }: { pcsx2: string; rpcs3: string }) {
  const [found, setFound] = useState<{ ps2: boolean; ps3: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([api.pathExists(pcsx2), api.pathExists(rpcs3)]).then(([ps2, ps3]) => alive && setFound({ ps2, ps3 }))
    return () => {
      alive = false
    }
  }, [pcsx2, rpcs3])
  const disc = (label: string, emu: string, ok: boolean | undefined, empty: boolean) => (
    <div className={`wiz-disc ${ok ? 'is-ok' : ''}`}>
      <span className="wiz-disc-icon">
        <IconDisc />
      </span>
      <span className="wiz-disc-label">{label}</span>
      <span className="wiz-disc-emu">{emu}</span>
      <span className={`wiz-disc-status ${ok ? 'is-ok' : ''}`}>{ok === undefined ? t('Проверяем…') : ok ? t('Найден') : empty ? t('Не указан') : t('Не найден')}</span>
    </div>
  )
  return (
    <div className="wiz-emus">
      {disc('PlayStation 2', 'PCSX2', found?.ps2, !pcsx2)}
      {disc('PlayStation 3', 'RPCS3', found?.ps3, !rpcs3)}
    </div>
  )
}

/** Телевизор с уменьшенным интерфейсом: плитки растут вместе с масштабом */
function ScreenArt({ scale }: { scale: number }) {
  return (
    <div className="wiz-tv">
      <div className="wiz-tv-screen">
        <div className="wiz-tv-ui" style={{ transform: `scale(${scale})` }}>
          <span className="wiz-tv-bar" />
          <span className="wiz-tv-row">
            {Array.from({ length: 5 }, (_, k) => (
              <i key={k} className={k === 0 ? 'is-focus' : ''} />
            ))}
          </span>
          <span className="wiz-tv-lines">
            <i />
            <i />
          </span>
        </div>
      </div>
      <span className="wiz-tv-stand" />
      <span className="wiz-tv-label">{Math.round(scale * 100)}%</span>
    </div>
  )
}

const BUTTONS: { glyph: GlyphName; label: string }[] = [
  { glyph: 'confirm', label: t('Играть и выбирать') },
  { glyph: 'back', label: t('Назад') },
  { glyph: 'menu', label: t('Об игре') },
  { glyph: 'options', label: t('Параметры игры') },
  { glyph: 'search', label: t('Добавить игру') },
  { glyph: 'r1', label: t('Вкладки') },
  { glyph: 'guide', label: t('Меню поверх игры') }
]

/** Главные кнопки карточками — появляются по очереди */
function ButtonsArt() {
  return (
    <div className="wiz-keys">
      {BUTTONS.map((b, k) => (
        <motion.div
          key={b.label}
          className="wiz-key"
          initial={{ opacity: 0, transform: 'translateY(1.6rem) scale(0.96)' }}
          animate={{ opacity: 1, transform: 'translateY(0rem) scale(1)' }}
          transition={{ duration: 0.4, delay: 0.08 * k, ease: [0.23, 1, 0.32, 1] }}
        >
          <span className="wiz-key-glyph">
            <Glyph name={b.glyph} />
          </span>
          <span className="wiz-key-label">{b.label}</span>
        </motion.div>
      ))}
    </div>
  )
}
