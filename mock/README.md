# Local mock backend

Runs the live Echo console code unchanged on your machine, with no access to
the real backends, telephony or database.

```
npm ci
npm run start:local        # mock on :8090 and :8080, app on http://localhost:4210
```

Sign in with any email and any password (for example `admin@example.com` /
`local-mock`). Nothing is checked.

## Files

| File | What it does |
| --- | --- |
| `server.mjs` | Serves every endpoint in `src/app/core/endpoints.ts` from memory. Port 8090 stands in for dataload, 8080 for the voice backend. |
| `scenario.json` | Synthetic sample data: 10 agents, 12 campaigns, 93 contacts, 55 calls, 9 Clarix batches. No real people, numbers or emails. The Clarix mock loads the same file, so both products show the same calls. |
| `build-scenario.mjs` | Regenerates `scenario.json` (`npm run mock:scenario`). Seeded, so the output is always the same. |
| `xlsx.mjs` | Tiny .xlsx reader and writer for templates, uploads and reports. |
| `dev.mjs` | Starts the mock and `ng serve` together. |

## Behaviour

- Dates are shifted so the newest batch always looks like it arrived this morning.
- State lives in memory. Restart the mock to reset it.
- Uploading a sheet dials it. About half the rows connect a few seconds later
  (captured or disconnected early). The rest stay "dialled" forever and the
  campaign stays "running". This copies live on purpose: live never receives a
  no answer, busy or blocked result, which is finding PF-01 in the Phase 0 review.
- Call console, Ozonetel phone channel: dialling plays a scripted conversation
  on the transcript, a turn every 3 seconds, then saves it to the call log.
  No phone is rung.
- Call console, Browser mic channel: not simulated. It needs the real voice
  backend's audio WebSocket.
- Recordings are a few seconds of generated tone, so the player works.
- Settings shows Ozonetel as "not configured", exactly like live, because
  dataload's `/health` has no telephony block.
