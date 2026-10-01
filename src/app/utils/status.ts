/**
 * Every status word the console shows, in one place (PRD-ECHO-11).
 *
 * Accepts both today's backend values (captured, disconnected_early, dialled,
 * no_outputs, input_validation_failed) and the new ones, so the UI is right on
 * either backend.
 */
export interface StatusView { label: string; cls: string; final: boolean; hint?: string; }

const ROW: Record<string, StatusView> = {
  pending: { label: 'Waiting', cls: 'muted', final: false },
  scheduled: { label: 'Scheduled', cls: 'muted', final: false },
  queued: { label: 'Queued', cls: 'info', final: false },
  dialled: { label: 'Waiting for result', cls: 'warn', final: false, hint: 'Sent to the dialler; no result has come back yet' },
  calling: { label: 'Calling', cls: 'info', final: false },
  in_progress: { label: 'On the call', cls: 'info', final: false },
  retry_scheduled: { label: 'Retry scheduled', cls: 'info', final: false },
  completed: { label: 'Completed', cls: 'ok', final: true },
  captured: { label: 'Completed', cls: 'ok', final: true },
  disconnected_early: { label: 'Completed', cls: 'warn', final: true },
  no_outputs: { label: 'Completed', cls: 'warn', final: true },
  no_answer: { label: 'No answer', cls: 'bad', final: true },
  busy: { label: 'Busy', cls: 'bad', final: true },
  rejected: { label: 'Rejected', cls: 'bad', final: true },
  blocked: { label: 'Blocked', cls: 'bad', final: true },
  invalid_number: { label: 'Invalid number', cls: 'bad', final: true },
  unreachable: { label: 'Unreachable', cls: 'bad', final: true },
  failed: { label: 'Failed', cls: 'bad', final: true },
  input_validation_failed: { label: 'Failed', cls: 'bad', final: true, hint: 'Data check failed; not dialled' },
  cancelled: { label: 'Cancelled', cls: 'muted', final: true },
  retry_exhausted: { label: 'Retry exhausted', cls: 'bad', final: true },
};

const RESULT: Record<string, string> = {
  conversation: 'Conversation',
  no_response: 'No response',
  disconnected_early: 'Hung up early',
  voicemail: 'Voicemail',
  technical_drop: 'Technical drop',
};

const REASON: Record<string, string> = {
  no_answer: 'rang, no answer',
  no_response: 'rang, no answer',
  rang_out: 'rang out, not picked up',
  not_answered: 'not answered',
  normal_unspecified: 'call cleared by network',
  isd_disabled: 'international dialling disabled',
  bot_not_connected: 'answered but the agent never connected',
  invalid_number: 'number does not exist',
  destination_busy: 'line busy',
  subscriber_absent: 'switched off or out of coverage',
  no_route: 'no route to number',
  congestion: 'network congestion',
  provider_exception: 'telephony error',
  invalid_format: 'number format is wrong',
  data_validation_failed: 'data check failed',
  duplicate_row: 'repeated number in the sheet',
  dnd: 'number is on DND',
  not_dialled_stopped: 'campaign stopped before dialling',
  not_dialled_expired: 'expired before dialling',
  no_provider_result: 'no result from the telephony provider',
  unknown_provider_status: 'unknown telephony result',
};

const CAMPAIGN: Record<string, StatusView> = {
  draft: { label: 'Draft', cls: 'muted', final: false },
  ready: { label: 'Ready', cls: 'ok', final: false },
  scheduled: { label: 'Scheduled', cls: 'info', final: false },
  running: { label: 'Running', cls: 'info', final: false },
  paused: { label: 'Paused', cls: 'warn', final: false },
  completed: { label: 'Completed', cls: 'ok', final: true },
  partially_completed: { label: 'Partially completed', cls: 'warn', final: true },
  cancelled: { label: 'Cancelled', cls: 'muted', final: true },
  failed: { label: 'Failed', cls: 'bad', final: true },
};

/** Result of a completed row, from the backend field or inferred from today's values. */
export function callResult(r: { status?: string; call_result?: string | null }): string | null {
  if (r.call_result) return r.call_result;
  if (r.status === 'captured') return 'conversation';
  if (r.status === 'disconnected_early') return 'disconnected_early';
  if (r.status === 'no_outputs') return 'conversation';
  return null;
}

