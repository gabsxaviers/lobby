import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import postgres from 'postgres'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource } from 'livekit-server-sdk'

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
// ponytail: lista fixa, igual à do front (web/src/App.tsx); virar tabela quando houver criação de canais
const CHANNELS = new Set(['geral', 'jogos', 'estudo'])
const isChannel = (c: unknown): c is string => typeof c === 'string' && CHANNELS.has(c)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
// E-mail opcional no banco: contas criadas antes dele continuam válidas. Único quando presente.
await sql`alter table users add column if not exists email text`
await sql`create unique index if not exists users_email_key on users (email)`
await sql`
  create table if not exists messages (
    id bigserial primary key,
    channel text not null,
    author text not null references users(name) on delete cascade,
    body text not null,
    created timestamptz not null default now()
  )
`
await sql`create index if not exists messages_channel_id on messages (channel, id)`

type Message = { id: string; channel: string; author: string; body: string; created: Date }

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
function rateLimited(key: string, maxPerMinute: number) {
  const now = Date.now()
  const a = attempts.get(key)
  if (!a || a.reset < now) { attempts.set(key, { count: 1, reset: now + 60_000 }); return false }
  return ++a.count > maxPerMinute
}

// Na Vercel o socket é o proxy; o IP real vem no x-forwarded-for (preenchido pela própria Vercel)
function clientIp(req: IncomingMessage) {
  return (process.env.VERCEL ? String(req.headers['x-forwarded-for']).split(',')[0] : req.socket.remoteAddress) ?? ''
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

function validName(name: unknown): name is string {
  return typeof name === 'string' && NAME_RE.test(name)
}

function password(body: Record<string, unknown>) {
  const { password } = body
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new HttpError(400, 'Senha: 8-200 caracteres')
  return password
}

async function route(req: IncomingMessage): Promise<[number, object]> {
  const url = new URL(req.url ?? '/', 'http://x')
  const path = `${req.method} ${url.pathname}`

  if (path === 'GET /check-name') {
    // Folga maior que no login: é chamado enquanto a pessoa digita
    if (rateLimited(`check:${clientIp(req)}`, 60)) throw new HttpError(429, 'Muitas consultas, aguarde 1 minuto')
    const name = url.searchParams.get('name')
    if (!validName(name)) throw new HttpError(400, 'Nome: 3-32 caracteres a-z, 0-9, _')
    const [taken] = await sql`select 1 from users where name = ${name}`
    return [200, { available: !taken }]
  }

  if (path === 'POST /register') {
    if (rateLimited(`auth:${clientIp(req)}`, 10)) throw new HttpError(429, 'Muitas tentativas, aguarde 1 minuto')
    const body = await readJson(req)
    const { name } = body
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!validName(name)) throw new HttpError(400, 'Nome: 3-32 caracteres a-z, 0-9, _')
    if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, 'E-mail inválido')
    const hash = await hashPassword(password(body))
    try {
      await sql`insert into users (name, email, hash) values (${name}, ${email}, ${hash})`
    } catch (e) {
      // As restrições do banco resolvem corridas entre cadastros simultâneos
      if (e instanceof postgres.PostgresError && e.code === '23505') {
        throw new HttpError(409, e.constraint_name === 'users_email_key' ? 'E-mail já cadastrado' : 'Nome já em uso')
      }
      throw e
    }
    return [200, { name, session: await newSession(name) }]
  }

  if (path === 'POST /login') {
    if (rateLimited(`auth:${clientIp(req)}`, 10)) throw new HttpError(429, 'Muitas tentativas, aguarde 1 minuto')
    const body = await readJson(req)
    const login = typeof body.login === 'string' ? body.login.trim().toLowerCase() : ''
    const pw = password(body)
    // Aceita nome de usuário ou e-mail (os dois são guardados em minúsculas)
    const [user] = await sql<{ name: string; hash: string }[]>`
      select name, hash from users where name = ${login} or email = ${login}
    `
    if (!user || !(await checkPassword(pw, user.hash))) throw new HttpError(401, 'Login ou senha incorretos')
    return [200, { name: user.name, session: await newSession(user.name) }]
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

  // Move outra pessoa de canal (como o "Mover para" do Discord)
  // ponytail: qualquer um no mesmo canal pode mover; restringir por cargo quando houver permissões
  if (path === 'POST /move') {
    const { room, identity, to } = await readJson(req)
    if (!isChannel(room) || !isChannel(to) || room === to) throw new HttpError(400, 'Canal inválido')
    if (!validName(identity)) throw new HttpError(400, 'Usuário inválido')
    // Sala vazia ou inexistente: o LiveKit responde erro, tratamos como ninguém lá
    const present = new Set((await roomService.listParticipants(room).catch(() => [])).map((p) => p.identity))
    if (!present.has(name) || !present.has(identity)) throw new HttpError(403, 'Vocês precisam estar no mesmo canal')
    // moveParticipant só existe no LiveKit Cloud; uma mensagem do servidor funciona também no open source.
    // O app da pessoa só obedece mensagens vindas do servidor (sem participante remetente).
    const payload = new TextEncoder().encode(JSON.stringify({ to }))
    await roomService.sendData(room, payload, DataPacket_Kind.RELIABLE, { destinationIdentities: [identity], topic: 'move' })
    return [200, {}]
  }

  // Chat de texto de cada canal: histórico no Postgres
  const chat = path.match(/^(GET|POST) \/channels\/([^/]+)\/messages$/)
  if (chat) {
    const channel = chat[2]
    if (!isChannel(channel)) throw new HttpError(404, 'Canal não encontrado')

    if (chat[1] === 'GET') {
      // Sem "after": as 50 últimas. Com "after": só as novas (usado na atualização periódica)
      const after = url.searchParams.get('after')
      if (after !== null && !/^\d{1,18}$/.test(after)) throw new HttpError(400, 'Parâmetro after inválido')
      const rows = after === null
        ? await sql<Message[]>`
            select * from (select * from messages where channel = ${channel} order by id desc limit 50) m order by id
          `
        : await sql<Message[]>`
            select * from messages where channel = ${channel} and id > ${after} order by id limit 100
          `
      return [200, rows]
    }

    if (rateLimited(`msg:${name}`, 30)) throw new HttpError(429, 'Muitas mensagens, aguarde um pouco')
    const { body } = await readJson(req)
    const text = typeof body === 'string' ? body.trim() : ''
    if (!text || text.length > 2000) throw new HttpError(400, 'A mensagem deve ter de 1 a 2000 caracteres')
    const [message] = await sql<Message[]>`
      insert into messages (channel, author, body) values (${channel}, ${name}, ${text}) returning *
    `
    // Tempo real para quem está na chamada do canal; sem ninguém lá a sala não existe e tudo bem
    const payload = new TextEncoder().encode(JSON.stringify(message))
    await roomService.sendData(channel, payload, DataPacket_Kind.RELIABLE, { topic: 'chat' }).catch(() => {})
    return [200, message]
  }

  if (path === 'POST /logout') {
    await sql`delete from sessions where token = ${bearer(req)!}`
    return [200, {}]
  }

  if (path === 'POST /livekit-token') {
    const { room } = await readJson(req)
    if (!isChannel(room)) throw new HttpError(400, 'Canal inválido')
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
