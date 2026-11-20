// Enterprise shell (same file in Echo and Clarix): who owns each Action needed row, one page per supplier,
// the security center, and an audit log of every change and export. Demo data only: SSO, SCIM and deletion
// are recorded, not carried out against a real identity provider or store.
import { onDnc } from './wave1.mjs';
import { memoryOf } from './wave2.mjs';

const ten = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);
const nowIso = () => new Date().toISOString();

// ── People and assignment ──
export const PEOPLE = ['admin@example.com', 'ops.buyer1@example.com', 'ops.buyer2@example.com', 'priya.nair@example.com', 'rahul.mehra@example.com'];
const assignedByOrg = new Map();
const assignMap = (org = 'org_moglix') => { const k = org || 'org_moglix'; if (!assignedByOrg.has(k)) assignedByOrg.set(k, new Map()); return assignedByOrg.get(k); };
export const assigneeOf = (id, org = 'org_moglix') => assignMap(org).get(id) || null;
export function assign(ids, to, by, org = 'org_moglix') {
  if (!PEOPLE.includes(to)) return { error: 'Pick someone from the team' };
  const m = assignMap(org);
  for (const id of ids) m.set(id, { to, by, at: nowIso() });
  return { ok: ids.length };
}

// ── Audit log: every change and export, newest first. Entries are never edited or removed. ──
const auditByOrg = new Map();
function auditStore(org = 'org_moglix') {
  const k = org || 'org_moglix';
  if (!auditByOrg.has(k)) {
    const arr = [];
    if (k === 'org_moglix') {
      const d = (h) => new Date(Date.now() - h * 3600e3).toISOString();
      arr.push(
        { at: d(3), who: 'ops.buyer1@example.com', area: 'Agents', action: 'Published a version', target: 'saniya_post_po_clarix' },
        { at: d(9), who: 'admin@example.com', area: 'Security', action: 'Changed security settings', target: 'session timeout 8 h' },
        { at: d(26), who: 'ops.buyer2@example.com', area: 'Exports', action: 'Downloaded calls/export.xlsx', target: '' },
        { at: d(30), who: 'admin@example.com', area: 'Do-not-call list', action: 'Added 9876500011: Asked by email to stop calls (ticket 4182)', target: 'dnc' },
        { at: d(50), who: 'ops.buyer1@example.com', area: 'Campaigns', action: 'Started a campaign from a sheet', target: 'new-campaign/start' },
      );
    }
    auditByOrg.set(k, arr);
  }
  return auditByOrg.get(k);
}
const AREA = [
  [/\/follow-ups\/actions\/bulk$/, 'Action needed', (b) => `Bulk: ${b.action}${b.to ? ' to ' + b.to : ''} on ${(b.ids || []).length} rows`],
  [/\/follow-ups\/actions\/[^/]+$/, 'Action needed', (b, m) => `${b.action}${b.to ? ' to ' + b.to : ''}`],
  [/\/dnc\/remove$/, 'Do-not-call list', (b) => `Removed ${b.phone}: ${b.reason || ''}`],
  [/\/dnc\/settings$/, 'Do-not-call list', (b) => `Auto-add ${b.auto === false ? 'off' : 'on'}`],
  [/\/dnc$/, 'Do-not-call list', (b) => `Added ${b.phone}: ${b.reason || ''}`],
  [/\/alerts$/, 'Alerts', () => 'Changed alert rules'],
  [/\/campaigns\/[^/]+\/resume$/, 'Campaigns', () => 'Resumed a paused campaign'],
  [/\/campaigns\/[^/]+\/stop$/, 'Campaigns', () => 'Stopped a campaign'],
  [/\/new-campaign\/start$/, 'Campaigns', () => 'Started a campaign from a sheet'],
  [/\/call-handling\/[^/]+$/, 'Agents', () => 'Changed call handling'],
  [/\/versions\/[^/]+\/publish$/, 'Agents', () => 'Published a version'],
  [/\/versions\/[^/]+\/draft$/, 'Agents', () => 'Edited a draft version'],
  [/\/versions\/[^/]+\/split$/, 'Agents', (b) => `A/B split ${b.on ? 'on, ' + b.b_pct + '% to the draft' : 'off'}`],
  [/\/quality\/[^/]+$/, 'Agents', () => 'Changed quality checks'],
  [/\/retry-rules\/[^/]+$/, 'Agents', () => 'Changed a retry rule'],
  [/\/agent-stats\/[^/]+$/, 'Agents', () => 'Changed metrics'],
  [/\/data-sources\/[^/]+\/run$/, 'Data sources', () => 'Ran a data source now'],
  [/\/data-sources\/test$/, 'Data sources', () => 'Tested a connection'],
  [/\/data-sources\/[^/]+$/, 'Data sources', () => 'Saved a data source'],
  [/\/calling-rules\/[^/]+\/reset$/, 'Calling rules', () => 'Reset a country to its defaults'],
  [/\/calling-rules\/[^/]+$/, 'Calling rules', () => 'Changed calling rules'],
  [/\/telephony\/connect$/, 'Telephony', (b) => `Connected ${b.carrier}`],
  [/\/telephony\/[^/]+\/disconnect$/, 'Telephony', () => 'Disconnected a carrier'],
  [/\/telephony\/slots$/, 'Telephony', () => 'Changed slots or number rotation'],
  [/\/live\/[^/]+\/[a-z]+$/, 'Live calls', (b, m) => `Live call: ${m.input.split('/').pop()}`],
  [/\/access\/(unit|user|grant|role|type)(\/[^/]+)?$/, 'Team and access', (b, m) => `${m.method === 'DELETE' ? 'Removed' : m.method === 'POST' ? 'Added' : 'Changed'} ${{ unit: 'a sub-org or team', user: 'a person', grant: 'a role for a person', role: 'a role', type: 'a user type' }[m[1]]}${b.name || b.email || b.label ? ': ' + (b.name || b.email || b.label) : b.status ? ': ' + b.status : ''}`],
  [/\/security\/delete-contact$/, 'Security', (b) => (b.confirm ? `Deleted all data for ${b.phone}: ${b.reason || ''}` : `Previewed deleting ${b.phone}`)],
  [/\/security\/scim\/token$/, 'Security', () => 'Generated a new SCIM token'],
  [/\/security\/sso\/test$/, 'Security', () => 'Tested single sign-on'],
  [/\/security$/, 'Security', () => 'Changed security settings'],
  [/\/call\/[^/]+\/outcome$/, 'Calls', (b) => `Changed a call outcome to ${b.status_reason}`],
  [/\/call\/[^/]+\/messages$/, 'Calls', (b) => `Sent a ${b.channel} message`],
  [/\/calls\/rerun$/, 'Calls', () => 'Re-ran answers on the calls in view'],
];
/** The thing a request acted on, when it reads as a name (an agent key, a country, a number); '' for ids and verbs. */
function targetOf(path) {
  const parts = decodeURIComponent(path).split('/').filter(Boolean);
  const VERBS = new Set(['bulk', 'test', 'token', 'settings', 'security', 'alerts', 'dnc', 'remove', 'run', 'publish', 'draft', 'split', 'connect', 'disconnect', 'slots', 'start', 'reset', 'resume', 'stop', 'rerun', 'outcome', 'messages', 'delete-contact', 'actions', 'sso', 'scim', 'calling', 'report', 'reports', 'v1', 'api', 'new-campaign', 'listen', 'takeover', 'transfer', 'end']);
  const t = [...parts].reverse().find((x) => !VERBS.has(x)) || '';
  return /[0-9a-f]{12,}|:|^[0-9a-f-]{20,}$/i.test(t) || t.length > 60 ? '' : t;
}
/** Logs a write (or an export) from the request line. Reads are not logged; exports are. */
export function auditRequest(method, path, body = {}, who = 'you', org = 'org_moglix') {
  const audit = auditStore(org);
  const isExport = method === 'GET' && /export|\.xlsx$|\.csv$|template/.test(path);
  if (method === 'GET' && !isExport) return;
  if (method === 'GET') { audit.unshift({ at: nowIso(), who, area: 'Exports', action: `Downloaded ${decodeURIComponent(path.split('/').pop())}`, target: '' }); return; }
  for (const [re, area, say] of AREA) { const m = re.exec(path); if (!m) continue; m.input = path; m.method = method;
    audit.unshift({ at: nowIso(), who, area, action: String(say(body || {}, m)).slice(0, 200), target: targetOf(path) }); break; }
  if (audit.length > 2000) audit.length = 2000;
}
export function auditView({ q = '', who = 'all', area = 'all', days = 0 } = {}, org = 'org_moglix') {
  const audit = auditStore(org);
  const t = String(q).trim().toLowerCase(); const since = Number(days) ? Date.now() - Number(days) * 864e5 : 0;
  const list = audit.filter((e) => (who === 'all' || e.who === who) && (area === 'all' || e.area === area) && (!since || Date.parse(e.at) >= since) && (!t || `${e.action} ${e.target} ${e.who}`.toLowerCase().includes(t)));
  return { rows: list.slice(0, 500), total: list.length, people: [...new Set(audit.map((e) => e.who))].sort(), areas: [...new Set(audit.map((e) => e.area))].sort() };
}
export const AUDIT_COLUMNS = [['at', 'When'], ['who', 'Who'], ['area', 'Area'], ['action', 'What'], ['target', 'On']];

