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
  rang_out: 'rang out',
  destination_busy: 'line busy',
  subscriber_absent: 'switched off or out of coverage',
  no_route: 'no route to number',
  congestion: 'network congestion',
  provider_exception: 'telephony error',
  invalid_format: 'number format is wrong',
  invalid_number: 'number does not exist',
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

export function rowStatus(r: { status?: string; call_result?: string | null; reason?: string | null; attempts?: number | null }): StatusView & { detail: string } {
  const base = ROW[r.status || ''] || { label: r.status || '—', cls: '', final: false };
  const result = callResult(r);
  let detail = '';
  if (base.final && result) detail = RESULT[result] || result;
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
