import net from 'node:net'

/**
 * Клиент PINE — протокола удалённого управления PCSX2 (TCP 127.0.0.1:28011).
 * Позволяет сохраняться и загружаться в конкретный слот без переключения окон.
 * Формат: [u32 размер всего сообщения][u8 команда][аргументы]; ответ: [u32 размер][u8 0 — успех][данные].
 */

const enum Cmd {
  SaveState = 0x09,
  LoadState = 0x0a,
  Id = 0x0c,
  Status = 0x0f
}

function request(port: number, cmd: number, args: number[] = [], timeout = 1200): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const msg = Buffer.alloc(5 + args.length)
    msg.writeUInt32LE(msg.length, 0)
    msg.writeUInt8(cmd, 4)
    args.forEach((a, i) => msg.writeUInt8(a, 5 + i))
    const sock = net.connect({ host: '127.0.0.1', port })
    let data = Buffer.alloc(0)
    const done = (res: Buffer | null) => {
      clearTimeout(timer)
      sock.destroy()
      resolve(res)
    }
    const timer = setTimeout(() => done(null), timeout)
    sock.on('connect', () => sock.write(msg))
    sock.on('data', (chunk) => {
      data = Buffer.concat([data, chunk as Buffer])
      if (data.length >= 4 && data.length >= data.readUInt32LE(0)) done(data[4] === 0 ? data : null)
    })
    sock.on('error', () => done(null))
  })
}

export type PineStatus = 'running' | 'paused' | 'shutdown'

export async function pineStatus(port: number): Promise<PineStatus | null> {
  const r = await request(port, Cmd.Status, [], 500)
  if (!r || r.length < 9) return null
  return (['running', 'paused', 'shutdown'] as const)[r.readUInt32LE(5)] ?? null
}

/** Серийный номер запущенной игры (SLUS-21269) */
export async function pineGameId(port: number): Promise<string | null> {
  const r = await request(port, Cmd.Id, [], 800)
  if (!r || r.length < 9) return null
  const len = r.readUInt32LE(5)
  return r.toString('utf8', 9, 9 + len).replace(/\0+$/, '').trim() || null
}

export async function pineSave(port: number, slot: number) {
  return (await request(port, Cmd.SaveState, [slot])) !== null
}

export async function pineLoad(port: number, slot: number) {
  return (await request(port, Cmd.LoadState, [slot])) !== null
}
