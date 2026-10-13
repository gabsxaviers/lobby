import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Hash, SendHorizontal, X } from 'lucide-react'
import { api } from './api'
import { nameColor } from './avatar'
import { chatEvents, type Message } from './chatEvents'

const GROUP_MS = 5 * 60_000

function formatTime(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('pt-BR')} ${time}`
}

type Props = { channel: string; live: boolean; onClose: () => void }

export function Chat({ channel, live, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const lastId = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Junta mensagens novas sem repetir (a mesma pode chegar pelo LiveKit e pela busca periódica)
  const add = useCallback((incoming: Message[]) => {
    const mine = incoming.filter((m) => m.channel === channel)
    if (mine.length === 0) return
    const max = mine.reduce((a, m) => (BigInt(m.id) > BigInt(a) ? m.id : a), lastId.current ?? '0')
    lastId.current = max
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id))
      const fresh = mine.filter((m) => !seen.has(m.id))
      return fresh.length ? [...prev, ...fresh].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)) : prev
    })
  }, [channel])

  // Histórico + busca periódica. Na chamada as mensagens chegam na hora; a busca vira só uma garantia.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      const after = lastId.current ? `?after=${lastId.current}` : ''
      api<Message[]>(`/channels/${channel}/messages${after}`).then((ms) => !cancelled && add(ms)).catch(() => {})
    }
    load()
    // ponytail: busca a cada 3s fora da chamada; para tempo real sem estar na voz, usar WebSocket/SSE próprio
    const id = setInterval(load, live ? 15_000 : 3_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [channel, live, add])

  useEffect(() => {
    const onMessage = (e: Event) => add([(e as CustomEvent<Message>).detail])
    chatEvents.addEventListener('message', onMessage)
    return () => chatEvents.removeEventListener('message', onMessage)
  }, [add])

  // Rola para a última mensagem, a menos que a pessoa tenha subido para ler o histórico
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    try {
      const m = await api<Message>(`/channels/${channel}/messages`, { body })
      stickToBottom.current = true
      add([m])
      setText('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  // Enter envia; Shift+Enter quebra linha (como no Discord)
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e)
  }

  return (
    <aside className="chat" aria-label={`Chat do canal ${channel}`}>
      <header>
        <Hash size={18} aria-hidden /> {channel}
        <button className="icon-button" onClick={onClose} title="Fechar chat" aria-label="Fechar chat">
          <X size={18} />
        </button>
      </header>

      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {messages.length === 0 && <p className="chat-empty">Nenhuma mensagem ainda. Diga oi! 👋</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const grouped = prev?.author === m.author && Date.parse(m.created) - Date.parse(prev.created) < GROUP_MS
          return grouped ? (
            <div key={m.id} className="chat-msg grouped">
              <p>{m.body}</p>
            </div>
          ) : (
            <div key={m.id} className="chat-msg">
              <div className="chat-avatar" style={{ background: nameColor(m.author) }} aria-hidden>
                {m.author[0].toUpperCase()}
              </div>
              <div>
                <div className="chat-meta">
                  <strong>{m.author}</strong> <time dateTime={m.created}>{formatTime(m.created)}</time>
                </div>
                <p>{m.body}</p>
              </div>
            </div>
          )
        })}
      </div>

      {error && <p role="alert" className="chat-error">{error}</p>}
      <form className="chat-input" onSubmit={send}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Conversar em #${channel}`}
          aria-label={`Mensagem para #${channel}`}
          maxLength={2000}
          rows={1}
        />
        <button className="icon-button" disabled={!text.trim() || sending} title="Enviar" aria-label="Enviar">
          <SendHorizontal size={18} />
        </button>
      </form>
    </aside>
  )
}
