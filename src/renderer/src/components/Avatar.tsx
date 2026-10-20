import { useEffect, useState } from 'react'
import { media } from '../lib/format'

/** Аватар пользователя: своя картинка или первая буква имени на градиенте. */
export function Avatar({ name, src, className = '' }: { name: string; src?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const initial = (name.trim()[0] ?? 'P').toUpperCase()
  return (
    <span className={`avatar ${className}`}>
      {src && !failed ? <img src={media(src)} alt="" draggable={false} onError={() => setFailed(true)} /> : initial}
    </span>
  )
}
