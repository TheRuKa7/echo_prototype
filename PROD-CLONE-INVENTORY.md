# echo prod clone: inventory (30 Oct 2026)

Local clone of https://voice-ai-platform.cognilix.com, frontend only.

## How it works

- `prod/` holds the live console's built files, copied from the live site on 30 Oct 2026 (`main-SPS5T7PK.js`, `polyfills-5CFQRCPP.js`, `styles-743YBHKM.css`, `index.html`). The same build is in the saved pages under `Products/Echo/voice-ai-platform.cognilix.com`.
- `mock/prod.mjs` serves `prod/` on http://localhost:4240 and starts the mock backend (`mock/server.mjs`, ports 8090 and 8080). When it serves the JS, it rewrites the live API origins (`voice-agent-dataload.cognilix.com`, `voice-agent.cognilix.com`) to the mock, so nothing reaches the live backend.
- Run it with `node mock/prod.mjs`, or use the `echo-prod-clone` entry in `C:\rushilProcess\.claude\launch.json`. Sign in with any email and password.
- The screens, copy, buttons and flows are the live code itself. Only the data is mock data (`mock/scenario.json`, which is synthetic).
- View it in a visible browser window. A hidden or minimized pane never fires `requestAnimationFrame`, and the page can stay blank there.
- Why: no local source matches live (the source here is from 19 Oct, and live has moved on). To change the UI later (for example the new statuses in `PRD-Call-Outcome-and-Funnel.md`), get the current source from engineering or edit `prod/main-*.js`. Data and status changes can go in `mock/server.mjs`.

## Mock changes made to match live

| Live call | Change in `mock/server.mjs` |
| --- | --- |
| `GET /api/metrics?since&status&filters` | Takes `since`; adds `call_status` (the 12 live status buckets plus `attempted`/`unresolved`) and `funnel.completed` (reached and finished). |
| `GET /api/calls/log` | New. One row per dialled contact and console call: Call Date, Agent, Campaign, Uploaded by, Caller Name, Phone, Email, Call Summary, Call Status, Status Reason, Call back, Duration, Retries, Goal Reached. Supports period, status chips, column filters, paging. |
| `GET /api/calls/log/values` | New. `{values:[{value,count}], truncated}` for the column filter lists. |
| `GET /api/campaigns/:id/metrics` | New. `call_status` for the campaign page's status bar. |
| `GET /api/campaigns` | Adds `progress` ("N reached of M calls · R rows"). |
| `GET /api/campaigns/:id/responses` | Rows with answers report `status: captured`, which makes the live "Results" button appear. |
| `GET /api/agents/meta` | `engines` replaced with the live catalog (Default / Performance / Quality and Speech to speech, with the live models and ₹ per minute); adds `retry` (Advanced > retry) and `callbacks`. Voice genders capitalised as on live. |
| `GET /webrtc/catalog` | New. Empty lists, so the page falls back to the catalog above. |
| `/api/me` memberships | One workspace (Moglix) and no workspace picker, as live. `MOCK_ALL_WORKSPACES=1` brings back the PI pilot workspace. |
| Console channels | "Ozonetel SIP" (was "Ozonetel phone"). |
| Status Reason | The live wording per status, e.g. "It rang but nobody answered". |
| `GET /api/follow-ups` | Adds `items`: contacts who asked for a callback, with the live states Scheduled / Called back / Missed / Call by hand (live reads `items`; the mock only had `rows` before, so the page was empty). |
| `/api/me` for any email | One workspace for every signed-in email (before, an email outside the seed saw the PI pilot workspace too). |

## GitHub Pages build (not published)

- `node mock/browser/build-prod-site.mjs site /echo_prototype/` builds `site/`: the live build with its API bases pointed at a service worker (`mock-sw.js`) that runs this mock in the browser. The build fails if any non-public host is left. Needs esbuild and buffer (set `ESBUILD_PATH` and `NODE_PATH` if they are not installed here).
- `.github/workflows/pages.yml` now publishes `site/` as is, and `PROD-CLONE.md` is the public readme. Neither has been pushed: publishing the live build on a public repo was blocked and needs your decision.
- Checked locally under a Pages-like server in headless Chrome: sign in, Overview, Campaigns, Agents, agent detail, Console, Team, Settings, Follow ups, Docs, Playground.

## Screens and actions (checked against live, 30 Oct)

