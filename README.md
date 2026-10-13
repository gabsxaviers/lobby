# Lobby

Chamadas em grupo com voz e transmissão de tela. React + Vite no front, LiveKit como SFU, API mínima em Node.

```
web/      React + TS + Vite (livekit-client, @livekit/components-react)
server/   Node 24 + TS sem build: cadastro/login (SQLite nativo) e token do LiveKit
docker-compose.yml   LiveKit em modo dev
```

## Rodar em desenvolvimento

Com o Docker Desktop aberto, tudo sobe junto (grupo `lobby`: `lobby_livekit`, `lobby_api`, `lobby_web`):

```bash
docker compose up -d
```

Para hot reload, rode `npm run dev` em `server/` e `web/` direto no Windows (pare `lobby_api` e `lobby_web` antes, por causa das portas).

Abra http://localhost:5173 em duas janelas (uma anônima), crie duas contas e entre no mesmo canal.

Teste da API: `cd server && npm test`.

## Configuração

- `server/.env` (copie de `.env.example`): porta, origens permitidas (CORS), caminho do banco, URL e chaves do LiveKit.
- `web/.env`: `VITE_API_URL` (padrão `http://localhost:3001`).

## API

| Rota | Auth | Corpo | Resposta |
|---|---|---|---|
| `POST /register` | — | `{name, password}` | `{name, session}` |
| `POST /login` | — | `{name, password}` | `{name, session}` |
| `GET /me` | Bearer | — | `{name}` |
| `POST /logout` | Bearer | — | `{}` |
| `POST /livekit-token` | Bearer | `{room}` | `{url, token}` |

## Electron (próxima fase)

O front já usa token Bearer e URL da API por env, então roda sem mudanças. Falta criar `desktop/`:
`setDisplayMediaRequestHandler` no main (seletor próprio via `desktopCapturer.getSources` + IPC, áudio `loopback` no Windows),
`contextBridge` no preload e `setPermissionRequestHandler` liberando `media` só para a origem do app.
