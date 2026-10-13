import { useState } from 'react'
import { Track } from 'livekit-client'
import {
  CarouselLayout, DisconnectButton, FocusLayout, FocusLayoutContainer, GridLayout, LayoutContextProvider,
  LiveKitRoom, ParticipantTile, RoomAudioRenderer, StartAudio, TrackToggle, isTrackReference, useTracks,
} from '@livekit/components-react'
import '@livekit/components-styles'
import { SCREEN_PRESETS, type ScreenPresetId } from './screenShare'

export type Connection = { room: string; url: string; token: string }

export function Call({ conn, onLeave }: { conn: Connection; onLeave: () => void }) {
  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio
      video={false}
      onDisconnected={onLeave}
      onError={(e) => alert(e.message)}
      className="call"
    >
      <LayoutContextProvider>
        <Stage />
      </LayoutContextProvider>
      <Controls />
      <RoomAudioRenderer />
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

function Controls() {
  const [presetId, setPresetId] = useState<ScreenPresetId>('video')
  const [sharing, setSharing] = useState(false)
  const preset = SCREEN_PRESETS[presetId]

  return (
    <div className="lk-control-bar">
      <TrackToggle source={Track.Source.Microphone}>Microfone</TrackToggle>
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
