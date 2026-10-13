import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { MediaDeviceFailure, RemoteParticipant, Track, type Participant } from 'livekit-client'
import {
  DisconnectButton, LayoutContextProvider, LiveKitRoom, MediaDeviceMenu, ParticipantTile, RoomAudioRenderer,
  StartAudio, TrackToggle, useDataChannel, useIsMuted, useIsSpeaking, useLocalParticipant, useParticipants,
  useRoomInfo, useTracks,
} from '@livekit/components-react'
import '@livekit/components-styles'
import {
  Check, HeadphoneOff, Headphones, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Volume2, VolumeX,
} from 'lucide-react'
import { api } from './api'
import { SCREEN_PRESETS, type ScreenPresetId } from './screenShare'

export type Connection = { room: string; url: string; token: string }

const ICON = 18

const DEVICE_ERRORS: Record<MediaDeviceFailure, string> = {
  [MediaDeviceFailure.PermissionDenied]: 'Permissão de microfone negada no navegador.',
  [MediaDeviceFailure.NotFound]: 'Nenhum microfone encontrado.',
  [MediaDeviceFailure.DeviceInUse]: 'O microfone está em uso por outro aplicativo.',
  [MediaDeviceFailure.Other]: 'Não foi possível acessar o microfone.',
}

type Props = {
  conn: Connection
  channels: string[]
  onLeave: () => void
  onMoved: (room: string) => void
  onError: (message: string) => void
}

export function Call({ conn, channels, onLeave, onMoved, onError }: Props) {
  const [deaf, setDeaf] = useState(false)
  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio
      video={false}
      onDisconnected={onLeave}
      onError={(e) => {
        const failure = MediaDeviceFailure.getFailure(e)
        onError(failure ? DEVICE_ERRORS[failure] : e.message)
      }}
      onMediaDeviceFailure={(f) => onError(DEVICE_ERRORS[f ?? MediaDeviceFailure.Other])}
      className="call"
    >
      <LayoutContextProvider>
        <Stage channels={channels} onError={onError} />
      </LayoutContextProvider>
      <Controls deaf={deaf} setDeaf={setDeaf} />
      <MovedListener onMoved={onMoved} />
      {/* muted desativa a assinatura do áudio de todos (não baixa nada enquanto surdo) */}
      <RoomAudioRenderer muted={deaf} />
      <StartAudio label="Clique para ativar o áudio" />
    </LiveKitRoom>
  )
}

// Quando alguém nos move de canal, o servidor manda { to } no tópico "move"; o App troca de sala
function MovedListener({ onMoved }: { onMoved: (room: string) => void }) {
  useDataChannel('move', (msg) => {
    if (msg.from) return // só o servidor pode mover (mensagens de participantes são ignoradas)
    try {
      const { to } = JSON.parse(new TextDecoder().decode(msg.payload))
      if (typeof to === 'string') onMoved(to)
    } catch { /* mensagem malformada: ignora */ }
  })
  return null
}

type StageProps = { channels: string[]; onError: (message: string) => void }

// Como no Discord: cards de voz pequenos e centralizados; com transmissão, a tela em destaque e os cards numa faixa
function Stage({ channels, onError }: StageProps) {
  const participants = useParticipants()
  // ponytail: mostra só a primeira transmissão; com várias, adicionar seleção de qual assistir
  const [screen] = useTracks([Track.Source.ScreenShare], { onlySubscribed: false })
  // Enquanto conecta, o participante local ainda não tem identidade: não mostra card vazio
  const tiles = participants
    .filter((p) => p.identity)
    .map((p) => <VoiceTile key={p.identity} participant={p} channels={channels} onError={onError} />)

  if (!screen) return <div className="stage voice-grid">{tiles}</div>
  return (
    <div className="stage with-screen">
      <ParticipantTile trackRef={screen} className="screen" />
      <div className="voice-strip">{tiles}</div>
    </div>
  )
}

type UserAudio = { volume: number; muted: boolean }

// Volume e silenciar são locais (só você deixa de ouvir) e ficam salvos no navegador por pessoa
function useUserAudio(participant: Participant) {
  const key = `audio:${participant.identity}`
  const [audio, setAudio] = useState<UserAudio>(() => {
    try {
      return { volume: 100, muted: false, ...JSON.parse(localStorage.getItem(key) ?? '{}') }
    } catch {
      return { volume: 100, muted: false }
    }
  })
  useEffect(() => {
    if (!(participant instanceof RemoteParticipant)) return
    // ponytail: máximo 100%; acima disso exige webAudioMix no LiveKitRoom
    participant.setVolume(audio.muted ? 0 : audio.volume / 100)
    localStorage.setItem(key, JSON.stringify(audio))
  }, [participant, key, audio])
  return [audio, setAudio] as const
}