export function rowStatus(r: { status?: string; call_result?: string | null; reason?: string | null; attempts?: number | null; last_attempt_reason?: string | null }): StatusView & { detail: string } {
  const base = ROW[r.status || ''] || { label: r.status || '—', cls: '', final: false };
  const result = callResult(r);
  let detail = '';
  if (base.final && result) detail = RESULT[result] || result;
  else if (r.status === 'retry_exhausted') detail = `last dial: ${REASON[r.last_attempt_reason || r.reason || ''] || 'not reached'}`;
  else if (r.status === 'retry_scheduled' && (r.reason || result)) detail = `last dial: ${REASON[r.reason || ''] || RESULT[r.reason || ''] || RESULT[result || ''] || r.reason}`;
  else if (r.reason) detail = REASON[r.reason] || r.reason.replace(/_/g, ' ');
  else if (base.hint) detail = base.hint;
  const cls = base.final && result ? (result === 'conversation' ? 'ok' : 'warn') : base.cls;
  return { ...base, cls, detail };
}

export function resultLabel(result: string | null | undefined): string { return result ? RESULT[result] || result : ''; }
export function reasonLabel(reason: string | null | undefined): string { return reason ? REASON[reason] || reason.replace(/_/g, ' ') : ''; }
export function campaignStatus(s: string | null | undefined): StatusView {
  return CAMPAIGN[s || ''] || { label: s || '—', cls: '', final: false };
}

/** Plain word for one attempt's call status (PRD-ECHO-11 section 6). */
export function callStatusLabel(s: string | null | undefined): string { return (ROW[s || ''] || { label: s || '—' }).label; }
const ANOMALY: Record<string, string> = {
  PROVIDER_SAYS_NOT_ANSWERED: 'Ozonetel said not answered',
  BOT_NOT_CONNECTED: 'Agent never connected',
  PROVIDER_DATA_CONFLICT: 'Ozonetel data conflict',
};
export function anomalyLabel(a: string): string { return ANOMALY[a] || a.toLowerCase().replace(/_/g, ' '); }

// ── Outcomes (PRD-ECHO-19) ───────────────────────────────────────────────────
// One plain word per dial and per contact, worked out from provider neutral dial
// facts (picked up, line result, ring and talk time, who ended it, what Echo heard).
// Every provider maps to the same words, so nothing here names a telephony vendor.
export type OutcomeGroup = 'in_progress' | 'reached' | 'not_reached' | 'failed' | 'not_dialled';
export interface OutcomeView { key: string; label: string; group: OutcomeGroup; cls: string; help: string; ozonetel: string; retry: boolean; }

/**
 * CALL STATUS: the one field that drives every call, campaign, filter, count,
 * retry and Clarix update. Each status is defined by what Ozonetel reports for
 * the dial (Status, DialStatus, CustomerStatus, HangupBy, ring and talk time)
 * plus what Echo's own audio heard. First matching rule wins, top to bottom.
 *
 *   [label, group, meaning, Ozonetel rule, retried by default]
 */
const OUTCOME: Record<string, [string, OutcomeGroup, string, string, boolean]> = {
  // in progress
  waiting: ['Waiting', 'in_progress', 'In the queue, not sent to Ozonetel yet', 'No Ozonetel call yet', false],
  calling: ['Calling', 'in_progress', 'Ozonetel is ringing the number', 'Dial placed, no callback yet', false],
  on_call: ['On call', 'in_progress', 'Picked up and talking to the agent now', 'Answered, agent audio live', false],
  will_retry: ['Will retry', 'in_progress', 'Not reached yet; the next dial is booked', 'Last dial retryable, tries left', false],
  // reached: Ozonetel Status = Answered
  completed: ['Completed', 'reached', 'Picked up, talked, and the agent finished', 'Status Answered · caller spoke · agent finished (answers sent or agent hung up)', false],
  caller_hung_up: ['Caller hung up', 'reached', 'Talked, then hung up before the agent finished', 'Status Answered · caller spoke · HangupBy UserHangup before the end', true],
  no_reply: ['No reply', 'reached', 'Picked up but never spoke', 'Status Answered · under 1 s of caller speech', true],
  voicemail: ['Voicemail', 'reached', 'A voicemail or answering machine picked up', 'Status Answered · machine greeting heard', true],
  // not reached: Ozonetel Status = NotAnswered
  no_answer: ['No answer', 'not_reached', 'Rang, nobody picked up', 'Status NotAnswered · CustomerStatus ring, Dialing, NoResponse, not_answered or NormalUnspecified', true],
  busy: ['Busy', 'not_reached', 'Line busy or the call was declined', 'CustomerStatus Busy', true],
  unreachable: ['Unreachable', 'not_reached', 'Switched off, out of coverage or no route', 'CustomerStatus SubcriberAbsent or NoRouteDestination', true],
  wrong_number: ['Wrong number', 'not_reached', 'The number does not exist or is written wrong', 'CustomerStatus InvalidNumber or InvalidNumberFormat, or DialStatus invalid_number', false],
  blocked: ['Blocked', 'not_reached', 'DND, international calling off, or barred', 'CustomerStatus ISDDisabled or DND', false],
  // failed: our side or the network
  network_error: ['Network error', 'failed', 'The network or provider failed before it rang', 'CustomerStatus Congestion or exception, DialStatus exception, or any value Echo does not know', true],
  call_dropped: ['Call dropped', 'failed', 'Picked up, but the line or our agent dropped', 'Status Answered · agent audio never joined, or SystemHangup mid call', true],
  // not dialled: no Ozonetel call made
  bad_data: ['Bad data', 'not_dialled', 'Failed the data check, so it was not dialled', 'Not sent to Ozonetel', false],
  repeated_number: ['Repeated number', 'not_dialled', 'The same number appears earlier in the file', 'Not sent to Ozonetel', false],
  stopped: ['Stopped', 'not_dialled', 'The campaign was stopped before this was dialled', 'Not sent to Ozonetel', false],
  expired: ['Expired', 'not_dialled', 'The calling window closed before this was dialled', 'Not sent to Ozonetel', false],
};
const GROUP_CLS: Record<OutcomeGroup, string> = { reached: 'ok', not_reached: 'bad', failed: 'warn', not_dialled: 'muted', in_progress: 'info' };
export const GROUPS: { key: OutcomeGroup; label: string; help: string }[] = [
  { key: 'reached', label: 'Reached', help: 'Ozonetel says Answered' },
  { key: 'not_reached', label: 'Not reached', help: 'Ozonetel says NotAnswered' },
  { key: 'failed', label: 'Failed', help: 'Network or our side; safe to retry' },
  { key: 'in_progress', label: 'In progress', help: 'Waiting, calling, on call or retry booked' },
  { key: 'not_dialled', label: 'Not dialled', help: 'Never sent to Ozonetel' },
];
/** Every call status in rule order, for the reference table and filters. */
export const CALL_STATUSES: OutcomeView[] = Object.keys(OUTCOME).map((k) => outcomeView(k));

