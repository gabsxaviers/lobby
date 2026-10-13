import { useEffect, useRef } from 'react'
import { Check, Volume2, VolumeX } from 'lucide-react'
import { useUserAudio } from './userAudio'

type Props = {
  x: number
  y: number
  name: string
  moveTo: string[] // canais para onde dá para mover a pessoa; vazio esconde a seção
  onMove: (to: string) => void
  onClose: () => void
}

// Menu de clique direito em uma pessoa (card da chamada ou lista lateral)
export function UserMenu({ x, y, name, moveTo, onMove, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [audio, setAudio] = useUserAudio(name)

  // Mantém o menu dentro da tela (abre para cima/esquerda perto das bordas)
  useEffect(() => {
    const el = ref.current!
    const { width, height } = el.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`
    el.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`
    el.querySelector<HTMLElement>('input, button')?.focus()
  }, [x, y])

  useEffect(() => {
    const el = ref.current!
    const outside = (e: PointerEvent) => { if (!el.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="user-menu"
      role="menu"
      aria-label={`Opções de ${name}`}
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="menu-title">{name}</div>
      <label className="menu-volume">
        Volume do usuário
        <input
          type="range"
          min={0}
          max={100}
          value={audio.volume}
          disabled={audio.muted}
          onChange={(e) => setAudio({ ...audio, volume: Number(e.target.value) })}
        />
        <span>{audio.volume}%</span>
      </label>
      <button role="menuitemcheckbox" aria-checked={audio.muted} onClick={() => setAudio({ ...audio, muted: !audio.muted })}>
        <VolumeX size={16} /> Silenciar
        {audio.muted && <Check size={16} className="menu-check" />}
      </button>
      {moveTo.length > 0 && (
        <>
          <div className="menu-sep" role="separator" />
          <div className="menu-label">Mover para</div>
          {moveTo.map((c) => (
            <button key={c} role="menuitem" onClick={() => { onMove(c); onClose() }}>
              <Volume2 size={16} /> {c}
            </button>
          ))}
        </>
      )}
    </div>
  )
}
