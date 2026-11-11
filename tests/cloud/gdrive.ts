// Клиент Google Drive против локальной копии API (запросы q, папки, multipart, PATCH, alt=media, about)
import { app, net } from 'electron'
import http from 'node:http'

type F = { id: string; name: string; parents: string[]; mimeType: string; data: Buffer; modifiedTime: string }
const files = new Map<string, F>()
let n = 0
const log: string[] = []

function matchQ(q: string, f: F) {
  // Поддерживаем ровно те условия, что строит клиент
  const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1')
  const parent = /'((?:[^'\\]|\\.)*)' in parents/.exec(q)![1]
  const folderEq = /mimeType = 'application\/vnd.google-apps.folder'/.test(q)
  const folderNe = /mimeType != 'application\/vnd.google-apps.folder'/.test(q)
  if (!/trashed = false/.test(q)) throw new Error('no trashed filter')
  const isFolder = f.mimeType === 'application/vnd.google-apps.folder'
  return (name === undefined || f.name === name) && f.parents.includes(parent) && (!folderEq || isFolder) && (!folderNe || !isFolder)
}

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const url = new URL(req.url!, 'http://x')
    const send = (code: number, obj?: unknown, raw?: Buffer) => {
      res.writeHead(code, { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' })
      res.end(raw ?? (obj ? JSON.stringify(obj) : ''))
    }
    if (req.headers.authorization !== 'Bearer tok') return send(401)
    log.push(`${req.method} ${url.pathname}${url.searchParams.get('uploadType') ? '?' + url.searchParams.get('uploadType') : ''}`)
    const m = /^\/(upload\/)?drive\/v3\/(files|about)(?:\/([^/]+))?$/.exec(url.pathname)
    if (!m) return send(404)
    const [, upload, kind, id] = m
    const now = new Date(Date.now() + n * 1000).toISOString()
    if (kind === 'about') return send(200, { user: { displayName: 'Тест' }, storageQuota: { limit: '1000', usage: '10' } })
    if (req.method === 'GET' && !id) {
      if (url.searchParams.get('spaces') !== 'drive') return send(400)
      const q = url.searchParams.get('q')!
      const list = [...files.values()].filter((f) => matchQ(q, f)).map((f) => ({ id: f.id, name: f.name, size: String(f.data.length), modifiedTime: f.modifiedTime }))
      return send(200, { files: list })
    }
    if (req.method === 'GET' && id) return url.searchParams.get('alt') === 'media' && files.has(id) ? send(200, undefined, files.get(id)!.data) : send(404)
    if (req.method === 'DELETE') return files.delete(id!) ? send(204) : send(404)
    if (req.method === 'PATCH' && upload && url.searchParams.get('uploadType') === 'media') {
      const f = files.get(id!)
      if (!f) return send(404)
      f.data = body
      f.modifiedTime = now
      return send(200, { id })
    }
    if (req.method === 'POST' && !upload) {
      const meta = JSON.parse(body.toString())
      const f = { id: 'id' + ++n, name: meta.name, parents: meta.parents, mimeType: meta.mimeType, data: Buffer.alloc(0), modifiedTime: now }
      files.set(f.id, f)
      return send(200, { id: f.id })
    }
    if (req.method === 'POST' && upload && url.searchParams.get('uploadType') === 'multipart') {
      const boundary = /boundary=(.+)$/.exec(req.headers['content-type']!)![1]
      const text = body.toString('latin1')
      const parts = text.split(`--${boundary}`)
      if (!text.endsWith(`--${boundary}--`)) return send(400, { error: 'bad close' })
      const [h1, b1] = parts[1].split('\r\n\r\n')
      const [, b2] = parts[2].split('\r\n\r\n')
      if (!/application\/json/.test(h1)) return send(400)
      const meta = JSON.parse(Buffer.from(b1.trim(), 'latin1').toString('utf8'))
      const data = Buffer.from(b2.slice(0, -2), 'latin1')
      const f = { id: 'id' + ++n, name: meta.name, parents: meta.parents, mimeType: 'application/octet-stream', data, modifiedTime: now }
      files.set(f.id, f)
      return send(200, { id: f.id })
    }
    send(400)
  })
})

app.whenReady().then(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  const orig = net.fetch.bind(net)
  ;(net as unknown as { fetch: typeof net.fetch }).fetch = (u: string | Request, init?: RequestInit) =>
    orig(String(u).replace('https://www.googleapis.com', `http://127.0.0.1:${port}`), init)
  const { googleRemote } = await import('@main/cloud/remote')
  const r = googleRemote(async () => 'tok')
  const out: Record<string, unknown> = {}
  try {
    const bin = Buffer.from([0, 1, 2, 13, 10, 45, 45, 255, 0x50, 0x4b])
    await r.write('saves/ps2_SLUS-20312/1_ab_cd.zip', bin)
    await r.write("devices/it's.json", Buffer.from('{"a":"ё"}'))
    out.listSaves = (await r.list('saves/ps2_SLUS-20312')).map((e) => `${e.name}:${e.size}`)
    out.binaryOk = (await r.read('saves/ps2_SLUS-20312/1_ab_cd.zip')).equals(bin)
    out.quoteOk = (await r.read("devices/it's.json")).toString() === '{"a":"ё"}'
    await r.write("devices/it's.json", Buffer.from('{"a":2}'))
    out.overwrite = (await r.read("devices/it's.json")).toString()
    out.devices = (await r.list('devices')).length
    out.missingDir = (await r.list('nope/deeper')).length
    await r.remove('saves/ps2_SLUS-20312/1_ab_cd.zip')
    out.afterRemove = (await r.list('saves/ps2_SLUS-20312')).length
    out.folders = [...files.values()].filter((f) => f.mimeType.endsWith('folder')).map((f) => f.name)
    out.account = await r.account()
  } catch (e) {
    out.error = (e as Error).stack
  }
  out.requests = log.length
  console.log('RESULT ' + JSON.stringify(out))
  server.close()
  app.exit(0)
})