type TileProps = { participant: Participant; channels: string[]; onError: (message: string) => void }

function VoiceTile({ participant, channels, onError }: TileProps) {
  const speaking = useIsSpeaking(participant)
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone })
  const [audio, setAudio] = useUserAudio(participant)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const room = useRoomInfo().name
  const name = participant.identity
  const remote = participant instanceof RemoteParticipant
  // Cor fixa por nome, para cada pessoa ser reconhecível
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)

  function openMenu(e: MouseEvent) {
    if (!remote) return // ponytail: sem menu no próprio card; adicionar "mover a si mesmo" se pedirem
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  function move(to: string) {
    api('/move', { room, identity: name, to }).catch((err) => onError((err as Error).message))
  }

  return (
    <div className={speaking ? 'voice-tile speaking' : 'voice-tile'} onContextMenu={openMenu}>
      <div className="avatar" style={{ background: `hsl(${hue} 55% 45%)` }} aria-hidden>
        {name[0].toUpperCase()}
      </div>
      <span className="voice-name">
        {name}
        {micMuted && <MicOff size={14} aria-label="Microfone desligado" />}
        {audio.muted && <VolumeX size={14} aria-label="Silenciado por você" />}
      </span>
      {menu && (
        <UserMenu
          {...menu}
          name={name}
          audio={audio}
          setAudio={setAudio}
          channels={channels.filter((c) => c !== room)}
          onMove={move}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}

type MenuProps = {
  x: number
  y: number
  name: string
  audio: UserAudio
  setAudio: (a: UserAudio) => void
  channels: string[]
  onMove: (to: string) => void
  onClose: () => void
}

function UserMenu({ x, y, name, audio, setAudio, channels, onMove, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)

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
    <div ref={ref} className="user-menu" role="menu" aria-label={`Opções de ${name}`} style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
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
      {channels.length > 0 && (
        <>
          <div className="menu-sep" role="separator" />
          <div className="menu-label">Mover para</div>
          {channels.map((c) => (
            <button key={c} role="menuitem" onClick={() => { onMove(c); onClose() }}>
              <Volume2 size={16} /> {c}
            </button>
          ))}
        </>
      )}
    </div>
  )
}

function Controls({ deaf, setDeaf }: { deaf: boolean; setDeaf: (d: boolean) => void }) {
  const [presetId, setPresetId] = useState<ScreenPresetId>('video')
  const [sharing, setSharing] = useState(false)
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()
  const micBeforeDeaf = useRef(false)
  const preset = SCREEN_PRESETS[presetId]

  // Como no Discord: ficar surdo também desliga o microfone, e voltar restaura o estado anterior
  function toggleDeaf() {
    if (!deaf) {
      micBeforeDeaf.current = isMicrophoneEnabled
      localParticipant.setMicrophoneEnabled(false)
    } else if (micBeforeDeaf.current) {
      localParticipant.setMicrophoneEnabled(true)
    }
    setDeaf(!deaf)
  }

  return (
    <div className="lk-control-bar">
      <TrackToggle source={Track.Source.Microphone} showIcon={false}>
        {isMicrophoneEnabled ? <Mic size={ICON} /> : <MicOff size={ICON} />} Microfone
      </TrackToggle>
      <MediaDeviceMenu kind="audioinput" title="Escolher microfone" />
      <button className="lk-button deaf" aria-pressed={deaf} onClick={toggleDeaf}>
        {deaf ? <><HeadphoneOff size={ICON} /> Voltar a ouvir</> : <><Headphones size={ICON} /> Silenciar tudo</>}
      </button>
      <MediaDeviceMenu kind="audiooutput" title="Escolher saída de som" />
      <select
        className="lk-button"
        value={presetId}
        disabled={sharing}
        title="Qualidade da transmissão"
        onChange={(e) => setPresetId(e.target.value as ScreenPresetId)}
      >
        {Object.entries(SCREEN_PRESETS).map(([id, p]) => (
          <option key={id} value={id}>{p.label}</option>
        ))}
      </select>
      <TrackToggle
        source={Track.Source.ScreenShare}
        captureOptions={preset.capture}
        publishOptions={preset.publish}
        onChange={setSharing}
        showIcon={false}
      >
        {sharing ? <><MonitorOff size={ICON} /> Parar transmissão</> : <><MonitorUp size={ICON} /> Transmitir tela</>}
      </TrackToggle>
      <DisconnectButton><PhoneOff size={ICON} /> Sair</DisconnectButton>
    </div>
  )
}
