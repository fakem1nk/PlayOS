import { useEffect, useRef, useState } from 'react'
import type { DownloadJob, DownloadKind } from '@shared/types'
import { t } from '@shared/i18n'
import { api } from './api'
import { bytes } from './format'
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

/** Готово и остановилась — уведомлением: загрузка идёт в фоне, пока пользователь занят другим */
export function useDownloadNotices(jobs: DownloadJob[]) {
  const seen = useRef<Map<string, DownloadJob['status']> | null>(null)
  useEffect(() => {
    const prev = seen.current
    seen.current = new Map(jobs.map((j) => [j.id, j.status]))
    // Первый список — то, что было до запуска: о нём не напоминаем
    if (!prev) return
    for (const j of jobs) {
      const was = prev.get(j.id)
      if (!was || was === j.status) continue
      if (j.status === 'done') toast({ title: t('Загрузка завершена'), message: j.title, image: j.cover, tone: 'success' })
      else if (j.status === 'error') toast({ title: t('Загрузка остановилась'), message: `${j.title}: ${j.error ?? ''}`, image: j.cover, tone: 'error' })
    }
  }, [jobs])
}

/** Доля скачанного, 0…1; размер неизвестен — 0 */
export const fraction = (j: DownloadJob) => (j.size ? Math.min(1, j.received / j.size) : 0)

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
  const of = j.size ? (j.received ? t('{a} / {b}', { a: bytes(j.received), b: bytes(j.size) }) : bytes(j.size)) : j.received ? bytes(j.received) : ''
  switch (j.status) {
    case 'active':
      // Торрент сначала узнаёт список файлов у раздающих, после перезапуска — проверяет уже скачанное
      if (j.phase === 'metadata') return j.peers ? t('Получаем список файлов…') : t('Ищем раздающих…')
      if (j.phase === 'checking') return [t('Проверяем скачанное…'), of].filter(Boolean).join(' · ')
      return [of, j.speed ? t('{v}/с', { v: bytes(j.speed) }) : j.kind !== 'http' && !j.peers ? t('Ищем раздающих…') : t('Подключаемся…'), j.speed && j.size ? t('ещё {v}', { v: timeLeft((j.size - j.received) / j.speed) }) : '']
        .filter(Boolean)
        .join(' · ')
    case 'queued':
      return [t('В очереди'), of].filter(Boolean).join(' · ')
    case 'paused':
      return [t('Пауза'), of].filter(Boolean).join(' · ')
    case 'error':
      return j.error ?? t('Загрузка остановилась')
    case 'done':
      return [t('Скачано'), j.size ? bytes(j.size) : ''].filter(Boolean).join(' · ')
  }
}