export function outcomeView(key: string | null | undefined): OutcomeView {
  const o = OUTCOME[key || ''];
  if (!o) return { key: key || '', label: key ? key.replace(/_/g, ' ') : '—', group: 'failed', cls: 'muted', help: '', ozonetel: '', retry: false };
  const cls = key === 'completed' ? 'ok' : o[1] === 'reached' ? 'warn' : GROUP_CLS[o[1]];
  return { key: key!, label: o[0], group: o[1], cls, help: o[2], ozonetel: o[3], retry: o[4] };
}
/** What Ozonetel actually sent for the last dial, in one short line. */
export function ozonetelLine(p: any): string {
  if (!p) return '';
  const same = (x: string) => String(x || '').toLowerCase() === String(p.Status || '').toLowerCase();
  const parts = [p.Status, p.CustomerStatus && !same(p.CustomerStatus) ? p.CustomerStatus : '', p.HangupBy && p.Status === 'Answered' ? p.HangupBy : ''].filter(Boolean);
  return parts.length ? `Ozonetel: ${parts.join(' · ')}` : '';
}
export function groupLabel(g: string): string { return GROUPS.find((x) => x.key === g)?.label || g; }

const GOAL: Record<string, [string, string]> = { met: ['Goal met', 'ok'], partly: ['Partly', 'warn'], not_met: ['Goal not met', 'bad'] };
export function goalView(g: string | null | undefined): { label: string; cls: string } | null {
  return g && GOAL[g] ? { label: GOAL[g][0], cls: GOAL[g][1] } : null;
}

/** One line in plain words for a dial: "Rang 0:38, nobody picked up" or "Talked 1:12, caller hung up". */
export function dialSentence(a: { outcome?: string; ring_seconds?: number | null; talk_seconds?: number | null; facts?: any }): string {
  const m = (s: number | null | undefined) => { const n = Math.round(s || 0); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
  switch (a.outcome) {
    case 'no_answer': return `Rang ${m(a.ring_seconds)}, nobody picked up`;
    case 'busy': return 'Line busy';
    case 'unreachable': return 'Switched off or out of coverage';
    case 'wrong_number': return 'Number does not exist';
    case 'blocked': return 'Blocked (DND or barred)';
    case 'network_error': return 'Network error before it rang';
    case 'call_dropped': return `Picked up, dropped after ${m(a.talk_seconds)}`;
    case 'no_reply': return `Picked up, silent for ${m(a.talk_seconds)}`;
    case 'voicemail': return `Voicemail picked up after ${m(a.ring_seconds)}`;
    case 'caller_hung_up': return `Talked ${m(a.talk_seconds)}, caller hung up`;
    case 'completed': return `Talked ${m(a.talk_seconds)}, agent finished`;
    default: return '';
  }
}
