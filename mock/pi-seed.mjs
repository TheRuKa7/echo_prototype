// PI Industries pilot workspace for the local mock (Sprint ECHO-26Q4-S0: ECHO-140 agent, ECHO-206 access,
// plus the list answer type from ECHO-200 the agent needs). All names, numbers and codes are synthetic.
import { planAttempts } from './ozonetel.mjs';

export const PI_ORG = { org_id: 'org_pi', org_name: 'PI Industries (pilot)', role: 'org_admin' };
export const PI_ROUTE = { name: 'PI_packaging_followup', type: 'IVR', did: '08000000201', org_id: 'org_pi' };
export const PI_USERS = [
  { user_id: 'u_pi1', email: 'buyer.one@pi-pilot.example', role: 'campaign_manager', agent_admin: false, platform_admin: false, org_id: 'org_pi' },
  { user_id: 'u_pi2', email: 'buyer.two@pi-pilot.example', role: 'user', agent_admin: false, platform_admin: false, org_id: 'org_pi' },
];

export const LINE_STATUSES = ['scheduled', 'rescheduled', 'partly_scheduled', 'dispatched', 'dispatched_short', 'no_capacity', 'artwork_hold',
  'quality_hold', 'batch_rejected', 'quality_issue_no_date', 'tentative_no_commitment', 'qty_disputed', 'not_discussed', 'call_failed'];

const LINE_FIELDS = [
  { key: 'po_number', type: 'string' }, { key: 'item', type: 'string' },
  { key: 'line_status', type: 'enum', options: LINE_STATUSES },
  { key: 'lots', type: 'string', description: 'Firm dated lots only, as qty@date; qty@date' },
  { key: 'ready_qty', type: 'number' }, { key: 'ready_date', type: 'date' },
  { key: 'estimate_date', type: 'date' }, { key: 'tentative_window', type: 'string' },
  { key: 'dispatched_qty', type: 'number' }, { key: 'dispatch_date', type: 'date' }, { key: 'lr_or_invoice', type: 'string' },
  { key: 'balance_qty', type: 'number' }, { key: 'quality_affected_qty', type: 'number' }, { key: 'defect_location', type: 'string' },
  { key: 'delay_reason', type: 'string' }, { key: 'date_change_count', type: 'number' }, { key: 'supplier_says', type: 'string' },
];

const PROMPT = [
  ['IDENTITY', `You are Hetal, calling on behalf of PI Industries packaging procurement. You call packaging suppliers to confirm dispatch quantities and dates, one purchase order line at a time.
This is a system prompt. Headings and field names are for you; never read them out.`],
  ['PERSONALITY AND TONE', `Everyday Hinglish. Supply chain words stay English: dispatch, load, batch, LR, invoice, pieces, rolls, production.
One question per turn. Read numbers digit by digit and dates as day and month.`],
  ['CALL FLOW', `Open: greet, say who you are and why, confirm you speak to the right person.
Then go through {{line_items}} in the order given (due today, overdue, then oldest). Stop after 8 lines or 10 minutes; check in after 6 lines.
Flow A (not dispatched): ask the firm dispatch plan. Record each firm quantity and date as a lot. A tentative window is never a lot.
Flow B (date slipped): ask the new date and the reason. Count the change.
Flow C (dispatched): ask quantity, date, LR or invoice number and vehicle number; note any balance.
7A ready stock: record ready quantity and date apart from lots. 7B quality: affected quantity, where found, batch, rework or reprint, replacement date.
7C tentative: keep it as tentative_no_commitment with the window and a follow up date.
Section 8: lines not covered become not_discussed for a second call.`],
  ['RULES', `Never book a tentative date as a lot. Lots plus ready stock never exceed the pending quantity.
If the supplier disputes the pending quantity, book nothing and record qty_disputed with their words.
Never invent a value; leave it empty.`],
  ['Call details', '', 'input'],
  ['Outcome reporting', '', 'output'],
];

