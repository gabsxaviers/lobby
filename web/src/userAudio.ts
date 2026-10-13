import { useSyncExternalStore } from 'react'

// Volume e silenciar por pessoa: só afetam o que VOCÊ ouve. Ficam salvos no navegador e são
// compartilhados entre o menu da lista lateral e o card da chamada.
export type UserAudio = { volume: number; muted: boolean }

const DEFAULT: UserAudio = { volume: 100, muted: false }
const cache = new Map<string, UserAudio>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function load(identity: string): UserAudio {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(`audio:${identity}`) ?? '{}') }
  } catch {
    return DEFAULT
  }
}

// Sempre devolve o mesmo objeto enquanto nada muda (exigência do useSyncExternalStore)
function read(identity: string): UserAudio {
  if (!cache.has(identity)) cache.set(identity, load(identity))
  return cache.get(identity)!
}

function write(identity: string, audio: UserAudio) {
  cache.set(identity, audio)
  try { localStorage.setItem(`audio:${identity}`, JSON.stringify(audio)) } catch { /* sem storage: vale só nesta aba */ }
  listeners.forEach((l) => l())
}

export function useUserAudio(identity: string) {
  const audio = useSyncExternalStore(subscribe, () => read(identity))
  return [audio, (a: UserAudio) => write(identity, a)] as const
}
