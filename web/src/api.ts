const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// Token Bearer (não cookie) para funcionar igual no navegador e no Electron (file:// / app://).
export const session = {
  get: () => localStorage.getItem('session'),
  set: (s: string | null) => (s ? localStorage.setItem('session', s) : localStorage.removeItem('session')),
}

export async function api<T>(path: string, body?: object): Promise<T> {
  const token = session.get()
  const res = await fetch(API_URL + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`)
  return data
}