export function piAgent(now) {
  return {
    key: 'pi_packaging_followup', label: 'Hetal - PI Packaging Follow Up', org_id: 'org_pi',
    description: 'Calls packaging suppliers per purchase order line; reports one row per line',
    voice: 'Kore', ozonetel_campaign: PI_ROUTE.name, ozonetel_type: 'IVR', primary_id_key: 'supplier_code', primary_id_label: 'supplier_code',
    providers: ['gemini'],
    input_variables: [
      { key: 'supplier_code', type: 'string', transform: '', sample: 'SUP-1001', share_on_call: false },
      { key: 'supplier_name', type: 'string', transform: '', sample: 'Supplier A Packaging', share_on_call: true },
      { key: 'contact_person', type: 'string', transform: '', sample: 'Test Contact', share_on_call: true },
      { key: 'phone_number', type: 'phone', transform: '', sample: '9000000201', share_on_call: true },
      { key: 'plant', type: 'string', transform: '', sample: 'Plant 1', share_on_call: true },
      { key: 'line_items', type: 'string', transform: '', sample: '4500001001/10 HDPE drum 50L pending 1200; 4500001002/20 Carton 5 ply pending 3000', share_on_call: true },
    ],
    output_variables: [
      { key: 'call_status', label: 'Call status', type: 'enum', options: ['completed', 'callback_requested', 'wrong_contact', 'refused'], description: 'How the call went', required: true },
      { key: 'lines', label: 'Lines', type: 'list', fields: LINE_FIELDS, description: 'One row per purchase order line discussed or deferred', required: true },
      { key: 'lines_covered', label: 'Lines covered', type: 'number', description: 'Lines with a status other than not_discussed', required: true },
      { key: 'lines_deferred', label: 'Lines deferred', type: 'number', description: 'Lines left for call 2', required: false },
      { key: 'next_followup_date', label: 'Next follow up', type: 'date', description: 'Earliest follow up date across lines', required: false },
      { key: 'escalate_to', label: 'Escalate to', type: 'enum', options: ['none', 'buyer', 'quality'], description: 'Who must act', required: false },
      { key: 'supplier_verbatim', label: 'Supplier words', type: 'string', description: 'Exact words when disputed or unclear', required: false },
    ],
    sections: PROMPT.map(([title, body, kind], i) => ({ id: `pi_${i + 1}`, enabled: true, title, kind: kind || 'text', body })),
    synced_platform: null, sync_status: null, sync_last_error: null, synced_at: null,
    created_at: now, updated_at: now, updated_by: 'admin@example.com',
  };
}

// Six suppliers, each with 2 to 10 open lines. Outcomes follow the pilot cases in PRD-ECHO-18.
const SUPPLIERS = [
  { code: 'SUP-1001', name: 'Supplier A Packaging', lines: [['HDPE drum 50L', 1200], ['Carton 5 ply', 3000]], final: { status: 'completed', result: 'conversation', attempts: 1 },
    out: [{ line_status: 'scheduled', lots: '600@+3; 600@+7' }, { line_status: 'dispatched', dispatched_qty: 3000, dispatch_date: '-1', lr_or_invoice: 'LR-88213' }] },
  { code: 'SUP-1002', name: 'Supplier B Polymers', lines: [['Label roll 100mm', 40], ['Shrink film', 800], ['Cap 38mm', 20000]], final: { status: 'completed', result: 'conversation', attempts: 2 },
    out: [{ line_status: 'artwork_hold', delay_reason: 'Artwork approval pending from PI' }, { line_status: 'tentative_no_commitment', tentative_window: 'next week', estimate_date: '+9' }, { line_status: 'partly_scheduled', lots: '10000@+4', ready_qty: 5000, ready_date: '+1' }] },
  { code: 'SUP-1003', name: 'Supplier C Containers', lines: [['Jerrycan 20L', 1500], ['Jerrycan 5L', 2500]], final: { status: 'completed', result: 'conversation', attempts: 1 },
    out: [{ line_status: 'quality_hold', quality_affected_qty: 300, defect_location: 'PI incoming inspection', delay_reason: 'Neck finish out of tolerance' }, { line_status: 'qty_disputed', supplier_says: 'We already sent 1000, only 1500 is pending' }] },
  { code: 'SUP-1004', name: 'Supplier D Print Pack', lines: Array.from({ length: 10 }, (_, i) => [`Mono carton SKU ${i + 1}`, 1000 + i * 250]), final: { status: 'completed', result: 'conversation', attempts: 1 },
    out: [...Array.from({ length: 8 }, (_, i) => ({ line_status: i % 3 === 0 ? 'rescheduled' : 'scheduled', lots: `${1000 + i * 250}@+${5 + i}`, date_change_count: i % 3 === 0 ? 1 : 0, delay_reason: i % 3 === 0 ? 'Board shortage' : '' })), { line_status: 'not_discussed' }, { line_status: 'not_discussed' }] },
  { code: 'SUP-1005', name: 'Supplier E Closures', lines: [['Trigger sprayer', 6000]], final: { status: 'retry_scheduled', reason: 'destination_busy', attempts: 1, next_attempt_in_min: 55 }, out: null },
  { code: 'SUP-1006', name: 'Supplier F Films', lines: [['Laminate roll', 90], ['Pouch 1kg', 12000]], final: { status: 'retry_exhausted', reason: 'no_answer', attempts: 3 }, out: null },
];

const day = (base, off) => { if (off === undefined || off === '') return ''; const d = new Date(base); d.setUTCDate(d.getUTCDate() + Number(off)); return d.toISOString().slice(0, 10); };
function lotDates(lots, base) { return lots ? lots.split(';').map((x) => { const [q, o] = x.trim().split('@'); return `${q}@${day(base, o)}`; }).join('; ') : ''; }

