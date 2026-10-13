import { useEffect, useRef, useState } from 'react'
import { MediaDeviceFailure, Track, type RemoteParticipant } from 'livekit-client'
import {
  CarouselLayout, DisconnectButton, FocusLayout, FocusLayoutContainer, GridLayout, LayoutContextProvider,
  LiveKitRoom, MediaDeviceMenu, ParticipantTile, RoomAudioRenderer, StartAudio, TrackToggle, isTrackReference,
  useLocalParticipant, useRemoteParticipants, useTracks,
} from '@livekit/components-react'
import '@livekit/components-styles'
import { SCREEN_PRESETS, type ScreenPresetId } from './screenShare'

export type Connection = { room: string; url: string; token: string }

const DEVICE_ERRORS: Record<MediaDeviceFailure, string> = {
  [MediaDeviceFailure.PermissionDenied]: 'Permissão de microfone negada no navegador.',
  [MediaDeviceFailure.NotFound]: 'Nenhum microfone encontrado.',
  [MediaDeviceFailure.DeviceInUse]: 'O microfone está em uso por outro aplicativo.',
  [MediaDeviceFailure.Other]: 'Não foi possível acessar o microfone.',
}

type Props = { conn: Connection; onLeave: () => void; onError: (message: string) => void }

export function Call({ conn, onLeave, onError }: Props) {
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
        <Stage />
      </LayoutContextProvider>
      <Controls deaf={deaf} setDeaf={setDeaf} />
      {/* muted desativa a assinatura do áudio de todos (não baixa nada enquanto surdo) */}
      <RoomAudioRenderer muted={deaf} />
      <StartAudio label="Clique para ativar o áudio" />
    </LiveKitRoom>
  )
}

function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true }, // um bloco por participante (sem câmera = avatar)
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )
  const screen = tracks.find((t) => isTrackReference(t) && t.source === Track.Source.ScreenShare)

  if (!screen) {
    return (
      <GridLayout tracks={tracks} className="stage">
        <ParticipantTile />
      </GridLayout>
    )
  }
  return (
    <FocusLayoutContainer className="stage">
      <CarouselLayout tracks={tracks.filter((t) => t !== screen)}>
        <ParticipantTile />
      </CarouselLayout>
      <FocusLayout trackRef={screen} />
    </FocusLayoutContainer>
  )
}

function Controls({ deaf, setDeaf }: { deaf: boolean; setDeaf: (d: boolean) => void }) {
  const [presetId, setPresetId] = useState<ScreenPresetId>('video')
  const [sharing, setSharing] = useState(false)
  const [volumesOpen, setVolumesOpen] = useState(false)
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
      <Volumes open={volumesOpen} />
      <TrackToggle source={Track.Source.Microphone}>Microfone</TrackToggle>
      <MediaDeviceMenu kind="audioinput" title="Escolher microfone" />
      <button className="lk-button deaf" aria-pressed={deaf} onClick={toggleDeaf}>
        {deaf ? '🔈 Voltar a ouvir' : '🎧 Silenciar tudo'}
      </button>
      <MediaDeviceMenu kind="audiooutput" title="Escolher saída de som" />
      <button className="lk-button" aria-pressed={volumesOpen} onClick={() => setVolumesOpen(!volumesOpen)}>
        Volumes
      </button>
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
      >
        {sharing ? 'Parar transmissão' : 'Transmitir tela'}
      </TrackToggle>
      <DisconnectButton>Sair</DisconnectButton>
    </div>
  )
}

// Sempre montado (só escondido) para aplicar os volumes salvos assim que cada pessoa entra
function Volumes({ open }: { open: boolean }) {
  const participants = useRemoteParticipants()
  return (
    <div className="volumes" hidden={!open}>
      {participants.length === 0 && <p>Ninguém mais na sala.</p>}
      {participants.map((p) => <VolumeRow key={p.identity} participant={p} />)}
    </div>
  )
}

function VolumeRow({ participant }: { participant: RemoteParticipant }) {
  const key = `volume:${participant.identity}`
  // ponytail: máximo 100%; acima disso exige webAudioMix no LiveKitRoom
  const [volume, setVolume] = useState(() => Number(localStorage.getItem(key) ?? 100))

  useEffect(() => {
    participant.setVolume(volume / 100)
    localStorage.setItem(key, String(volume))
  }, [participant, key, volume])

  return (
    <label>
      <span>{participant.identity}</span>
      <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
      <span>{volume}%</span>
    </label>
  )
}
