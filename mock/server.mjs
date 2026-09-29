// Local stand-in for the two Echo backends, so the live frontend runs unchanged:
//   dataload  on :8090  (API_BASE in environment.ts)
//   backend   on :8080  (WEBRTC_BASE: /webrtc/*, /api/live, webrtc start_call)
// One process serves both ports from the same in-memory state, built from the
// synthetic scenario.json. Dates are shifted so the sample reads as "today".
// It copies live behaviour on purpose, including the gaps found in Phase 0:
// rows that never connect stay "dialled", so their campaign stays "running".
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID, randomInt } from 'node:crypto';
import { writeXlsx, readXlsx, zip } from './xlsx.mjs';

const DATALOAD_PORT = Number(process.env.ECHO_API_PORT || 8090);
const BACKEND_PORT = Number(process.env.ECHO_WEBRTC_PORT || 8080);
const CLARIX_URL = process.env.CLARIX_URL || 'http://localhost:8081';

// ── Scenario, shifted to now ─────────────────────────────────────────────────
const raw = JSON.parse(readFileSync(new URL('./scenario.json', import.meta.url), 'utf8'));
// Whole days only, so the Echo and Clarix mocks agree whenever each was started.
const SHIFT = Math.floor((Date.now() - Date.parse(raw.anchor)) / 86400000) * 86400000;
const DAY_SHIFT = Math.round(SHIFT / 86400000);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DMY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const dmy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
function shift(v) {
  if (Array.isArray(v)) return v.map(shift);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)]));
  if (typeof v === 'string' && ISO.test(v)) return new Date(Date.parse(v) + SHIFT).toISOString();
  if (typeof v === 'string' && DAY_SHIFT && DMY.test(v)) {
    const [, d, m, y] = v.match(DMY);
    return dmy(new Date(Date.UTC(+y, +m - 1, +d) + DAY_SHIFT * 86400000));
  }
  return v;
}
const S = shift(raw);
// target: behave like the fixed backend in PRD-ECHO-11 (every row gets a final status).
// live: reproduce today's live gaps (unanswered rows stay "dialled" for ever).
const MODE = process.env.MOCK_BEHAVIOUR === 'live' ? 'live' : 'target';
if (MODE === 'target') {
  for (const c of S.campaigns) for (const r of c.contacts) {
    const f = r.final; if (!f) continue;
    if (f.status !== 'completed') r.status = f.status;
    Object.assign(r, { call_result: f.result || null, reason: f.reason || null, attempts: f.attempts ?? 1 });
    if (f.status === 'retry_scheduled') r.next_attempt_at = new Date(Date.now() + f.next_attempt_in_min * 60000).toISOString();
  }
}

const agents = S.agents;
// Target backend fields: who changed an agent last and when it last reached Clarix.
for (const a of agents) {
  a.updated_at ||= a.created_at;
  a.updated_by ||= S.operators[0];
  if (a.sync_status === 'synced') a.synced_at ||= a.updated_at;
}
const campaigns = S.campaigns;
const calls = S.calls;
const analyses = {};
let liveCall = null;

const ORG = { org_id: 'org_moglix', org_name: 'Moglix', role: 'org_admin' };
const users = [
  { user_id: 'u_admin', email: 'admin@example.com', role: 'org_admin', agent_admin: true, platform_admin: true },
  ...S.operators.map((email, i) => ({ user_id: `u_op${i + 1}`, email, role: i < 2 ? 'campaign_manager' : 'user', agent_admin: false, platform_admin: false })),
];
const groups = [
  { group_id: 'g_proc', org_id: ORG.org_id, name: 'Procurement ops', created_by: 'u_admin', member_ids: ['u_op1', 'u_op2', 'u_op3'] },
  { group_id: 'g_rfx', org_id: ORG.org_id, name: 'RFX desk', created_by: 'u_admin', member_ids: ['u_op4'] },
];
let signedInEmail = 'admin@example.com';

