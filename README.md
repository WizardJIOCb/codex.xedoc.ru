# Codex Xedoc

Web client for local Codex work on `codex.xedoc.ru`.

The app is built as a fast local-first interface:

- React + Vite + TypeScript frontend
- Node + Express + WebSocket backend
- `codex app-server` bridge over stdio
- Local chat history in the browser
- Per-chat project path, model, effort, and sandbox controls

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

The backend listens on `http://localhost:8787` and exposes:

- `GET /api/health`
- `WS /api/ws`

Codex CLI must be installed and authenticated on the machine running the backend:

```bash
codex --version
codex
```

## Production

```bash
npm run build
CODEX_XEDOC_TOKEN="change-me" npm start
```

The production server serves `dist/` and the WebSocket bridge from the same Node process.

Suggested server path:

```bash
/var/www/codex.xedoc.ru
```

Suggested reverse proxy target:

```text
http://127.0.0.1:8787
```

## Notes

This is intentionally a thin client over official Codex surfaces. The browser never spawns Codex directly; it talks to the local Node bridge, and the bridge talks to `codex app-server`.

Set `CODEX_XEDOC_TOKEN` before exposing the app publicly. Without it, anyone who can reach the WebSocket endpoint can ask Codex to work on the server.
