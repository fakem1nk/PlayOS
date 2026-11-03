import { useEffect, useRef, useState } from 'react'
import type { DownloadJob, DownloadKind } from '@shared/types'
import { locale, t } from '@shared/i18n'
import { api } from './api'
import { bytes, lastPlayed } from './format'
import { toast } from './state'

/** Какие ссылки PlayOS качает сам — спрашиваем main один раз: торренты, если на месте его торрент-клиент */
let kinds: DownloadKind[] = ['http']
void api
  .downloadKinds()
  .then((k) => (kinds = k))
  .catch(() => {})
export const canDownload = (kind: DownloadKind) => kinds.includes(kind)

/** Очередь загрузок: сразу список, дальше изменения из main */
export function useDownloads(): DownloadJob[] {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  useEffect(() => {
    let alive = true
    void api.downloads().then((l) => alive && setJobs(l))
    const off = api.onDownloads((l) => setJobs(l))
    return () => {
      alive = false
      off()
    }
  }, [])
  return jobs
}

/** Готово, остановилась, установилась — уведомлением: загрузка идёт в фоне, пока пользователь занят другим */
export function useDownloadNotices(jobs: DownloadJob[]) {
  const seen = useRef<Map<string, Pick<DownloadJob, 'status' | 'install'>> | null>(null)
  useEffect(() => {
    const prev = seen.current
    seen.current = new Map(jobs.map((j) => [j.id, { status: j.status, install: j.install }]))
    // Первый список — то, что было до запуска: о нём не напоминаем
    if (!prev) return
    for (const j of jobs) {
      const was = prev.get(j.id)
      if (!was || (was.status === j.status && was.install === j.install)) continue
      // Любое уведомление о загрузке открывает «Загрузки»
      const note = { message: j.title, image: j.cover, open: 'downloads' as const }
      if (was.install === 'running' && j.install === 'installed') toast({ ...note, title: t('Игра установлена'), tone: 'success' })
      else if (was.install === 'running' && j.install === 'manual') toast({ ...note, title: t('Укажите файл игры'), message: t('Не нашли, куда установилась «{title}»', { title: j.title }), tone: 'error' })
      else if (was.install === 'running' && j.installError) toast({ ...note, title: t('Установка не завершилась'), message: `${j.title}: ${j.installError}`, tone: 'error' })
      else if (was.status === j.status) continue
      else if (j.status === 'done' && j.install === 'ready') toast({ ...note, title: t('Можно установить'), tone: 'success' })
      else if (j.status === 'done' && j.install === 'installed') toast({ ...note, title: t('Игра готова'), message: t('«{title}» — можно играть', { title: j.title }), tone: 'success' })
      else if (j.status === 'done') toast({ ...note, title: t('Загрузка завершена'), tone: 'success' })
      else if (j.status === 'error' && j.needPassword) toast({ ...note, title: t('Нужен пароль от архива'), tone: 'error' })
      else if (j.status === 'error') toast({ ...note, title: t('Загрузка остановилась'), message: `${j.title}: ${j.error ?? ''}`, tone: 'error' })
    }
  }, [jobs])
}

/** Доля скачанного (а во время распаковки — распакованного), 0…1; размер неизвестен — 0 */
export const fraction = (j: DownloadJob) =>
  j.phase === 'extracting' && j.unpack?.total ? Math.min(1, j.unpack.done / j.unpack.total) : j.size ? Math.min(1, j.received / j.size) : 0

/** Сколько осталось: «меньше минуты», «6 мин», «1 ч 20 мин» */
export function timeLeft(sec: number): string {
  if (sec < 60) return t('меньше минуты')
  const m = Math.round(sec / 60)
  if (m < 60) return t('{n} мин', { n: m })
  const h = Math.floor(m / 60)
  return t('{h} ч {m} мин', { h, m: m % 60 })
}

/** Строка под названием: сколько из скольких, скорость, сколько осталось */
export function jobLine(j: DownloadJob): string {
  // Уже скачано (ждёт распаковки) — только размер
  const of = j.downloaded ? bytes(j.size) : j.size ? (j.received ? t('{a} / {b}', { a: bytes(j.received), b: bytes(j.size) }) : bytes(j.size)) : j.received ? bytes(j.received) : ''
  switch (j.status) {
    case 'active':
      // Торрент сначала узнаёт список файлов у раздающих, после перезапуска — проверяет уже скачанное
      if (j.phase === 'metadata') return j.peers ? t('Получаем список файлов…') : t('Ищем раздающих…')
      if (j.phase === 'checking') return [t('Проверяем скачанное…'), of].filter(Boolean).join(' · ')
      if (j.phase === 'extracting') return t('Распаковываем архивы…')
      return [of, j.speed ? t('{v}/с', { v: bytes(j.speed) }) : j.kind !== 'http' && !j.peers ? t('Ищем раздающих…') : t('Подключаемся…'), j.speed && j.size ? t('ещё {v}', { v: timeLeft((j.size - j.received) / j.speed) }) : '']
        .filter(Boolean)
        .join(' · ')
    case 'queued':
      return [j.downloaded ? t('Ждёт распаковки') : t('В очереди'), of].filter(Boolean).join(' · ')
    case 'paused':
      return [t('Пауза'), of].filter(Boolean).join(' · ')
    case 'error':
      return j.error ?? t('Загрузка остановилась')
    case 'done':
      if (j.install === 'running') return t('Идёт установка — закончите её в окне установщика')
      if (j.install === 'ready') return [j.installError ?? t('Можно установить'), j.size ? bytes(j.size) : ''].filter(Boolean).join(' · ')
      if (j.install === 'manual') return j.installError ?? t('Не нашли игру — укажите её файл')
      if (j.install === 'installed') return [t('Можно играть'), j.doneAt ? finished(j.doneAt) : ''].filter(Boolean).join(' · ')
      return [j.doneAt ? t('Завершено {when}', { when: finished(j.doneAt) }) : t('Скачано'), j.size ? bytes(j.size) : ''].filter(Boolean).join(' · ')
  }
}

/** Когда скачалось, как в Steam: «сегодня, 10:55» */
const finished = (ts: number) => `${lastPlayed(ts).toLowerCase()}, ${new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`