// ── Reference data ───────────────────────────────────────────────────────────
const PROVIDERS = [{ key: 'gemini', label: 'Gemini' }, { key: 'grok', label: 'Grok' }];
const VOICES = {
  gemini: [['Kore', 'female'], ['Aoede', 'female'], ['Leda', 'female'], ['Zephyr', 'female'], ['Puck', 'male'], ['Charon', 'male'], ['Fenrir', 'male'], ['Orus', 'male']],
  grok: [['Ara', 'female'], ['Eve', 'female'], ['Leo', 'male'], ['Rex', 'male'], ['Sal', 'neutral']],
};
const OZN_CAMPAIGNS = [
  { name: 'PAAS_postpo', type: 'IVR', did: '08000000101' },
  { name: 'RFX_reminder', type: 'IVR', did: '08000000102' },
  { name: 'PAAS_followup', type: 'Progressive', did: '08000000103' },
];
const PLACEHOLDERS = [
  { token: '{{current_date}}', name: 'current_date', label: 'Today', description: 'Date of the call, filled in when the call starts' },
  { token: '{{current_time}}', name: 'current_time', label: 'Time now', description: 'Local time when the call starts' },
  { token: '{{current_day}}', name: 'current_day', label: 'Weekday', description: 'Day of the week when the call starts' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();
const agentByKey = (k) => agents.find((a) => a.key === k);
const campaignById = (id) => campaigns.find((c) => c.campaign_id === id);
const callById = (id) => calls.find((c) => c.call_id === id) || (liveCall?.call_id === id ? liveCall : null);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
const HAS_CALL = new Set(['captured', 'disconnected_early', 'no_outputs', 'completed']);
const NOT_REACHED = new Set(['no_answer', 'busy', 'rejected', 'unreachable', 'retry_exhausted', 'retry_scheduled']);
const ATTEMPTED = new Set(['dialled', 'calling', 'in_progress', 'failed', 'blocked', 'invalid_number', ...HAS_CALL, ...NOT_REACHED]);
const OPEN = new Set(['pending', 'queued', 'dialled', 'calling', 'in_progress', 'retry_scheduled']);

function campaignStatus(c) {
  if (!c.contacts.length) return 'ready';
  if (c.contacts.every((x) => x.status === 'input_validation_failed' || x.reason === 'data_validation_failed')) return 'failed';
  if (c.stopped && !c.contacts.some((x) => x.attempts || HAS_CALL.has(x.status))) return 'cancelled';
  if (c.contacts.some((x) => OPEN.has(x.status))) return c.paused ? 'paused' : 'running';
  if (c.contacts.some((x) => x.status === 'cancelled')) return 'partially_completed';
  return 'completed';
}
function campaignSummary(c) {
  const a = agentByKey(c.agent);
  return {
    campaign_id: c.campaign_id, name: c.name, agent: c.agent, provider: c.provider, source: c.source,
    description: c.description, created_at: c.created_at, status: campaignStatus(c),
    contacts_count: c.contacts.length,
    responses_count: c.contacts.filter((x) => HAS_CALL.has(x.status)).length,
    dialled_count: c.contacts.filter((x) => ATTEMPTED.has(x.status)).length,
    counts: c.contacts.reduce((m, x) => { const k = x.status === 'captured' || x.status === 'disconnected_early' ? `completed:${x.call_result || (x.status === 'captured' ? 'conversation' : 'disconnected_early')}` : x.status; m[k] = (m[k] || 0) + 1; return m; }, {}),
    schema: { label: a?.label || c.agent },
  };
}
function callRow(c) {
  return {
    call_id: c.call_id, started_at: c.started_at, contact_name: c.contact_name,
    contact_name_matched_by: c.campaign_id ? 'campaign' : '', phone: c.phone, agent: c.agent,
    duration_seconds: c.duration_seconds, status: c.status, num_turns: c.num_turns,
    campaign_name: c.campaign_name || '', summary: c.summary, total_tokens: c.total_tokens, call_result: c.call_result || null,
  };
}
function filterCalls(q) {
  let list = [...calls, ...(liveCall ? [liveCall] : [])];
  if (q.get('hours')) { const t = Date.now() - Number(q.get('hours')) * 3600000; list = list.filter((c) => Date.parse(c.started_at) >= t); }
  if (q.get('campaign_id')) list = list.filter((c) => c.campaign_id === q.get('campaign_id'));
  if (q.get('min_duration')) list = list.filter((c) => (c.duration_seconds || 0) >= Number(q.get('min_duration')));
  if (q.get('max_duration')) list = list.filter((c) => (c.duration_seconds || 0) <= Number(q.get('max_duration')));
  const term = (q.get('q') || '').trim().toLowerCase();
  if (term) list = list.filter((c) => [c.contact_name, c.phone, c.campaign_name, c.call_id, c.agent, c.summary].some((v) => String(v || '').toLowerCase().includes(term)));
  return list.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}
const outputsOf = (call) => {
  const t = [...(call?.events || [])].reverse().find((e) => e.kind === 'TOOL_CALL' && e.tool === 'submit_call_outputs');
  return t?.args || null;
};
const summarise = (outputs, turns, userTurns) => {
  if (outputs && Object.keys(outputs).length) return Object.entries(outputs).map(([k, v]) => `${k}: ${v}`).join(' · ');
  if (!userTurns) return `Agent spoke, caller never did (${turns} turn${turns === 1 ? '' : 's'})`;
  return `Ended without a reported outcome (${turns} turns)`;
};

function metrics(days) {
  const from = Date.now() - days * 86400000;
  const inWindow = campaigns.filter((c) => Date.parse(c.created_at) >= from);
  const rows = inWindow.flatMap((c) => c.contacts.map((x) => ({ ...x, agent: c.agent })));
  const gated = rows.filter((r) => r.status === 'input_validation_failed' || r.reason === 'data_validation_failed' || r.reason === 'duplicate_row' || !agentByKey(r.agent)?.ozonetel_campaign).length;
  const attempted = rows.filter((r) => ATTEMPTED.has(r.status)).length;
  const connected = rows.filter((r) => HAS_CALL.has(r.status)).length;
  const achieved = rows.filter((r) => r.status === 'captured').length;
  const inconclusive = connected - achieved;
  const callbacks = rows.filter((r) => r.status === 'captured' && (r.outputs?.callback_time || r.outputs?.callback_date)).length;
  const cs = calls.filter((c) => Date.parse(c.started_at) >= from);
  const sum = (f) => cs.reduce((n, c) => n + (Number(f(c)) || 0), 0);
  const rate = (a, b) => (b ? a / b : 0);
  return {
    funnel: {
      planned: rows.length, campaigns: inWindow.length, will_dial: rows.length - gated, gated,
      attempted, connected, connected_rate: rate(connected, attempted),
      achieved, achieved_rate: rate(achieved, connected),
      inconclusive, inconclusive_rate: rate(inconclusive, connected),
      callbacks_open: callbacks, tech_failures: rows.filter((r) => r.status === 'failed' && r.reason === 'congestion').length,
    },
    active_calls: liveCall ? 1 : 0,
    avg_duration_seconds: cs.length ? Math.round((sum((c) => c.duration_seconds) / cs.length) * 10) / 10 : 0,
    avg_turns_per_call: cs.length ? Math.round((sum((c) => c.num_turns) / cs.length) * 10) / 10 : 0,
    total_tokens: sum((c) => c.total_tokens), total_turns: sum((c) => c.num_turns), total_calls: cs.length,
    storage_connected: true,
  };
}

function analyse(call) {
  const o = outputsOf(call) || {};
  const status = String(o.status || '');
  const callback = o.callback_time || o.callback_date;
  const accepted = /accept/i.test(status) || o.po_acceptance_intent === 'ACCEPTED' || o.aligned === true;
  const priority = o.escalate_to || /not received|issue|wrong/i.test(status) ? 'High' : callback ? 'Medium' : 'Low';
  const actions = [];
  if (callback) actions.push(`Call back at ${callback}`);
  if (/not received|copy/i.test(status)) actions.push('Resend the PO copy to the supplier by email');
  if (o.escalate_to) actions.push(`Escalate to ${o.escalate_to}`);
  if (!Object.keys(o).length) actions.push('Retry the call; no outcome was reported');
  return {
    priority, issue_resolved: Object.keys(o).length ? accepted : false,
    executive_summary: call.summary,
    call_purpose: agentByKey(call.agent)?.description || `Outbound call by ${agentByKey(call.agent)?.label || call.agent}`,
    issue_category: status || 'No outcome', suggested_issue: accepted ? '' : status || 'Caller did not engage',
    action_items: actions, analyzed_at: nowIso(),
  };
}

// A few seconds of quiet tone so the audio player has something real to play.
function wav(seconds) {
  const rate = 8000, n = Math.round(rate * Math.min(Math.max(seconds || 6, 3), 30));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate, on = Math.floor(t / 1.6) % 2 === 0 ? 1 : 0.15;
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * (on > 0.5 ? 220 : 180) * t) * 1800 * on * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t))), 44 + i * 2);
  }
  return buf;
}

