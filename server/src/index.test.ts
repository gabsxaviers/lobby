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

  const id = Date.now()
  const creds = { name: `teste_${id}`, email: `Teste_${id}@Exemplo.com`, password: 'senha-segura' }
  const checkName = async (name: string) => (await (await fetch(`${base}/check-name?name=${name}`)).json()).available

  assert.equal(await checkName(creds.name), true)
  assert.equal((await post('/register', creds)).status, 200)
  assert.equal(await checkName(creds.name), false)

  const dupName = await post('/register', { ...creds, email: `outro_${id}@exemplo.com` })
  assert.equal(dupName.status, 409)
  assert.equal((await dupName.json()).error, 'Nome já em uso')
  const dupEmail = await post('/register', { ...creds, name: `outro_${id}`, email: creds.email.toLowerCase() })
  assert.equal(dupEmail.status, 409)
  assert.equal((await dupEmail.json()).error, 'E-mail já cadastrado')
  assert.equal((await post('/register', { ...creds, name: 'A!' })).status, 400)
  assert.equal((await post('/register', { ...creds, name: `x_${id}`, email: 'sem-arroba' })).status, 400)

  assert.equal((await post('/login', { login: creds.name, password: 'errada123' })).status, 401)
  assert.equal((await post('/login', { login: creds.email, password: creds.password })).status, 200) // e-mail, com maiúsculas
  const { session } = await (await post('/login', { login: creds.name, password: creds.password })).json()
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

  // Mover exige que os dois estejam no mesmo canal (aqui ninguém está conectado)
  assert.equal((await post('/move', { room: 'geral', identity: 'alguem', to: 'jogos' }, session)).status, 403)
  assert.equal((await post('/move', { room: 'geral', identity: 'alguem', to: 'geral' }, session)).status, 400)

  assert.equal((await post('/logout', {}, session)).status, 200)
  assert.equal((await post('/livekit-token', { room: 'geral' }, session)).status, 401)
})
