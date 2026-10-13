import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'

// Usa o Postgres do docker-compose (ou DATABASE_URL); nome aleatório evita colisão entre execuções
const { server, sql } = await import('./index.ts')

test('cadastro, login e token do LiveKit', async (t) => {
  await new Promise<void>((r) => server.listen(0, r))
  t.after(() => { server.close(); return sql.end() })
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const post = (path: string, body: object, session?: string) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(session && { authorization: `Bearer ${session}` }) },
      body: JSON.stringify(body),
    })

  const creds = { name: `teste_${Date.now()}`, password: 'senha-segura' }
  assert.equal((await post('/register', creds)).status, 200)
  assert.equal((await post('/register', creds)).status, 409)
  assert.equal((await post('/register', { name: 'A!', password: 'x' })).status, 400)
  assert.equal((await post('/login', { ...creds, password: 'errada123' })).status, 401)

  const { session } = await (await post('/login', creds)).json()
  assert.equal((await post('/livekit-token', { room: 'geral' })).status, 401)
  assert.equal((await fetch(base + '/presence')).status, 401)
  assert.equal((await post('/livekit-token', { room: '../x' }, session)).status, 400)

  const res = await post('/livekit-token', { room: 'geral' }, session)
  assert.equal(res.status, 200)
  const { token } = await res.json()
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  assert.equal(claims.sub, creds.name)
  assert.equal(claims.video.room, 'geral')
  assert.equal(claims.video.roomJoin, true)

  assert.equal((await post('/logout', {}, session)).status, 200)
  assert.equal((await post('/livekit-token', { room: 'geral' }, session)).status, 401)
})