// ── Agent sync to Clarix (target behaviour: every save pushes) ───────────────
function touch(a) {
  a.updated_at = nowIso();
  a.updated_by = signedInEmail;
  if (a.synced_platform) pushAgent(a);
}
async function pushAgent(a) {
  a.sync_status = 'pending';
  const body = {
    id: a.key, name: a.label, description: a.description || '', ozonetel_campaign: a.ozonetel_campaign || '', voice: a.voice || 'Aoede',
    provider: a.providers?.[0] || 'gemini', direction: 'outbound', version: Date.parse(a.updated_at),
    input_fields: a.input_variables.map((v) => ({ key: v.key, type: v.type, required: true, label: v.key, share_on_call: v.share_on_call !== false })),
    output_fields: a.output_variables.map((v) => ({ key: v.key, type: v.type, required: !!v.required, label: v.label, description: v.description, options: v.options })),
  };
  try {
    const r = await fetch(`${CLARIX_URL}/public/webhooks/exchange/agents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Clarix answered ${r.status}`);
    Object.assign(a, { sync_status: 'synced', sync_last_error: null, synced_at: nowIso() });
  } catch (e) {
    // Clarix not running: keep the state honest instead of pretending.
    Object.assign(a, { sync_status: 'failed', sync_last_error: `Could not reach Clarix (${e.message})` });
  }
}

// ── Agent views ──────────────────────────────────────────────────────────────
function testerAgent(a) {
  return {
    key: a.key, label: a.label,
    providers: a.providers.map((p) => ({
      key: p, label: PROVIDERS.find((x) => x.key === p)?.label || p,
      default_voice: a.voice || VOICES[p]?.[0]?.[0] || '',
      voices: (VOICES[p] || []).map(([name, gender]) => ({ name, gender })),
    })),
    input_variables: a.input_variables, output_variables: a.output_variables,
    input_columns: a.input_variables.map((v) => v.key), ozonetel_campaign: a.ozonetel_campaign || '',
  };
}
function generated(a) {
  const input = ['## Call details', '', ...a.input_variables.filter((v) => v.share_on_call !== false).map((v) => `- ${v.key}: {{${v.key}}}`)].join('\n');
  const output = ['## Outcome reporting', '', 'Before you end the call, call submit_call_outputs once with these fields:', '',
    ...a.output_variables.map((v) => `- ${v.key} (${v.type}${v.options?.length ? `: one of ${v.options.join(' | ')}` : ''})${v.required ? ', required' : ''}: ${v.description || v.label || ''}`)].join('\n');
  return { input, output, derived: [] };
}
function promptFrom(a, sections) {
  const g = generated(a);
  return sections.filter((s) => s.enabled !== false)
    .map((s) => (s.kind === 'input' || s.kind === 'output') && !(s.body || '').trim() ? g[s.kind] : s.body || '')
    .join('\n\n');
}

