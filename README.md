# voxlix-frontend

Angular UI for the voice-agent backend: agent authoring, campaigns, a live call
console and call history.

## Backend

Every URL the app uses lives in `src/app/core/endpoints.ts`, including the host:

```ts
export const API_BASE = 'https://qa-voice-agent.cognilix.com';
```

No path or hostname appears anywhere else. Point this at another backend and the
whole app follows — there is no proxy and no per-environment build.

Because the API is on a different origin, two things have to be true of it:

- its `CORS_ORIGINS` must list the origin serving this app, or every request
  fails in the browser with the backend none the wiser;
- whatever terminates TLS in front of it must pass WebSocket upgrades through,
  or the app loads fine and calls fail at connect (`wss://…/webrtc/stream`).

The API gates on a token, entered once in the UI and kept in `localStorage`.

## Develop

```bash
npm ci
npm start        # http://localhost:4200
```

## Build

```bash
npm run build    # → dist/frontend/browser
```

## Container

```bash
docker build -t voxlix-frontend .
docker run --rm -p 8080:80 voxlix-frontend
```

nginx serves the bundle and falls back to `index.html` so deep links reach the
router. It proxies nothing: API traffic goes straight from the browser to
`API_BASE`.

## Layout

```
src/app/core/endpoints.ts   every backend URL, and API_BASE
src/app/services/           the only code that talks to the network
src/app/pages/              overview, agents, campaigns, call console
src/app/components/         shell, gate, ribbon, icon
```
