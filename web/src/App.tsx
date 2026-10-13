import { useEffect, useState, type FormEvent } from 'react'
import { api, session } from './api'
import { Call, type Connection } from './Call'

// ponytail: canais fixos no front; mover para o backend quando houver criação de canais
const CHANNELS = ['geral', 'jogos', 'estudo']

export default function App() {
  const [user, setUser] = useState<string | null>(null)
  const [checking, setChecking] = useState(() => session.get() !== null)

  useEffect(() => {
    if (!checking) return
    api<{ name: string }>('/me')
      .then((r) => setUser(r.name))
      .catch(() => session.set(null))
      .finally(() => setChecking(false))
  }, [checking])

  if (checking) return null
  return user ? <Lobby user={user} onLogout={() => setUser(null)} /> : <Login onLogin={setUser} />
}

function Login({ onLogin }: { onLogin: (name: string) => void }) {
  const [error, setError] = useState('')

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const path = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? '/login'
    try {
      const r = await api<{ name: string; session: string }>(path, {
        name: form.get('name'),
        password: form.get('password'),
      })
      session.set(r.session)
      onLogin(r.name)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>Lobby</h1>
      <label>
        Nome
        <input name="name" required minLength={3} maxLength={32} pattern="[a-z0-9_]+" autoComplete="username" />
      </label>
      <label>
        Senha
        <input name="password" type="password" required minLength={8} autoComplete="current-password" />
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="row">
        <button className="lk-button" value="/login">Entrar</button>
        <button className="lk-button" value="/register">Criar conta</button>
      </div>
    </form>
  )
}

function Lobby({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [conn, setConn] = useState<Connection | null>(null)

  async function join(room: string) {
    if (conn?.room === room) return
    setConn(null) // desmonta a sala atual (desconecta) antes de entrar na próxima
    try {
      const r = await api<{ url: string; token: string }>('/livekit-token', { room })
      setConn({ room, ...r })
    } catch (err) {
      alert((err as Error).message)
    }
  }

  async function logout() {
    await api('/logout', {}).catch(() => {})
    session.set(null)
    onLogout()
  }

  return (
    <div className="lobby" data-lk-theme="default">
      <nav>
        <h2>Canais de voz</h2>
        {CHANNELS.map((c) => (
          <button key={c} className={c === conn?.room ? 'channel active' : 'channel'} onClick={() => join(c)}>
            🔊 {c}
          </button>
        ))}
        <footer>
          <span>{user}</span>
          <button className="lk-button" onClick={logout}>Sair</button>
        </footer>
      </nav>
      <main>
        {conn ? (
          <Call key={conn.room} conn={conn} onLeave={() => setConn(null)} />
        ) : (
          <p className="empty">Escolha um canal para entrar.</p>
        )}
      </main>
    </div>
  )
}
