import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { LogOut, MicOff, Volume2 } from 'lucide-react'
import { api, session } from './api'
import { Auth } from './Auth'
import { Call, type Connection } from './Call'
import { UserMenu } from './UserMenu'

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
  return user ? <Lobby user={user} onLogout={() => setUser(null)} /> : <Auth onLogin={setUser} />
}

function Lobby({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [conn, setConn] = useState<Connection | null>(null)
  const [presence, setPresence] = useState<Record<string, Person[]>>({})
  const [menu, setMenu] = useState<{ x: number; y: number; name: string; channel: string } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

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

  function openMenu(e: MouseEvent, name: string, channel: string) {
    if (name === user) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, name, channel })
  }

  function move(name: string, to: string) {
    if (!conn) return
    api('/move', { room: conn.room, identity: name, to }).catch((err) => setToast((err as Error).message))
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
              <Volume2 size={18} /> {c}
            </button>
            <ul className="people">
              {presence[c]?.map((p) => (
                <li key={p.name} onContextMenu={(e) => openMenu(e, p.name, c)}>
                  {p.name}
                  {p.muted && <MicOff size={14} aria-label="Microfone desligado" />}
                  {p.screen && <span className="live">AO VIVO</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <footer>
          <span>{user}</span>
          <button className="icon-button" onClick={logout} title="Sair da conta" aria-label="Sair da conta">
            <LogOut size={18} />
          </button>
        </footer>
      </nav>
      <main>
        {conn ? (
          <Call
            key={conn.room}
            conn={conn}
            channels={CHANNELS}
            onLeave={() => setConn(null)}
            onMoved={(room) => CHANNELS.includes(room) && join(room)}
            onError={setToast}
          />
        ) : (
          <p className="empty">Escolha um canal para entrar.</p>
        )}
      </main>
      {menu && (
        <UserMenu
          {...menu}
          // Só dá para mover quem está no mesmo canal que você (o servidor também confere)
          moveTo={menu.channel === conn?.room ? CHANNELS.filter((c) => c !== conn.room) : []}
          onMove={(to) => move(menu.name, to)}
          onClose={closeMenu}
        />
      )}
      {toast && <div role="alert" className="toast" onClick={() => setToast('')}>{toast}</div>}
    </div>
  )
}