// ── Dialling simulation ──────────────────────────────────────────────────────
// Mirrors live: about half the rows connect; the rest stay "dialled" because the
// no-answer / busy result never comes back.
function scriptFor(agentKey) {
  const donor = calls.filter((c) => c.agent === agentKey && outputsOf(c));
  const pick = donor.length ? donor[randomInt(donor.length)] : calls.find((c) => outputsOf(c));
  return pick;
}
const REASON_OF = { no_answer: 'no_answer', busy: 'destination_busy', unreachable: 'subscriber_absent', failed: 'congestion' };
function settleRow(camp, row, status, extra = {}) {
  Object.assign(row, { status, reason: REASON_OF[status] || null, call_result: null, next_attempt_at: null, ...extra });
  notifyClarix(camp, row);
}
function placeCampaignCall(camp, row) {
  if (row.status === 'cancelled') return;
  const roll = Math.random();
  if (MODE === 'target') {
    row.attempts = (row.attempts || 0) + 1;
    row.status = 'calling'; notifyClarix(camp, row);
    // Not reached this time: retry up to 3 attempts, 20 s apart so a demo sees it move.
    const miss = roll < 0.18 ? 'no_answer' : roll < 0.27 ? 'busy' : roll < 0.33 ? 'unreachable' : roll < 0.36 ? 'failed' : null;
    if (miss) {
      if (row.attempts < 3 && miss !== 'failed') {
        settleRow(camp, row, 'retry_scheduled', { reason: REASON_OF[miss], next_attempt_at: new Date(Date.now() + 20000).toISOString() });
        setTimeout(() => placeCampaignCall(camp, row), 20000);
      } else {
        settleRow(camp, row, row.attempts >= 3 ? 'retry_exhausted' : miss, row.attempts >= 3 ? { reason: REASON_OF[miss] } : {});
      }
      return;
    }
  } else if (roll < 0.45) return; // stays "dialled", as live
  const donor = scriptFor(camp.agent);
  const started = new Date();
  const id = `40715900${randomInt(10000000, 99999999)}`;
  const captured = roll > 0.7 && donor;
  const events = captured
    ? donor.events.filter((e) => e.kind !== 'CALL_CONTEXT').map((e, i) => ({ ...e, ts: new Date(started.getTime() + (i + 1) * 4000).toISOString() }))
    : [{ kind: 'AGENT_TURN', text: `Namaste, main ${agentByKey(camp.agent)?.label?.split(' ')[0] || 'Echo'} bol rahi hoon. Kya aap mujhe sun pa rahe hain?`, ts: new Date(started.getTime() + 2000).toISOString() }];
  const outputs = captured ? outputsOf({ events }) : null;
  const turns = events.filter((e) => e.kind.endsWith('_TURN')).length;
  const dur = captured ? turns * 4 + 3 : 8 + randomInt(10);
  const call = {
    call_id: id, called_number: OZN_CAMPAIGNS[0].did, agent: camp.agent, agent_key: `ozonetel/${camp.agent}/${camp.provider}`,
    campaign_id: camp.campaign_id, contact_name: row.name, phone: row.phone, duration_seconds: dur,
    started_at: started.toISOString(), ended_at: new Date(started.getTime() + dur * 1000).toISOString(),
    mode: 'telephony', num_turns: turns, provider: camp.provider, source: 'campaign', status: 'completed',
    summary: summarise(outputs, turns, events.some((e) => e.kind === 'USER_TURN')),
    telephony_provider: 'ozonetel', tools_called: captured ? ['submit_call_outputs'] : [], total_tokens: turns * 13000,
    turn_shape: captured ? 'au' : 'a', variant: 'full', recording_source: 'ozonetel', recording_url: '',
    disconnect_reason: captured ? 'agent_end_call' : 'caller_hangup', campaign_name: camp.name,
    context: { ...row.context, contact_name: row.name, contact_phone: row.phone },
    events: [{ kind: 'CALL_CONTEXT', ts: started.toISOString(), context: row.context }, ...events], outputs,
  };
  calls.push(call);
  Object.assign(row, {
    status: captured ? 'captured' : 'disconnected_early', call_id: id, recording_call_id: id,
    captured_at: captured ? call.ended_at : null, outputs: outputs || {},
    call_result: captured ? 'conversation' : 'no_response', reason: null, next_attempt_at: null,
  });
  call.call_result = row.call_result;
  notifyClarix(camp, row, call);
}
// live: only connected calls, two fields. target: every change, with the PRD-ECHO-11 fields.
function notifyClarix(camp, row, call = null) {
  if (camp.source !== 'clarix') return;
  const connected = row.status === 'captured' || row.status === 'disconnected_early';
  if (MODE === 'live' && !connected) return;
  const body = MODE === 'live' ? { referenceId: row.primary_id, status: 'COMPLETED' } : {
    referenceId: row.primary_id, version: Date.now(), campaign_status: campaignStatus(camp).toUpperCase(),
    call_status: (connected ? 'completed' : row.status).toUpperCase(), call_result: row.call_result ? row.call_result.toUpperCase() : null,
    call_reason: row.reason ? row.reason.toUpperCase() : null, attempt_number: row.attempts || 1, max_attempts: 3,
    next_attempt_at: row.next_attempt_at || null, outputs: row.outputs || {}, talk_seconds: call ? Math.round(call.duration_seconds) : null,
    call_id: row.call_id || null, updated_at: nowIso(),
  };
  fetch(`${CLARIX_URL}/__mock/exchange-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
}
function dialCampaign(camp) {
  const rows = camp.contacts.filter((r) => r.status === 'pending' || r.status === 'dialled');
  rows.forEach((row, i) => {
    row.status = MODE === 'target' ? 'queued' : 'dialled';
    row.dispatched_at = nowIso();
    setTimeout(() => placeCampaignCall(camp, row), 6000 + i * 2500);
  });
  return rows.length;
}

// Console phone call: a scripted conversation revealed a turn at a time on /api/live.
function startConsoleCall(body) {
  const a = agentByKey(body.agent);
  const donor = scriptFor(body.agent);
  const context = { ...(body.context || {}) };
  // Swap the donor call's name and plant for what the operator typed in.
  const swaps = [[donor?.contact_name?.split(' ')[0], context.contact_name?.split(' ')[0]], [donor?.context?.plant_name, context.plant_name]]
    .filter(([from, to]) => from && to && from !== to);
  const swap = (t) => swaps.reduce((s, [from, to]) => s.split(from).join(to), t || '');
  const script = (donor?.events || []).filter((e) => e.kind !== 'CALL_CONTEXT').map((e) => (e.text ? { ...e, text: swap(e.text) } : e));
  const started = new Date(Date.now() + 4000);
  const id = `40715900${randomInt(10000000, 99999999)}`;
  const phone = String(body.to || '').replace(/^\+91/, '');
  liveCall = {
    call_id: id, started_at: started.toISOString(), agent: body.agent, agent_key: `ozonetel/${body.agent}/${body.provider}`,
    contact_name: context.contact_name || '', phone, provider: body.provider, mode: 'telephony', source: 'console',
    status: 'in_progress', num_turns: 0, duration_seconds: 0, campaign_id: '', campaign_name: '', summary: '',
    total_tokens: 0, context, events: [{ kind: 'CALL_CONTEXT', ts: started.toISOString(), context }],
  };
  const live = liveCall;
  script.forEach((e, i) => setTimeout(() => {
    if (liveCall !== live) return;
    live.events.push({ ...e, ts: nowIso() });
    live.num_turns = live.events.filter((x) => x.kind.endsWith('_TURN')).length;
    live.duration_seconds = Math.round((Date.now() - started.getTime()) / 1000);
  }, 4000 + (i + 1) * 3000));
  setTimeout(() => {
    if (liveCall !== live) return;
    const outputs = outputsOf(live);
    Object.assign(live, {
      status: 'completed', ended_at: nowIso(), duration_seconds: Math.round((Date.now() - started.getTime()) / 1000),
      summary: summarise(outputs, live.num_turns, live.events.some((x) => x.kind === 'USER_TURN')),
      outputs, tools_called: outputs ? ['submit_call_outputs'] : [], total_tokens: live.num_turns * 13000,
      telephony_provider: 'ozonetel', recording_source: 'ozonetel', recording_url: '', disconnect_reason: 'agent_end_call',
      contact_name: live.contact_name || a?.label || '',
    });
    calls.push(live);
    liveCall = null;
  }, 4000 + (script.length + 1) * 3000 + 1500);
  return id;
}

// ── Upload parsing ───────────────────────────────────────────────────────────
function multipart(req, buf) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] || '');
  if (!m) return {};
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const out = {};
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const part = buf.slice(start + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    const head = part.slice(0, sep).toString('utf8');
    const name = /name="([^"]+)"/.exec(head)?.[1];
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    const content = part.slice(sep + 4);
    if (name) out[name] = filename !== undefined ? { filename, content } : content.toString('utf8');
    start = next;
  }
  return out;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function proposeMapping(agent, headers) {
  return agent.input_variables.map((v, i) => {
    let index = headers.findIndex((h) => norm(h) === norm(v.key));
    let matched_by = index >= 0 ? 'name' : '';
    if (index < 0 && i < headers.length && !headers[i]) { index = i; matched_by = 'position'; }
    return {
      column: v.key, index: index >= 0 ? index : null, header: index >= 0 ? headers[index] : null, matched_by: matched_by || null,
      required: v.type === 'phone' || v.key === agent.primary_id_key,
      role: v.type === 'phone' ? 'dial' : v.key === agent.primary_id_key ? 'primary_id' : null,
    };
  });
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const json = (res, status, body) => { res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const file = (res, buf, type, name, inline = false) => {
  res.writeHead(200, { ...CORS, 'Content-Type': type, 'Content-Length': buf.length, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"` });
  res.end(buf);
};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fail = (res, status, error) => json(res, status, { error });