// ── Security center ──
const defaultSecurity = () => ({
  sso: { on: false, protocol: 'saml', provider: 'okta', metadata_url: '', client_id: '', domain: 'example.com', enforce: false, tested: null },
  scim: { on: false, base_url: 'https://scim.echo.example/v2', token_hint: '' },
  mfa_required: true, session_hours: 8, ip_allowlist: '',
  residency: { region: 'India (Mumbai)', backups: 'India (Hyderabad)', note: 'Calls, recordings and transcripts are stored and processed in India.' },
  retention: { recordings_days: 90, transcripts_days: 365, contacts_days: 730 },
  pii_redaction: true, consent_announcement: false, mask_numbers_for_viewers: true, recording_link_hours: 24,
  pii_categories: ['credit_card', 'bank_account', 'password', 'pin'],
  guardrails: { input: ['jailbreaking'], output: ['harassment', 'self_harm', 'sexual_exploitation', 'violence', 'child_safety'] },
});
const securityByOrg = new Map();
const securityObj = (org = 'org_moglix') => {
  const k = org || 'org_moglix';
  if (!securityByOrg.has(k)) securityByOrg.set(k, defaultSecurity());
  return securityByOrg.get(k);
};
export const securityView = (org = 'org_moglix') => structuredClone(securityObj(org));
export function saveSecurity(b = {}, org = 'org_moglix') {
  const s = securityObj(org); const n = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number(v) || d));
  if (b.sso) Object.assign(s.sso, { on: !!b.sso.on, protocol: b.sso.protocol === 'oidc' ? 'oidc' : 'saml', provider: String(b.sso.provider || 'okta'), metadata_url: String(b.sso.metadata_url || '').slice(0, 300),
    client_id: String(b.sso.client_id || '').slice(0, 120), domain: String(b.sso.domain || '').slice(0, 120), enforce: !!b.sso.enforce && !!s.sso.tested?.ok });
  if (b.scim) s.scim.on = !!b.scim.on;
  if ('mfa_required' in b) s.mfa_required = !!b.mfa_required;
  if ('session_hours' in b) s.session_hours = n(b.session_hours, 1, 72, 8);
  if ('ip_allowlist' in b) s.ip_allowlist = String(b.ip_allowlist || '').slice(0, 500);
  if (b.retention) s.retention = { recordings_days: n(b.retention.recordings_days, 7, 3650, 90), transcripts_days: n(b.retention.transcripts_days, 7, 3650, 365), contacts_days: n(b.retention.contacts_days, 30, 3650, 730) };
  if ('pii_redaction' in b) s.pii_redaction = !!b.pii_redaction;
  if ('consent_announcement' in b) s.consent_announcement = !!b.consent_announcement;
  if (Array.isArray(b.pii_categories)) {
    s.pii_categories = [...new Set(b.pii_categories.map(String).filter(Boolean))];
    s.pii_redaction = s.pii_categories.length > 0;
  }
  if (b.guardrails && typeof b.guardrails === 'object') {
    s.guardrails = {
      input: [...new Set((b.guardrails.input || []).map(String).filter(Boolean))],
      output: [...new Set((b.guardrails.output || []).map(String).filter(Boolean))],
    };
  }
  if ('mask_numbers_for_viewers' in b) s.mask_numbers_for_viewers = !!b.mask_numbers_for_viewers;
  if ('recording_link_hours' in b) s.recording_link_hours = n(b.recording_link_hours, 1, 168, 24);
  return securityView(org);
}
export function testSso(b = {}, org = 'org_moglix') {
  const sec = securityObj(org);
  const sso = { ...sec.sso, ...(b.sso || {}) }; const steps = [];
  const has = sso.protocol === 'saml' ? !!String(sso.metadata_url).trim() : !!String(sso.client_id).trim();
  steps.push({ label: 'Settings filled in', ok: has, detail: has ? 'Found what the identity provider needs.' : sso.protocol === 'saml' ? 'Paste the metadata URL from your identity provider.' : 'Fill in the client ID.' });
  if (has) {
    const bad = /fail/i.test(sso.metadata_url + sso.client_id);
    steps.push({ label: 'Reached the identity provider', ok: !bad, detail: bad ? 'The metadata URL did not answer. Check it and that it is reachable from the internet.' : 'Signing certificate valid until 12 Mar 2028.' });
    if (!bad) { steps.push({ label: 'Test sign-in', ok: true, detail: `Signed in as you@${sso.domain || 'example.com'}; email and name came back.` }); steps.push({ label: 'Domain', ok: true, detail: `Everyone with an @${sso.domain || 'example.com'} address signs in through ${sso.provider}.` }); }
  }
  const ok = steps.every((s) => s.ok); sec.sso.tested = { ok, at: nowIso() }; return { ok, steps };
}
export function newScimToken(org = 'org_moglix') {
  const sec = securityObj(org);
  const t = 'scim_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  sec.scim.on = true; sec.scim.token_hint = '••••' + t.slice(-4);
  return { token: t, ...securityView(org) };
}
/** Deleting a contact: preview what would go, then remove it with a reason (rows are hidden from every list in the demo). */
const deletedByOrg = new Map();
const deletedSet = (org = 'org_moglix') => { const k = org || 'org_moglix'; if (!deletedByOrg.has(k)) deletedByOrg.set(k, new Set()); return deletedByOrg.get(k); };
export const isDeleted = (phone, org = 'org_moglix') => deletedSet(org).has(ten(phone));
export function deleteContact(rows, { phone, confirm = false, reason = '' } = {}, org = 'org_moglix') {
  const p = ten(phone); if (p.length !== 10) return { error: 'Enter a 10-digit number' };
  const mine = rows.filter((r) => ten(r.phone) === p);
  const preview = { phone: p, calls: mine.length, recordings: mine.filter((r) => r.call_status === 'Answered').length, campaigns: [...new Set(mine.map((r) => r.campaign))].length, on_dnc: !!onDnc(p, org) };
  if (!confirm) return { preview };
  if (!String(reason).trim()) return { error: 'Say why (for example the request reference)' };
  deletedSet(org).add(p); return { preview, deleted: true, note: 'Calls, recordings, transcripts and answers for this number are deleted. The number stays on the do-not-call list if it was there, so it is never called again.' };
}

