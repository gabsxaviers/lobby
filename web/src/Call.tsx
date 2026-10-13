import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { MediaDeviceFailure, RemoteParticipant, Track, type Participant } from 'livekit-client'
import {
  DisconnectButton, LayoutContextProvider, LiveKitRoom, MediaDeviceMenu, ParticipantTile, RoomAudioRenderer,
  StartAudio, TrackToggle, useDataChannel, useIsMuted, useIsSpeaking, useLocalParticipant, useParticipants,
  useRoomInfo, useTracks,
} from '@livekit/components-react'
import '@livekit/components-styles'
import {
  Check, ChevronDown, HeadphoneOff, Headphones, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, VolumeX,
} from 'lucide-react'
import { api } from './api'
import { nameColor } from './avatar'
import { chatEvents } from './chatEvents'
import { SCREEN_PRESETS, type ScreenPresetId } from './screenShare'
import { useUserAudio } from './userAudio'
import { UserMenu } from './UserMenu'

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
      <ChatListener />
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

// Mensagens do chat repassadas pelo servidor (já validadas e salvas) chegam na hora para quem está na chamada
function ChatListener() {
  useDataChannel('chat', (msg) => {
    if (msg.from) return // só o servidor repassa mensagens; ignora qualquer coisa enviada por participantes
    try {
      const detail = JSON.parse(new TextDecoder().decode(msg.payload))
      chatEvents.dispatchEvent(new CustomEvent('message', { detail }))
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

type TileProps = { participant: Participant; channels: string[]; onError: (message: string) => void }

function VoiceTile({ participant, channels, onError }: TileProps) {
  const speaking = useIsSpeaking(participant)
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone })
  const name = participant.identity
  const [audio] = useUserAudio(name)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const room = useRoomInfo().name
  const remote = participant instanceof RemoteParticipant

  // Aplica o volume/silenciar escolhido (no card ou na lista lateral) ao áudio desta pessoa
  useEffect(() => {
    // ponytail: máximo 100%; acima disso exige webAudioMix no LiveKitRoom
    if (participant instanceof RemoteParticipant) participant.setVolume(audio.muted ? 0 : audio.volume / 100)
  }, [participant, audio])

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
      <div className="avatar" style={{ background: nameColor(name) }} aria-hidden>
        {name[0].toUpperCase()}
      </div>
      <span className="voice-name">
        {name}
        {micMuted && <MicOff size={14} aria-label="Microfone desligado" />}
        {audio.muted && <VolumeX size={14} aria-label="Silenciado por você" />}
      </span>
      {menu && (
        <UserMenu {...menu} name={name} moveTo={channels.filter((c) => c !== room)} onMove={move} onClose={closeMenu} />
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

  const micLabel = isMicrophoneEnabled ? 'Silenciar' : 'Dessilenciar'
  const deafLabel = deaf ? 'Ativar áudio' : 'Desativar áudio'
  const shareLabel = sharing ? 'Parar transmissão' : 'Transmitir tela'

  // Só ícones, como no Discord: o texto vira tooltip (data-tooltip) e aria-label
  return (
    <div className="lk-control-bar call-controls">
      <div className="control-group">
        <TrackToggle
          source={Track.Source.Microphone}
          showIcon={false}
          className={isMicrophoneEnabled ? 'ctl' : 'ctl off'}
          aria-label={micLabel}
          data-tooltip={micLabel}
        >
          {isMicrophoneEnabled ? <Mic size={ICON} /> : <MicOff size={ICON} />}
        </TrackToggle>
        <MediaDeviceMenu kind="audioinput" className="ctl ctl-chevron" aria-label="Escolher microfone" data-tooltip="Microfone">
          <ChevronDown size={14} />
        </MediaDeviceMenu>
      </div>

      <div className="control-group">
        <button className={deaf ? 'ctl off' : 'ctl'} aria-pressed={deaf} onClick={toggleDeaf} aria-label={deafLabel} data-tooltip={deafLabel}>
          {deaf ? <HeadphoneOff size={ICON} /> : <Headphones size={ICON} />}
        </button>
        <MediaDeviceMenu kind="audiooutput" className="ctl ctl-chevron" aria-label="Escolher saída de som" data-tooltip="Saída de som">
          <ChevronDown size={14} />
        </MediaDeviceMenu>
      </div>

      <div className="control-group">
        <TrackToggle
          source={Track.Source.ScreenShare}
          captureOptions={preset.capture}
          publishOptions={preset.publish}
          onChange={setSharing}
          showIcon={false}
          className={sharing ? 'ctl on' : 'ctl'}
          aria-label={shareLabel}
          data-tooltip={shareLabel}
        >
          {sharing ? <MonitorOff size={ICON} /> : <MonitorUp size={ICON} />}
        </TrackToggle>
        <PresetMenu value={presetId} onChange={setPresetId} disabled={sharing} />
      </div>

      <DisconnectButton className="ctl hangup" aria-label="Desconectar" data-tooltip="Desconectar">
        <PhoneOff size={ICON} />
      </DisconnectButton>
    </div>
  )
}

// Setinha ao lado de "Transmitir tela": escolhe a qualidade antes de começar
function PresetMenu({ value, onChange, disabled }: { value: ScreenPresetId; onChange: (id: ScreenPresetId) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const label = disabled ? 'Qualidade (pare a transmissão para mudar)' : 'Qualidade da transmissão'
  return (
    <div className="preset-menu" ref={ref}>
      <button
        className="ctl ctl-chevron"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip={open ? undefined : label}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="user-menu preset-list" role="menu" aria-label="Qualidade da transmissão">
          <div className="menu-label">Qualidade da transmissão</div>
          {Object.entries(SCREEN_PRESETS).map(([id, p]) => (
            <button
              key={id}
              role="menuitemradio"
              aria-checked={id === value}
              onClick={() => { onChange(id as ScreenPresetId); setOpen(false) }}
            >
              {p.label}
              {id === value && <Check size={16} className="menu-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