const routes = [];
const on = (method, pattern, fn, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn, ...opts });

on('POST', '/api/auth/login', ({ res, body }) => {
  if (!body?.email || !body?.password) return fail(res, 401, 'Wrong email or password');
  signedInEmail = String(body.email);
  json(res, 200, { access_token: `local-${randomUUID()}`, user_id: 'u_admin' });
}, { open: true });
on('GET', '/api/me', ({ res }) => json(res, 200, { user_id: 'u_admin', email: signedInEmail, platform_admin: true, agent_admin: true, memberships: [ORG] }));

// Team
on('GET', '/api/orgs/:org/users', ({ res }) => json(res, 200, users));
on('POST', '/api/orgs/:org/users', ({ res, body }) => {
  if (users.some((u) => u.email === body.email)) return fail(res, 409, 'That email is already a member');
  const u = { user_id: `u_${randomUUID().slice(0, 8)}`, email: body.email, role: body.role || 'user', agent_admin: false, platform_admin: false };
  users.push(u); json(res, 201, u);
});
on('PATCH', '/api/orgs/:org/users/:user/role', ({ res, p, body }) => {
  const u = users.find((x) => x.user_id === p.user); if (!u) return fail(res, 404, 'User not found');
  u.role = body.role; json(res, 200, u);
});
on('DELETE', '/api/orgs/:org/users/:user', ({ res, p }) => {
  const i = users.findIndex((x) => x.user_id === p.user); if (i < 0) return fail(res, 404, 'User not found');
  users.splice(i, 1); groups.forEach((g) => { g.member_ids = g.member_ids.filter((m) => m !== p.user); }); json(res, 200, {});
});
on('PATCH', '/api/admin/users/:user/agent-admin', ({ res, p, body }) => {
  const u = users.find((x) => x.user_id === p.user); if (!u) return fail(res, 404, 'User not found');
  u.agent_admin = !!body.agent_admin; json(res, 200, u);
});
on('GET', '/api/orgs/:org/groups', ({ res }) => json(res, 200, groups));
on('POST', '/api/orgs/:org/groups', ({ res, body }) => {
  const g = { group_id: `g_${randomUUID().slice(0, 8)}`, org_id: ORG.org_id, name: body.name, created_by: 'u_admin', member_ids: [] };
  groups.push(g); json(res, 201, g);
});
on('PATCH', '/api/orgs/:org/groups/:g', ({ res, p, body }) => { const g = groups.find((x) => x.group_id === p.g); if (!g) return fail(res, 404, 'Group not found'); g.name = body.name; json(res, 200, g); });
on('DELETE', '/api/orgs/:org/groups/:g', ({ res, p }) => { const i = groups.findIndex((x) => x.group_id === p.g); if (i >= 0) groups.splice(i, 1); json(res, 200, {}); });
on('POST', '/api/orgs/:org/groups/:g/members', ({ res, p, body }) => { const g = groups.find((x) => x.group_id === p.g); if (!g) return fail(res, 404, 'Group not found'); if (!g.member_ids.includes(body.userId)) g.member_ids.push(body.userId); json(res, 200, g); });
on('DELETE', '/api/orgs/:org/groups/:g/members/:user', ({ res, p }) => { const g = groups.find((x) => x.group_id === p.g); if (!g) return fail(res, 404, 'Group not found'); g.member_ids = g.member_ids.filter((m) => m !== p.user); json(res, 200, g); });
on('GET', '/api/orgs/:org/sync-platforms', ({ res }) => json(res, 200, [{ platform_key: 'clarix', label: 'Clarix' }]));

// Metrics and calls
on('GET', '/api/metrics', ({ res, q }) => json(res, 200, metrics(Number(q.get('days') || 30))));
on('GET', '/api/calls', ({ res, q }) => {
  const list = filterCalls(q);
  json(res, 200, { calls: list.slice(0, Number(q.get('limit') || 50)).map(callRow), total: list.length, storage_connected: true });
});
on('GET', '/api/calls/report.xlsx', ({ res, q }) => {
  const rows = [['Call ID', 'Started', 'Contact', 'Phone', 'Agent', 'Campaign', 'Duration (s)', 'Turns', 'Summary'],
    ...filterCalls(q).map((c) => [c.call_id, c.started_at, c.contact_name, c.phone, c.agent, c.campaign_name, c.duration_seconds, c.num_turns, c.summary])];
  file(res, writeXlsx(rows, 'Calls'), XLSX, 'calls-report.xlsx');
});
on('GET', '/api/calls/:id', ({ res, p }) => {
  const c = callById(p.id); if (!c) return fail(res, 404, 'Call not found');
  json(res, 200, { ...c, analysis: analyses[c.call_id] || null });
});
on('POST', '/api/calls/:id/analyze', ({ res, p }) => {
  const c = callById(p.id); if (!c) return fail(res, 404, 'Call not found');
  setTimeout(() => json(res, 200, (analyses[c.call_id] = analyse(c))), 1200);
});
on('GET', '/api/live', ({ res }) => json(res, 200, { call: liveCall }));

