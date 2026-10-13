import { useState, type FormEvent } from 'react'
import { api, session } from './api'

type Mode = 'login' | 'register'

const TEXT = {
  login: { title: 'Boas-vindas de volta!', subtitle: 'Que bom te ver de novo.', submit: 'Entrar', switchAsk: 'Precisa de uma conta?', switchTo: 'Criar conta' },
  register: { title: 'Criar uma conta', subtitle: 'Escolha um nome para os amigos te acharem.', submit: 'Continuar', switchAsk: 'Já tem uma conta?', switchTo: 'Entrar' },
}

export function Auth({ onLogin }: { onLogin: (name: string) => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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
      const r = await api<{ name: string; session: string }>(`/${mode}`, { name, password })
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
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </header>

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
            autoFocus
          />
          {mode === 'register' && <small>3 a 32 caracteres: letras minúsculas, números e _</small>}
        </label>

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

        <button className="auth-submit" disabled={loading}>
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
