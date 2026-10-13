// Cor fixa por nome, para cada pessoa ser reconhecível (cards de voz e chat)
export function nameColor(name: string) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)
  return `hsl(${hue} 55% 45%)`
}