// ── Supplier 360: everything about one number across campaigns ──
export function supplierView(rows, phone, actions = [], org = 'org_moglix') {
  const p = ten(phone); const mine = rows.filter((r) => ten(r.phone) === p).sort((a, b) => String(b.call_date || '').localeCompare(String(a.call_date || '')));
  if (!mine.length) return null;
  const answered = mine.filter((r) => r.call_status === 'Answered'); const ok = answered.filter((r) => String(r.status_reason).startsWith('Success') && r.status_reason !== 'Success: Negative');
  const pos = new Map();
  for (const r of mine) {
    const rawPos = [
      ...String(r.inputs?.po_numbers || r.inputs?.po_number || r.inputs?.order_no || '').split(',').map((x) => x.trim()),
      ...Array.from(String(r.inputs?.rows || '').matchAll(/po_number:\s*([^\s·,\n]+)/gi), (m) => m[1].trim()),
    ].filter(Boolean);
    for (const po of rawPos) {
      const e = pos.get(po) || { po, campaigns: new Set(), last: null, result: '' }; e.campaigns.add(r.campaign); if (!e.last || String(r.call_date) > String(e.last)) { e.last = r.call_date; e.result = r.status_reason || r.call_status; } pos.set(po, e);
    }
  }
  const promises = mine.flatMap((r) => Object.entries(r.answers || {}).filter(([k, v]) => /date|dispatch|delivery|promise/i.test(k) && v).map(([k, v]) => ({ what: k.replace(/_/g, ' '), value: String(v), at: r.call_date, campaign: r.campaign, id: r.id }))).slice(0, 10);
  const mem = memoryOf(rows, { ...mine[0], id: '__supplier__', call_date: null }, true, org);
  return {
    phone: p, name: mine.find((r) => r.caller_name)?.caller_name || p, email: mine.find((r) => r.email)?.email || '', agents: [...new Set(mine.map((r) => r.agent))], dnc: onDnc(p, org),
    stats: { calls: mine.length, answered: answered.length, success: ok.length, campaigns: new Set(mine.map((r) => r.campaign_id)).size, last_call: mine.find((r) => r.call_date)?.call_date || null },
    open_actions: actions, pos: [...pos.values()].map((e) => ({ po: e.po, campaigns: [...e.campaigns], last: e.last, result: e.result })).slice(0, 30), promises,
    memory: mem?.lines || [], calls: mine.slice(0, 50).map((r) => ({ id: r.id, at: r.call_date, campaign: r.campaign, agent: r.agent, status: r.call_status, reason: r.status_reason || r.call_status, summary: eSummary(r) })),
  };
}
const eSummary = (r) => r.summary || '';