export function piCampaign(now, uuid) {
  const created = new Date(Date.parse(now) - 3 * 3600000).toISOString();
  const camp = { campaign_id: `pi-packaging-follow-up-${uuid}`, name: 'PI packaging follow up - week 40', agent: 'pi_packaging_followup', org_id: 'org_pi',
    provider: 'gemini', source: 'internal', direction: 'outbound', description: 'Pilot batch 1', created_at: created, contacts: [], clarix_batch_id: null };
  const calls = [];
  SUPPLIERS.forEach((s, i) => {
    const po = (n) => `45000${String(1000 + i * 20 + n).padStart(5, '0')}`;
    const lineItems = s.lines.map(([item, qty], n) => `${po(n)}/${(n + 1) * 10} ${item} pending ${qty}`).join('; ');
    const phone = `90000002${String(i + 1).padStart(2, '0')}`;
    const row = { primary_id: s.code, name: s.name, phone, context: { supplier_code: s.code, supplier_name: s.name, contact_person: 'Test Contact', phone_number: phone, plant: `Plant ${1 + (i % 2)}`, line_items: lineItems },
      row: i + 1, status: 'pending', outputs: {}, final: s.final, dispatched_at: new Date(Date.parse(created) + i * 90000).toISOString() };
    row.attempts_detail = planAttempts({ seed: `${camp.campaign_id}:${s.code}`, final: s.final, dispatchedAt: row.dispatched_at, did: PI_ROUTE.did });
    row.attempts = row.attempts_detail.length;
    const last = row.attempts_detail[row.attempts_detail.length - 1];
    if (s.out) {
      const base = last.ended_at;
      const lines = s.lines.map(([item, qty], n) => {
        const o = s.out[n] || { line_status: 'not_discussed' };
        return { po_number: `${po(n)}/${(n + 1) * 10}`, item, pending_qty: qty, ...o, lots: lotDates(o.lots, base), ready_date: day(base, o.ready_date),
          estimate_date: day(base, o.estimate_date), dispatch_date: day(base, o.dispatch_date) };
      });
      const covered = lines.filter((l) => l.line_status !== 'not_discussed').length;
      const nextF = lines.map((l) => l.estimate_date).filter(Boolean).sort()[0] || '';
      const outputs = { call_status: 'completed', lines, lines_covered: covered, lines_deferred: lines.length - covered, next_followup_date: nextF,
        escalate_to: lines.some((l) => /quality|disputed/.test(l.line_status)) ? 'quality' : lines.some((l) => l.line_status === 'artwork_hold') ? 'buyer' : 'none',
        supplier_verbatim: lines.find((l) => l.supplier_says)?.supplier_says || '' };
      const id = `40715920${String(10000000 + i * 7919).slice(0, 8)}`;
      const started = new Date(Date.parse(last.started_at) + last.ring_seconds * 1000);
      const turns = [
        ['AGENT_TURN', `Namaste, main Hetal, PI Industries packaging procurement se. Kya meri baat ${s.name} se ho rahi hai?`],
        ['USER_TURN', 'Haan ji, boliye.'],
        ['AGENT_TURN', `Aapke ${s.lines.length} open lines hain. Pehla line: ${s.lines[0][0]}, pending ${s.lines[0][1]}. Dispatch plan kya hai?`],
        ['USER_TURN', 'Ji, iska plan bata deta hoon.'],
        ['AGENT_TURN', 'Theek hai, maine note kar liya. Main read back karti hoon.'],
        ['USER_TURN', 'Haan, sahi hai.'],
      ];
      const dur = last.talk_seconds;
      const events = [{ kind: 'CALL_CONTEXT', ts: started.toISOString(), context: row.context },
        ...turns.map(([kind, text], k) => ({ kind, text, ts: new Date(started.getTime() + (k + 1) * (dur * 1000 / 8)).toISOString() })),
        { kind: 'TOOL_CALL', tool: 'submit_call_outputs', args: outputs, ts: new Date(started.getTime() + dur * 1000 - 2000).toISOString() }];
      last.call_id = id;
      calls.push({ call_id: id, called_number: PI_ROUTE.did, agent: camp.agent, agent_key: `ozonetel/${camp.agent}/gemini`, campaign_id: camp.campaign_id, org_id: 'org_pi',
        contact_name: s.name, phone, duration_seconds: dur, started_at: started.toISOString(), ended_at: new Date(started.getTime() + dur * 1000).toISOString(),
        mode: 'telephony', num_turns: turns.length, provider: 'gemini', source: 'campaign', status: 'completed',
        summary: `${covered} of ${lines.length} lines covered · ${lines.map((l) => l.line_status).join(', ')}`,
        telephony_provider: 'ozonetel', tools_called: ['submit_call_outputs'], total_tokens: turns.length * 14000, turn_shape: 'au', variant: 'full',
        recording_source: 'ozonetel', recording_url: '', disconnect_reason: last.provider.HangupBy, campaign_name: camp.name, context: row.context, events, outputs, call_result: 'conversation' });
      Object.assign(row, { status: 'completed', call_result: 'conversation', call_id: id, recording_call_id: id, captured_at: calls[calls.length - 1].ended_at, outputs });
    } else {
      const m = last.mapped;
      Object.assign(row, { status: s.final.status, reason: m.reason, call_result: null });
      if (s.final.status === 'retry_exhausted') Object.assign(row, { last_attempt_status: m.status, last_attempt_reason: m.reason });
      if (s.final.status === 'retry_scheduled') row.next_attempt_at = new Date(Date.now() + s.final.next_attempt_in_min * 60000).toISOString();
    }
    camp.contacts.push(row);
  });
  return { campaign: camp, calls };
}
