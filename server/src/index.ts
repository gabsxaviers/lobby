import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import postgres from 'postgres'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk'

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback
  if (v === undefined) throw new Error(`Variável de ambiente ${key} ausente`)
  return v
}

const LIVEKIT_URL = env('LIVEKIT_URL', 'ws://localhost:7880')
const LIVEKIT_KEY = env('LIVEKIT_API_KEY', 'devkey')
const LIVEKIT_SECRET = env('LIVEKIT_API_SECRET', 'secret')
// Endereço do LiveKit visto pela API (no Docker é http://livekit:7880, não localhost)
const LIVEKIT_HOST = env('LIVEKIT_HOST', LIVEKIT_URL.replace(/^ws/, 'http'))
const roomService = new RoomServiceClient(LIVEKIT_HOST, LIVEKIT_KEY, LIVEKIT_SECRET)
const WEB_ORIGINS = new Set(env('WEB_ORIGINS', 'http://localhost:5173').split(','))

const NAME_RE = /^[a-z0-9_]{3,32}$/
const ROOM_RE = /^[a-z0-9-]{1,32}$/

// Postgres local (docker-compose) ou Neon em produção; só muda a DATABASE_URL
export const sql = postgres(env('DATABASE_URL', 'postgres://lobby:lobby@localhost:5433/lobby'), { onnotice: () => {} })
await sql`
  create table if not exists users (name text primary key, hash text not null)
`
await sql`
  create table if not exists sessions (
    token text primary key,
    name text not null references users(name) on delete cascade,
    created timestamptz not null default now()
  )
`

const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>

async function hashPassword(pw: string) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${(await scryptAsync(pw, salt, 64)).toString('hex')}`
}

async function checkPassword(pw: string, stored: string) {
  const [salt, hex] = stored.split(':')
  return timingSafeEqual(await scryptAsync(pw, salt, 64), Buffer.from(hex, 'hex'))
}

async function newSession(name: string) {
  const token = randomBytes(32).toString('base64url')
  await sql`insert into sessions (token, name) values (${token}, ${name})`
  return token
}

function bearer(req: IncomingMessage) {
  return req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
}

async function sessionUser(req: IncomingMessage): Promise<string | null> {
  const token = bearer(req)
  if (!token) return null
  const [row] = await sql<{ name: string }[]>`
    select name from sessions where token = ${token} and created > now() - interval '30 days'
  `
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
  let body: unknown
  try {
    if ('body' in req) {
      body = req.body ?? {} // Vercel: o corpo já vem lido e parseado em req.body
    } else {
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > 10_000) throw new HttpError(413, 'Corpo grande demais')
      }
      body = JSON.parse(raw || '{}')
    }
  } catch (e) {
    throw e instanceof HttpError ? e : new HttpError(400, 'JSON inválido')
  }
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'JSON inválido')
  return body as Record<string, unknown>
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
    // Na Vercel o socket é o proxy; o IP real vem no x-forwarded-for (preenchido pela própria Vercel)
    const ip = process.env.VERCEL ? String(req.headers['x-forwarded-for']).split(',')[0] : req.socket.remoteAddress
    if (rateLimited(ip ?? '')) throw new HttpError(429, 'Muitas tentativas, aguarde 1 minuto')
    const { name, password } = credentials(await readJson(req))
    if (path === 'POST /register') {
      // on conflict evita corrida entre dois cadastros simultâneos com o mesmo nome
      const created = await sql`
        insert into users (name, hash) values (${name}, ${await hashPassword(password)})
        on conflict do nothing returning name
      `
      if (created.length === 0) throw new HttpError(409, 'Nome já em uso')
    } else {
      const [user] = await sql<{ hash: string }[]>`select hash from users where name = ${name}`
      if (!user || !(await checkPassword(password, user.hash))) throw new HttpError(401, 'Nome ou senha incorretos')
    }
    return [200, { name, session: await newSession(name) }]
  }

  const name = await sessionUser(req)
  if (!name) throw new HttpError(401, 'Não autenticado')

  if (path === 'GET /me') return [200, { name }]

  // { geral: [{ name, muted, screen }], ... } só com salas que têm alguém
  if (path === 'GET /presence') {
    const rooms = await roomService.listRooms()
    const entries = await Promise.all(rooms.map(async (r) => {
      const people = (await roomService.listParticipants(r.name)).map((p) => {
        const mic = p.tracks.find((t) => t.source === TrackSource.MICROPHONE)
        return {
          name: p.identity,
          muted: !mic || mic.muted,
          screen: p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE),
        }
      })
      return [r.name, people] as const
    }))
    return [200, Object.fromEntries(entries.filter(([, people]) => people.length > 0))]
  }

  if (path === 'POST /logout') {
    await sql`delete from sessions where token = ${bearer(req)!}`
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

// Mesmo handler no servidor local (createServer abaixo) e na função da Vercel (api/index.ts)
export async function handler(req: IncomingMessage, res: ServerResponse) {
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
}

export const server = createServer(handler)

if (import.meta.main) {
  const port = Number(env('PORT', '3001'))
  server.listen(port, () => console.log(`API em http://localhost:${port}`))
}