| Screen (route) | Elements compared live vs clone | Result |
| --- | --- | --- |
| Login (`/login`) | Echo by Cognilix card, Email, Password, Sign in | Same. Any credentials work locally. |
| Overview (`/overview`) | Period Today/7 days/30 days, Share (picture, PDF, sheet), funnel Dialled → Reached → Completed, Talk time, Dials per contact, Still in progress, CALL STATUS bar with 12 clickable status chips, 8 tiles (Planned cohorts, Will dial, Goal achieved, Action Required, Callbacks open, Tech failures, Avg duration, Total tokens), CALL LOG with a filter on every column header, row select (Export CSV, Download audio, Re-analyze, Clear), Analysis → link, paging Newer/Older | Same. |
| Call console (`/console`) | Agent picker, Browser mic / Ozonetel SIP, Agent voice and model, CALL DETAILS (Use samples, Clear), TRANSCRIPT, ACTIVITY, Start call | Same. The phone channel plays a scripted call. Browser mic needs the real voice server (gap). |
| Agents (`/agents`) | N AGENTS list, New agent, More actions | Same (13 live agents vs 11 mock agents). |
| Agent detail (`/agents/:key`) | Tabs Prompt / Settings / Input variables (n) / Output variables (n), Delete. Prompt: sections with ↑ ↓ On Copy Delete section, Refresh, Add section, Save prompt, Preview full prompt. Settings: About (Name, What it is for), Voice (3 preset cards, Speech to speech, Voice, Uses/Details, cost note), Calling flow, Save/Discard, Advanced (retry, row id). Inputs/Outputs: Add, Save | Same. Live also shows "Reset" on some prompt sections, depending on the agent's data. |
| Campaigns (`/campaigns`) | New campaign, ALL CAMPAIGNS count, columns Campaign / Agent / Contacts / Captured / Progress / Campaign status / Created, per-row Export and Delete | Same. |
| Campaign detail (`/campaigns/:id`) | Template, Upload data, Results, Transcripts + audio, Run campaign, CALL STATUS bar, Calls table (Contact, Call status, Answers, Dials, Talk, Last dial, Transcript, audio and open), search, Export, Download transcript | Same. |
| Contact (`/campaigns/:cid/contacts/:pid`) | Name, Dials/Talk/Started/Agent, INPUT, CALLING SUMMARY, OUTPUT, Previous call / Next call, Download/Copy transcript, player | Same. |
| Call page (`/calls/:id`) | EXECUTIVE SUMMARY, CALL CONTEXT, ACTION ITEMS, TECHNICAL DETAILS, CALL RECORDING, TRANSCRIPT (Copy, .txt), Re-analyze, Export JSON, Download audio | Same. REPORTED OUTCOME shows when the call has answers. |
| Follow ups (`/follow-ups`) | OPEN count, "to call by hand" tag, columns Contact / Phone / Campaign / Call back / Dials / Last call, state tags, Open call → | Same (fixed 30 Oct; it was empty before). |
| Team (`/team`) | USERS (role pickers, Invite with email + Generate temporary password), GROUPS (Create group) | Same. The mock has groups seeded, so it also shows group members. |
| Settings (`/settings`) | ORGANIZATION, SYSTEM HEALTH, BACKEND, Refresh | Same. |
| Documentation (`/docs`) | Getting started, Overview, Call console, Agents, Campaigns, Follow ups, Team & settings | Same. |
| Agent playground (`/playground`) | AGENT, PIPELINE CANVAS (stt/llm/tts), CALL DETAILS, TRANSCRIPT, ACTIVITY, Start test call | Same. |

Every button runs against the mock: saves, deletes, uploads (dry run and commit), dialling (simulated), downloads (generated .xlsx/.zip/.wav/.txt), invites and role changes all change in-memory state. Restart to reset.

## Gaps (not reached or not replicated)

- Browser mic calls (console and playground) need the live voice server's audio WebSocket; the mock answers 501.
- Live data is not copied: names, numbers, counts and summaries are synthetic, so counts differ (e.g. 641 dialled live vs ~93 in the mock).
- Busy, Unreachable, Blocked and Rejected had no live rows on 30 Oct, so their Status Reason wording is assumed.
- Retry presets and limits under Settings > Advanced were not opened on live; the values are assumed (tries 1 to 5, wait 5 to 1440 min).
- Destructive or outward actions were not clicked on live (delete, upload, run campaign, invite, save). Their clone behaviour comes from the live code plus the mock, not from watching live.
- The single-file build (`npm run build:single`) still builds the 19 Oct source, not the live copy in `prod/`.
