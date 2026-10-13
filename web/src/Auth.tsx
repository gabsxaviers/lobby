import { useEffect, useState, type FormEvent } from 'react'
import { api, session } from './api'
import logo from './assets/logo.png'

type Mode = 'login' | 'register'
type NameStatus = 'idle' | 'checking' | 'available' | 'taken'

const TEXT = {
  login: { title: 'Boas-vindas de volta!', subtitle: 'Que bom te ver de novo.', submit: 'Entrar', switchAsk: 'Precisa de uma conta?', switchTo: 'Criar conta' },
  register: { title: 'Criar uma conta', subtitle: 'Escolha um nome para os amigos te acharem.', submit: 'Continuar', switchAsk: 'Já tem uma conta?', switchTo: 'Entrar' },
}

const NAME_HINT: Record<NameStatus, string> = {
  idle: '3 a 32 caracteres: letras minúsculas, números e _',
  checking: 'Verificando…',
  available: '✓ Nome disponível',
  taken: '✗ Esse nome já está em uso',
}

// Consulta a disponibilidade 500 ms depois que a pessoa para de digitar
function useNameStatus(name: string, enabled: boolean): NameStatus {
  // Último resultado recebido; o status é derivado comparando com o nome atual
  const [result, setResult] = useState<{ name: string; status: NameStatus } | null>(null)
  const active = enabled && name.length >= 3

  useEffect(() => {
    if (!active) return
    let stale = false
    const id = setTimeout(() => {
      api<{ available: boolean }>(`/check-name?name=${name}`)
        .then((r) => !stale && setResult({ name, status: r.available ? 'available' : 'taken' }))
        .catch(() => !stale && setResult({ name, status: 'idle' }))
    }, 500)
    return () => { stale = true; clearTimeout(id) }
  }, [name, active])

  if (!active) return 'idle'
  return result?.name === name ? result.status : 'checking'
}

export function Auth({ onLogin }: { onLogin: (name: string) => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const nameStatus = useNameStatus(name, mode === 'register')
  const t = TEXT[mode]

  function switchMode() {
    setMode(mode === 'login' ? 'register' : 'login')
    setError('')
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const password = form.get('password')
    if (mode === 'register' && password !== form.get('confirm')) return setError('As senhas não coincidem.')

    setLoading(true)
    setError('')
    try {
      const body = mode === 'login'
        ? { login: form.get('login'), password }
        : { name, email: form.get('email'), password }
      const r = await api<{ name: string; session: string }>(`/${mode}`, body)
      session.set(r.session)
      onLogin(r.name)
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit} key={mode}>
        <header>
          <img src={logo} alt="Lobby" className="auth-logo" />
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </header>

        {mode === 'login' ? (
          <label>
            E-mail ou nome de usuário
            <input name="login" required maxLength={254} autoComplete="username" autoFocus />
          </label>
        ) : (
          <>
            <label>
              E-mail
              <input name="email" type="email" required maxLength={254} autoComplete="email" autoFocus />
            </label>
            <label>
              Nome de usuário
              <input
                name="name"
                value={name}
                // o backend só aceita a-z, 0-9 e _: já normaliza enquanto digita
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                required
                minLength={3}
                maxLength={32}
                autoComplete="username"
                aria-invalid={nameStatus === 'taken'}
                aria-describedby="name-hint"
              />
              <small id="name-hint" className={`name-${nameStatus}`} aria-live="polite">{NAME_HINT[nameStatus]}</small>
            </label>
          </>
        )}

        <label>
          Senha
          <input
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={200}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && <small>Pelo menos 8 caracteres</small>}
        </label>

        {mode === 'register' && (
          <label>
            Confirmar senha
            <input name="confirm" type="password" required minLength={8} maxLength={200} autoComplete="new-password" />
          </label>
        )}

        {error && <p role="alert" className="auth-error">{error}</p>}

        <button className="auth-submit" disabled={loading || nameStatus === 'taken'}>
          {loading ? 'Aguarde…' : t.submit}
        </button>

        <p className="auth-switch">
          {t.switchAsk}{' '}
          <button type="button" onClick={switchMode}>{t.switchTo}</button>
        </p>
      </form>
    </div>
  )
}
