import { ScreenSharePresets, VideoPreset, type ScreenShareCaptureOptions, type TrackPublishOptions } from 'livekit-client'

// Mesma ideia dos presets "Vídeo" / "Documentos" do Discord: movimento prioriza fps, texto prioriza nitidez.
function preset(label: string, p: VideoPreset, contentHint: 'motion' | 'detail') {
  const capture: ScreenShareCaptureOptions = {
    audio: true, // áudio da aba/sistema quando o navegador oferecer
    contentHint,
    resolution: p.resolution,
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
  }
  const publish: TrackPublishOptions = { screenShareEncoding: p.encoding }
  return { label, capture, publish }
}

export const SCREEN_PRESETS = {
  // LiveKit não tem preset 60fps; 8 Mbps = 1080p30 (5 Mbps) com margem para o dobro de quadros
  jogo: preset('Jogo · 1080p 60fps', new VideoPreset(1920, 1080, 8_000_000, 60, 'high'), 'motion'),
  video: preset('Vídeo · 1080p 30fps', ScreenSharePresets.h1080fps30, 'motion'),
  leve: preset('Leve · 720p 30fps', ScreenSharePresets.h720fps30, 'motion'),
  texto: preset('Texto · 1080p 15fps', ScreenSharePresets.h1080fps15, 'detail'),
}

export type ScreenPresetId = keyof typeof SCREEN_PRESETS
