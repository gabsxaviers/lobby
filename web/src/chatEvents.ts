export type Message = { id: string; channel: string; author: string; body: string; created: string }

// Mensagens que chegam na hora pelo LiveKit (ChatListener em Call.tsx) para quem está na chamada
export const chatEvents = new EventTarget()
