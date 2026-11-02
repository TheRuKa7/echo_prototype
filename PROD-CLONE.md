# Echo demo: the live console on sample data

https://theruka7.github.io/echo_prototype/ runs today's live Echo console (build of 30 Oct 2026) against the mock in this repo. Nothing on it talks to a real backend.

- `site/` is what Pages serves: the live console's built files, plus `mock-sw.js`, a service worker that answers every API call with `mock/server.mjs` inside the browser. The console's API and voice addresses point at that worker.
- Sign in with any email and password. Data is synthetic and resets when the browser restarts the worker.
- The source under `src/` is an older prototype; `site/` does not use it.
- Rebuild `site/` with `node mock/browser/build-prod-site.mjs site /echo_prototype/`. It needs the live build in `prod/`, which is kept locally and not committed.

## What the mock adds for the live screens

Overview call log and status breakdown (`/api/metrics` `call_status`, `/api/calls/log`, `/api/calls/log/values`), campaign progress and status bar (`/api/campaigns/:id/metrics`), the live voice presets and retry settings (`/api/agents/meta`, `/webrtc/catalog`), one workspace as live, and Follow ups as callbacks (Scheduled, Called back, Missed, Call by hand).

## Known gaps

- Browser mic calls (console and playground) need the real voice server.
- Names, numbers and counts are sample data.