// Agents
on('GET', '/webrtc/agents', ({ res }) => json(res, 200, agents.map(testerAgent)));
on('GET', '/api/agents', ({ res }) => json(res, 200, {
  agents: agents.map((a) => ({ key: a.key, label: a.label, description: a.description || '', providers: a.providers, input_count: a.input_variables.length, output_count: a.output_variables.length, primary_id_key: a.primary_id_key, ozonetel_campaign: a.ozonetel_campaign || '', synced_platform: a.synced_platform, sync_status: a.sync_status, sync_last_error: a.sync_last_error, synced_at: a.synced_at || null, created_at: a.created_at, updated_at: a.updated_at, updated_by: a.updated_by })),
  storage_connected: true,
}));
on('GET', '/api/agents/meta', ({ res }) => json(res, 200, {
  providers: PROVIDERS,
  voices: Object.entries(VOICES).flatMap(([p, vs]) => vs.map(([name, gender]) => ({ name, provider: p, provider_label: PROVIDERS.find((x) => x.key === p).label, gender }))),
  section_kinds: ['text', 'input', 'output'],
  output_types: ['string', 'number', 'boolean', 'enum', 'date'],
  input_types: ['string', 'phone', 'number', 'date', 'email'],
  input_transforms: ['', 'phonetic'],
  placeholders: PLACEHOLDERS, runtime_tokens: PLACEHOLDERS.map((x) => x.name),
  channels: [{ key: 'webrtc', label: 'Browser mic', configured: true }, { key: 'ozonetel', label: 'Ozonetel phone', configured: true }],
}));
on('GET', '/api/agents/schema', ({ res }) => json(res, 200, { agents: agents.map(testerAgent) }));
on('POST', '/api/agents/refresh', ({ res }) => json(res, 200, { count: agents.length }));
on('POST', '/api/agents', ({ res, body }) => {
  const key = slug(body.label);
  if (!key) return fail(res, 400, 'Give the agent a name');
  if (agentByKey(key)) return fail(res, 409, `An agent called "${body.label}" already exists`);
  const from = body.copy_from ? agentByKey(body.copy_from) : null;
  const a = {
    key, label: body.label, description: body.description || '', voice: from?.voice || '',
    ozonetel_campaign: body.ozonetel_campaign || '', ozonetel_type: body.ozonetel_type || '',
    primary_id_key: from?.primary_id_key || 'contact_phone', primary_id_label: from?.primary_id_label || 'contact_phone',
    providers: from?.providers || ['gemini'],
    input_variables: structuredClone(from?.input_variables || [{ key: 'contact_name', type: 'string', transform: '', sample: 'Test Supplier', share_on_call: true }, { key: 'contact_phone', type: 'phone', transform: '', sample: '9000000000', share_on_call: true }]),
    output_variables: structuredClone(from?.output_variables || []),
    sections: structuredClone(from?.sections || [{ id: 'sec_1', enabled: true, title: 'IDENTITY', kind: 'text', body: '' }, { id: 'sec_2', enabled: true, title: 'Call details', kind: 'input', body: '' }, { id: 'sec_3', enabled: true, title: 'Outcome reporting', kind: 'output', body: '' }]),
    synced_platform: null, sync_status: null, sync_last_error: null, synced_at: null, created_at: nowIso(), updated_at: nowIso(), updated_by: signedInEmail,
  };
  agents.unshift(a); json(res, 201, { agent: a });
});
on('GET', '/api/agents/:key', ({ res, p }) => { const a = agentByKey(p.key); a ? json(res, 200, { agent: a }) : fail(res, 404, 'Agent not found'); });
on('PUT', '/api/agents/:key', ({ res, p, body }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  for (const k of ['label', 'description', 'voice', 'ozonetel_campaign', 'ozonetel_type', 'primary_id_key', 'primary_id_label']) if (k in body) a[k] = body[k];
  touch(a);
  json(res, 200, { agent: a });
});
on('DELETE', '/api/agents/:key', ({ res, p }) => {
  const i = agents.findIndex((a) => a.key === p.key); if (i < 0) return fail(res, 404, 'Agent not found');
  const used = campaigns.filter((c) => c.agent === p.key).length;
  agents.splice(i, 1);
  json(res, 200, used ? { note: `${used} campaign(s) still reference this agent; their history is kept.` } : {});
});
on('PUT', '/api/agents/:key/sections', ({ res, p, body }) => { const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found'); a.sections = body.sections || []; touch(a); json(res, 200, { agent: a }); });
on('PUT', '/api/agents/:key/inputs', ({ res, p, body }) => { const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found'); a.input_variables = body.variables || []; touch(a); json(res, 200, { agent: a }); });
on('PUT', '/api/agents/:key/outputs', ({ res, p, body }) => { const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found'); a.output_variables = body.variables || []; touch(a); json(res, 200, { agent: a }); });
on('GET', '/api/agents/:key/generated', ({ res, p }) => { const a = agentByKey(p.key); a ? json(res, 200, generated(a)) : fail(res, 404, 'Agent not found'); });
on('POST', '/api/agents/:key/preview', ({ res, p, body }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  json(res, 200, { prompt: promptFrom(a, body?.sections || a.sections), draft: Boolean(body?.sections) });
});
on('POST', '/api/agents/:key/sync', ({ res, p, body }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  // Target behaviour: sync can be repeated at any time; it pushes the current agent.
  a.synced_platform = body.platform_key || a.synced_platform || 'clarix';
  pushAgent(a);
  json(res, 200, { agent: a });
});
on('GET', '/api/agents/:key/template.xlsx', ({ res, p }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  file(res, writeXlsx([a.input_variables.map((v) => v.key), a.input_variables.map((v) => v.sample ?? '')], 'Contacts'), XLSX, `${a.key}_template.xlsx`);
});

// Campaigns
on('GET', '/api/campaigns', ({ res }) => json(res, 200, {
  campaigns: [...campaigns].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(campaignSummary), storage_connected: true,
}));
on('POST', '/api/campaigns', ({ res, body }) => {
  const a = agentByKey(body.agent); if (!a) return fail(res, 400, 'Pick an agent');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const c = {
    campaign_id: `${slug(a.label).replace(/_/g, '-')}-${randomUUID().slice(0, 8)}`, name: `${a.label} - ${stamp}`,
    agent: a.key, provider: body.provider || a.providers[0], source: 'internal', direction: body.direction || 'outbound',
    description: body.description || '', created_at: nowIso(), contacts: [], clarix_batch_id: null,
  };
  campaigns.push(c); json(res, 201, { campaign_id: c.campaign_id });
});
on('GET', '/api/campaigns/:id', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  const a = agentByKey(c.agent);
  json(res, 200, { ...campaignSummary(c), direction: c.direction, schema: {
    label: a?.label || c.agent, output_variables: a?.output_variables || [], primary_id_label: a?.primary_id_label || 'Primary id',
    ozonetel_campaign: a?.ozonetel_campaign || '', input_columns: a?.input_variables.map((v) => v.key) || [],
  } });
});
on('DELETE', '/api/campaigns/:id', ({ res, p }) => { const i = campaigns.findIndex((c) => c.campaign_id === p.id); if (i >= 0) campaigns.splice(i, 1); json(res, 200, {}); });
on('GET', '/api/campaigns/:id/contacts', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  json(res, 200, { contacts: c.contacts.map((x) => ({ primary_id: x.primary_id, phone: x.phone, name: x.name, status: x.status, call_result: x.call_result || null, reason: x.reason || null, attempts: x.attempts ?? null, next_attempt_at: x.next_attempt_at || null, validation_error: x.validation_error || null, recording_call_id: x.recording_call_id || null })) });
});
on('GET', '/api/campaigns/:id/responses', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  json(res, 200, { responses: c.contacts.filter((x) => HAS_CALL.has(x.status) || (MODE === 'live' && x.status === 'dialled')).map((x) => ({ primary_id: x.primary_id, name: x.name, phone: x.phone, status: x.status, call_result: x.call_result || null, captured_at: x.captured_at || null, call_id: x.call_id || null, outputs: x.outputs || {} })) });
});
on('GET', '/api/campaigns/:id/contacts/:pid', ({ res, p }) => {
  const c = campaignById(p.id); const x = c?.contacts.find((r) => r.primary_id === p.pid);
  if (!x) return fail(res, 404, 'Contact not found');
  const call = x.call_id ? callById(x.call_id) : null;
  const transcript = (call?.events || []).filter((e) => e.kind !== 'CALL_CONTEXT').map((e) =>
    e.kind === 'TOOL_CALL' ? { role: 'tool', text: '', ts: e.ts, tool: e.tool, args: e.args } : { role: e.kind === 'USER_TURN' ? 'user' : 'agent', text: e.text || '', ts: e.ts });
  json(res, 200, {
    contact: { name: x.name, phone: x.phone }, status: x.status, call_result: x.call_result || null, reason: x.reason || null, attempts: x.attempts ?? null,
    response: { validation_error: x.validation_error || null },
    call: call ? { duration_seconds: call.duration_seconds, num_turns: call.num_turns, matched_by: 'campaign' } : null,
    audio: { available: Boolean(call), call_id: call?.call_id || null },
    outputs: x.outputs || {}, transcript,
  });
});
on('POST', '/api/campaigns/:id/upload', ({ res, p, q, req, raw: buf }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  const a = agentByKey(c.agent); if (!a?.ozonetel_campaign) return fail(res, 400, 'This agent is not mapped to an Ozonetel campaign');
  if (c.contacts.length) return fail(res, 409, 'This campaign already has its contact list');
  const form = multipart(req, buf);
  if (!form.file?.content) return fail(res, 400, 'No file received');
  let rows;
  try { rows = readXlsx(form.file.content); } catch { return fail(res, 400, 'Could not read that spreadsheet'); }
  if (!rows.length) return fail(res, 400, 'The sheet is empty');
  const [headers, ...data] = rows;
  const proposal = proposeMapping(a, headers);
  if (q.get('dry_run') === 'true') {
    return json(res, 200, { mapping: proposal, sheet_headers: headers, sample_rows: data.slice(0, 5), parsed_rows: data.length });
  }
  const map = form.mapping ? JSON.parse(form.mapping) : Object.fromEntries(proposal.map((m) => [m.column, m.index]));
  const phoneKey = a.input_variables.find((v) => v.type === 'phone')?.key;
  c.contacts = data.map((r, i) => {
    const ctx = Object.fromEntries(Object.entries(map).filter(([, idx]) => idx !== null && idx !== undefined).map(([k, idx]) => [k, String(r[idx] ?? '').trim()]));
    const phone = (ctx[phoneKey] || '').replace(/\D/g, '').slice(-10);
    const bad = phone.length !== 10 ? `${phoneKey || 'phone'} "${ctx[phoneKey] || ''}" is not a valid number` : null;
    return { primary_id: ctx[a.primary_id_key] || `row-${i + 1}`, name: ctx.contact_name || ctx.supplier_name || `Row ${i + 1}`, phone, context: ctx, row: i + 1, status: bad ? 'input_validation_failed' : 'pending', validation_error: bad, outputs: {} };
  });
  const dialled = dialCampaign(c);
  json(res, 200, { stored: c.contacts.length, dial: { dialled, ozonetel_campaign: a.ozonetel_campaign } });
});
on('POST', '/api/campaigns/:id/dial', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  json(res, 200, { dialled: dialCampaign(c), ozonetel_campaign: agentByKey(c.agent)?.ozonetel_campaign || '' });
});
// Target backend: Stop ends a campaign. Rows not yet dialled become Cancelled (not dialled).
on('POST', '/api/campaigns/:id/stop', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  c.stopped = true;
  let n = 0;
  for (const r of c.contacts) if (OPEN.has(r.status) && r.status !== 'calling' && r.status !== 'in_progress') { settleRow(c, r, 'cancelled', { reason: 'not_dialled_stopped' }); n++; }
  json(res, 200, { stopped: n, status: campaignStatus(c) });
});
on('GET', '/api/campaigns/:id/template.xlsx', ({ res, p }) => {
  const c = campaignById(p.id); const a = agentByKey(c?.agent); if (!a) return fail(res, 404, 'Campaign not found');
  file(res, writeXlsx([a.input_variables.map((v) => v.key), a.input_variables.map((v) => v.sample ?? '')], 'Contacts'), XLSX, `${c.campaign_id}_template.xlsx`);
});
on('GET', '/api/campaigns/:id/responses.xlsx', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  const outs = agentByKey(c.agent)?.output_variables.map((v) => v.key) || [];
  const rows = [['primary_id', 'name', 'phone', 'status', 'captured_at', 'call_id', ...outs],
    ...c.contacts.map((x) => [x.primary_id, x.name, x.phone, x.status, x.captured_at || '', x.call_id || '', ...outs.map((k) => x.outputs?.[k] ?? '')])];
  file(res, writeXlsx(rows, 'Responses'), XLSX, `${c.campaign_id}_responses.xlsx`);
});
on('GET', '/api/campaigns/:id/export.zip', ({ res, p, q }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  const include = (q.get('include') || 'transcripts,audio').split(',');
  const files = {};
  for (const x of c.contacts) {
    const call = x.call_id && callById(x.call_id); if (!call) continue;
    if (include.includes('transcripts')) files[`transcripts/${x.primary_id}.txt`] = call.events.filter((e) => e.kind.endsWith('_TURN')).map((e) => `${e.kind === 'AGENT_TURN' ? 'Agent' : 'Caller'}: ${e.text}`).join('\n');
    if (include.includes('audio')) files[`audio/${x.primary_id}.wav`] = wav(call.duration_seconds);
  }
  if (!Object.keys(files).length) files['README.txt'] = 'No calls connected yet.';
  file(res, zip(files), 'application/zip', `${c.campaign_id}.zip`);
});

