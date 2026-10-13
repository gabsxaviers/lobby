import { useEffect, useState, type FormEvent } from 'react'
import { api, session } from './api'
import { Call, type Connection } from './Call'

// ponytail: canais fixos no front; mover para o backend quando houver criação de canais
const CHANNELS = ['geral', 'jogos', 'estudo']

type Person = { name: string; muted: boolean; screen: boolean }

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
  const [presence, setPresence] = useState<Record<string, Person[]>>({})

  useEffect(() => {
    const load = () => api<Record<string, Person[]>>('/presence').then(setPresence).catch(() => {})
    load()
    // ponytail: polling a cada 4s; trocar por webhooks do LiveKit + SSE se houver muitos usuários
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [conn?.room]) // recarrega na hora ao entrar/sair de um canal

  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 5000)
    return () => clearTimeout(id)
  }, [toast])

  async function join(room: string) {
    if (conn?.room === room) return
    setConn(null) // desmonta a sala atual (desconecta) antes de entrar na próxima
    try {
      const r = await api<{ url: string; token: string }>('/livekit-token', { room })
      setConn({ room, ...r })
    } catch (err) {
      setToast((err as Error).message)
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
          <div key={c}>
            <button className={c === conn?.room ? 'channel active' : 'channel'} onClick={() => join(c)}>
              🔊 {c}
            </button>
            <ul className="people">
              {presence[c]?.map((p) => (
                <li key={p.name}>
                  {p.name}
                  {p.muted && <span title="Microfone desligado"> 🔇</span>}
                  {p.screen && <span className="live">AO VIVO</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <footer>
          <span>{user}</span>
          <button className="lk-button" onClick={logout}>Sair</button>
        </footer>
      </nav>
      <main>
        {conn ? (
          <Call key={conn.room} conn={conn} onLeave={() => setConn(null)} onError={setToast} />
        ) : (
          <p className="empty">Escolha um canal para entrar.</p>
        )}
      </main>
      {toast && <div role="alert" className="toast" onClick={() => setToast('')}>{toast}</div>}
    </div>
  )
}
