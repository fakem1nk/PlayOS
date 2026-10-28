import type { GameCollection } from '@shared/types'
import { api } from './api'

/** Подборки игр («плейлисты»): хранятся в настройках, правка — целым списком */

const save = (collections: GameCollection[]) => api.saveSettings({ collections })

export function createCollection(list: GameCollection[], name: string, firstGame?: string) {
  const c: GameCollection = { id: Math.random().toString(36).slice(2, 10), name, games: firstGame ? [firstGame] : [] }
  void save([...list, c])
  return c
}

export const renameCollection = (list: GameCollection[], id: string, name: string) =>
  save(list.map((c) => (c.id === id ? { ...c, name } : c)))

export const deleteCollection = (list: GameCollection[], id: string) => save(list.filter((c) => c.id !== id))

/** Добавить игру в подборку или убрать из неё; новые игры встают в конец */
export const toggleInCollection = (list: GameCollection[], id: string, gameId: string) =>
  save(list.map((c) => (c.id !== id ? c : { ...c, games: c.games.includes(gameId) ? c.games.filter((g) => g !== gameId) : [...c.games, gameId] })))