// Clarix mock pairing: a sheet uploaded in the local Clarix becomes a Clarix-sourced
// campaign here and is dialled at once, as live.
on('POST', '/__mock/clarix-batch', ({ res, body }) => {
  const a = agentByKey(body.agent);
  if (!a) return fail(res, 400, `Unknown agent ${body.agent}`);
  const c = {
    campaign_id: `${slug(a.label).replace(/_/g, '-')}-${body.batchId}-${randomUUID().slice(0, 8)}`, name: body.name,
    agent: a.key, provider: a.providers[0], source: 'clarix', direction: 'outbound', description: 'Submitted via clarix',
    created_at: nowIso(), clarix_batch_id: body.batchId,
    contacts: (body.rows || []).map((r, i) => ({ primary_id: r.primary_id, name: r.name, phone: r.phone, email: r.email, context: r.context || {}, row: i + 1, status: 'pending', outputs: {} })),
  };
  campaigns.push(c);
  json(res, 200, { campaign_id: c.campaign_id, dialled: dialCampaign(c) });
}, { open: true });

// Telephony, recordings, console calls
on('GET', '/ozonetel/campaigns', ({ res }) => json(res, 200, { campaigns: OZN_CAMPAIGNS }));
on('POST', '/ozonetel/start_call', ({ res, body }) => {
  if (!agentByKey(body.agent)) return fail(res, 400, 'Unknown agent');
  if (liveCall) return fail(res, 409, 'A call is already running');
  const id = startConsoleCall(body);
  json(res, 200, { status: 'success', custom_sid: id });
});
on('POST', '/webrtc/start_call', ({ res }) => fail(res, 501, 'Browser calls need the real voice backend; the local mock only simulates phone calls'));
on('GET', '/webrtc/recording/:sid/status', ({ res }) => json(res, 200, { ready: true }));
on('GET', '/webrtc/recording/:sid', ({ res, p, q }) => file(res, wav(callById(p.sid)?.duration_seconds), 'audio/wav', `${p.sid}.wav`, q.get('download') !== '1'), { open: true });

