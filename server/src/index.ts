import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { AccessToken } from 'livekit-server-sdk'

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback
  if (v === undefined) throw new Error(`Variável de ambiente ${key} ausente`)
  return v
}

const LIVEKIT_URL = env('LIVEKIT_URL', 'ws://localhost:7880')
const LIVEKIT_KEY = env('LIVEKIT_API_KEY', 'devkey')
const LIVEKIT_SECRET = env('LIVEKIT_API_SECRET', 'secret')
const WEB_ORIGINS = new Set(env('WEB_ORIGINS', 'http://localhost:5173').split(','))
const SESSION_MS = 30 * 24 * 3600_000

const NAME_RE = /^[a-z0-9_]{3,32}$/
const ROOM_RE = /^[a-z0-9-]{1,32}$/

const db = new DatabaseSync(env('DB_PATH', 'lobby.db'))
db.exec(`
  create table if not exists users (name text primary key, hash text not null);
  create table if not exists sessions (
    token text primary key,
    name text not null references users(name),
    created integer not null
  );
`)

const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>

async function hashPassword(pw: string) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${(await scryptAsync(pw, salt, 64)).toString('hex')}`
}

async function checkPassword(pw: string, stored: string) {
  const [salt, hex] = stored.split(':')
  return timingSafeEqual(await scryptAsync(pw, salt, 64), Buffer.from(hex, 'hex'))
}

function newSession(name: string) {
  const token = randomBytes(32).toString('base64url')
  db.prepare('insert into sessions values (?, ?, ?)').run(token, name, Date.now())
  return token
}

function sessionUser(req: IncomingMessage): string | null {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  if (!token) return null
  const row = db.prepare('select name from sessions where token = ? and created > ?')
    .get(token, Date.now() - SESSION_MS) as { name: string } | undefined
  return row?.name ?? null
}

// ponytail: limite em memória por IP, só vale para um processo; usar Redis se escalar horizontalmente
const attempts = new Map<string, { count: number; reset: number }>()
function rateLimited(ip: string) {
  const now = Date.now()
  const a = attempts.get(ip)
  if (!a || a.reset < now) { attempts.set(ip, { count: 1, reset: now + 60_000 }); return false }
  return ++a.count > 10
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 10_000) throw new HttpError(413, 'Corpo grande demais')
  }
  try {
    const body = JSON.parse(raw || '{}')
    if (typeof body !== 'object' || body === null) throw 0
    return body
  } catch {
    throw new HttpError(400, 'JSON inválido')
  }
}

function credentials(body: Record<string, unknown>) {
  const { name, password } = body
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new HttpError(400, 'Nome: 3-32 caracteres a-z, 0-9, _')
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new HttpError(400, 'Senha: 8-200 caracteres')
  return { name, password }
}

async function route(req: IncomingMessage): Promise<[number, object]> {
  const path = `${req.method} ${new URL(req.url ?? '/', 'http://x').pathname}`

  if (path === 'POST /register' || path === 'POST /login') {
    if (rateLimited(req.socket.remoteAddress ?? '')) throw new HttpError(429, 'Muitas tentativas, aguarde 1 minuto')
    const { name, password } = credentials(await readJson(req))
    const user = db.prepare('select hash from users where name = ?').get(name) as { hash: string } | undefined

    if (path === 'POST /register') {
      if (user) throw new HttpError(409, 'Nome já em uso')
      db.prepare('insert into users values (?, ?)').run(name, await hashPassword(password))
    } else if (!user || !(await checkPassword(password, user.hash))) {
      throw new HttpError(401, 'Nome ou senha incorretos')
    }
    return [200, { name, session: newSession(name) }]
  }

  const name = sessionUser(req)
  if (!name) throw new HttpError(401, 'Não autenticado')

  if (path === 'GET /me') return [200, { name }]

  if (path === 'POST /logout') {
    db.prepare('delete from sessions where token = ?').run(req.headers.authorization!.slice(7))
    return [200, {}]
  }

  if (path === 'POST /livekit-token') {
    const { room } = await readJson(req)
    if (typeof room !== 'string' || !ROOM_RE.test(room)) throw new HttpError(400, 'Sala inválida')
    const at = new AccessToken(LIVEKIT_KEY, LIVEKIT_SECRET, { identity: name, ttl: '6h' })
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true })
    return [200, { url: LIVEKIT_URL, token: await at.toJwt() }]
  }

  throw new HttpError(404, 'Rota não encontrada')
}

export const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const origin = req.headers.origin
  if (origin && WEB_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  let status: number, body: object
  try {
    [status, body] = await route(req)
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e)
    status = e instanceof HttpError ? e.status : 500
    body = { error: e instanceof HttpError ? e.message : 'Erro interno' }
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
})

if (import.meta.main) {
  const port = Number(env('PORT', '3001'))
  server.listen(port, () => console.log(`API em http://localhost:${port}`))
}