// ── Server ───────────────────────────────────────────────────────────────────
function handler(port) {
  return (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/health') {
      return json(res, 200, port === BACKEND_PORT
        ? { status: 'ok', telephony: { ozonetel_configured: true } }
        : { status: 'ok', version: 'local-mock', base_url: `http://localhost:${port}` });
    }
    const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) return fail(res, 404, `No mock for ${req.method} ${url.pathname}`);
    if (!route.open && !url.searchParams.get('token')) return fail(res, 401, 'Not signed in');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      let body = {};
      if ((req.headers['content-type'] || '').includes('application/json') && buf.length) {
        try { body = JSON.parse(buf.toString('utf8')); } catch { return fail(res, 400, 'Bad JSON'); }
      }
      const p = Object.fromEntries(Object.entries(route.re.exec(url.pathname).groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      try { route.fn({ req, res, url, q: url.searchParams, p, body, raw: buf }); }
      catch (e) { console.error(e); fail(res, 500, e.message); }
    });
  };
}

for (const port of [DATALOAD_PORT, BACKEND_PORT]) {
  http.createServer(handler(port)).listen(port, () => console.log(`[echo-mock] listening on http://localhost:${port}`));
}
console.log(`[echo-mock] ${agents.length} agents, ${campaigns.length} campaigns, ${calls.length} calls. Sign in with any email and password.`);
