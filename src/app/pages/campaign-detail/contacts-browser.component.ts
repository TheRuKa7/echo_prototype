import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { rowStatus, resultLabel, reasonLabel, callStatusLabel, anomalyLabel } from '../../utils/status';
import { fmtSecs } from '../../utils/format';
import { IconComponent } from '../../components/icon/icon.component';

/**
 * The campaign's contact list as a master/detail browser.
 *
 * Left: one row per contact — number and call status, which is the pair an
 * operator scans for. Right: what that call produced — the captured output
 * variables, the transcript, and the audio.
 *
 * The detail is fetched per contact rather than bundled into the list: a
 * campaign's transcripts run to hundreds of KB, and the list is polled every ten
 * seconds while a campaign is running.
 */
@Component({
  selector: 'app-contacts-browser',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (!rows.length) {
      <div class="empty">
        <div class="empty-icon"><app-icon name="file" [size]="18" [strokeWidth]="1.8"></app-icon></div>
        <div class="empty-title">No list uploaded</div>
        <div class="empty-sub">Download the template, fill it in, then use Upload data.</div>
      </div>
    } @else {
      <div class="cb">
        <!-- ── Left: contacts ─────────────────────────────────────────── -->
        <div class="cb-list">
          @for (r of rows; track r.primary_id) {
            <button
              type="button"
              [class]="'cb-item' + (selected() === r.primary_id ? ' on' : '')"
              (click)="select(r)"
            >
              <span class="cb-item-main">
                <span class="mono cb-phone">{{ r.phone }}</span>
                <span class="cb-name">{{ r.name || '—' }}@if (st(r).detail) { <span class="row-sub"> · {{ st(r).detail }}</span> }</span>
                @if (r.attempts) {
                  <span class="cb-meta">{{ r.attempts }} {{ r.attempts === 1 ? 'dial' : 'dials' }}@if (r.talk_seconds) { · talk {{ fmtSecs(r.talk_seconds) }} }@if (r.next_attempt_at) { · next {{ clock(r.next_attempt_at) }} }</span>
                }
              </span>
              <span class="cb-item-side">
                <span [class]="'tag ' + st(r).cls" [title]="r.validation_error || st(r).detail || ''">{{ st(r).label }}</span>
                <!-- Inside the row button, so it needs its own stopPropagation:
                     without it, downloading also selects the contact and swaps
                     the detail pane out from under the click. -->
                @if (r.recording_call_id) {
                  <a
                    class="cb-dl"
                    [href]="downloadFor(r.recording_call_id)"
                    download
                    (click)="$event.stopPropagation()"
                    [title]="'Download the recording for ' + r.phone"
                  >
                    <app-icon name="download" [size]="13"></app-icon>
                  </a>
                }
              </span>
            </button>
          }
        </div>

        <!-- ── Right: that contact's call ─────────────────────────────── -->
        <div class="cb-detail">
          @if (!selected()) {
            <div class="empty">
              <div class="empty-icon"><app-icon name="phone" [size]="18" [strokeWidth]="1.8"></app-icon></div>
              <div class="empty-title">Select a contact</div>
              <div class="empty-sub">Its output variables, transcript and recording appear here.</div>
            </div>
          } @else if (loading()) {
            <div class="empty"><div class="empty-title">Loading…</div></div>
          } @else if (error()) {
            <div class="note bad">{{ error() }}</div>
          } @else if (detail()) {
            <div class="cb-head">
              <div style="min-width: 0">
                <div class="cb-title">{{ detail().contact.name || detail().contact.phone }}</div>
                <div class="cb-sub mono">
                  {{ detail().contact.phone }}
                  @if (detail().timing?.talk_seconds) { · talk {{ fmtSecs(detail().timing.talk_seconds) }} }
                  @if (detail().call?.num_turns) { · {{ detail().call.num_turns }} turns }
                  @if (detail().timing?.talk_seconds && detail().timing?.hangup_by) { · ended by {{ hangupLabel(detail().timing.hangup_by).toLowerCase() }} }
                </div>
              </div>
              <span [class]="'tag ' + st(detail()).cls" [title]="st(detail()).detail">{{ st(detail()).label }}{{ st(detail()).detail ? ' · ' + st(detail()).detail : '' }}</span>
            </div>

            @if (detail().status === 'input_validation_failed' && detail().response?.validation_error) {
              <div class="note bad">{{ detail().response.validation_error }}</div>
            }

            <!-- A transcript found by number is NOT proof of attribution: it is
                 the right person's call, but nothing was ever written back to
                 this campaign row. Saying so is the difference between showing
                 recovered data and claiming a result was recorded. -->
            @if (detail().call?.matched_by === 'phone') {
              <div class="note">
                This call was matched by phone number — it was never linked to this campaign,
                so nothing it captured was stored. The transcript below is the only record.
              </div>
            }

            <!-- Every dial of this row: what Ozonetel sent and what Echo decided (PRD-ECHO-11 sections 7 and 8) -->
            @if (detail().attempt_log?.length) {
              <div class="cb-section">
                <div class="cb-section-title">Dials ({{ detail().attempt_log.length }})
                  @if (detail().next_attempt_at) { <span class="cb-next">· next dial {{ clock(detail().next_attempt_at) }}</span> }
                </div>
                <div class="scroll-x">
                  <table class="table cb-att">
                    <thead><tr><th>#</th><th>Started</th><th>Ring</th><th>Talk</th><th>Ozonetel said</th><th>Hung up by</th><th>Echo status</th></tr></thead>
                    <tbody>
                      @for (a of detail().attempt_log; track a.attempt) {
                        <tr>
                          <td class="mono">{{ a.attempt }}</td>
                          <td class="mono">{{ clock(a.started_at) }}</td>
                          <td class="mono">{{ fmtSecs(a.ring_seconds) }}</td>
                          <td class="mono">{{ a.talk_seconds ? fmtSecs(a.talk_seconds) : '—' }}</td>
                          <td class="mono cb-raw" [title]="rawTitle(a.provider)">{{ a.provider?.Status }} · {{ a.provider?.CustomerStatus }}</td>
                          <td>{{ hangupLabel(a.provider?.HangupBy) }}</td>
                          <td>
                            <b>{{ callStatusLabel(a.status) }}</b>{{ a.result ? ': ' + resultLabel(a.result) : a.reason ? ': ' + reasonLabel(a.reason) : '' }}
                            @for (x of a.anomalies || []; track x) { <span class="tag warn" style="margin-left: 4px" [title]="x">{{ anomalyLabel(x) }}</span> }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }

            <!-- Audio -->
            <div class="cb-section">
              <div class="cb-section-title">Recording</div>
              @if (detail().audio.available) {
                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
                  <audio controls [src]="audioUrl()" style="height: 32px; max-width: 100%"></audio>
                  <a class="btn btn-sm" [href]="downloadUrl()" download>
                    <app-icon name="download" [size]="13"></app-icon> Download audio
                  </a>
                </div>
              } @else {
                <div class="cb-none">{{ detail().attempts && !detail().call ? 'No recording — nobody answered.' : 'No recording saved for this call.' }}</div>
              }
            </div>

            <!-- Output variables -->
            <div class="cb-section">
              <div class="cb-section-title">Output variables</div>
              @if (hasOutputs()) {
                <div class="cb-vars">
                  @for (v of outVars; track v.key) {
                    @if (v.type === 'list' && isList(detail().outputs[v.key])) {
                      <div class="cb-var cb-var-list">
                        <span class="cb-var-key">{{ v.label || v.key }} ({{ detail().outputs[v.key].length }})</span>
                        <div class="scroll-x">
                          <table class="table cb-lines">
                            <thead><tr>@for (f of listCols(v, detail().outputs[v.key]); track f) { <th>{{ f }}</th> }</tr></thead>
                            <tbody>
                              @for (row of detail().outputs[v.key]; track $index) {
                                <tr>@for (f of listCols(v, detail().outputs[v.key]); track f) { <td [class.mono]="f !== 'item' && f !== 'supplier_says' && f !== 'delay_reason'">{{ format(row[f]) }}</td> }</tr>
                              }
                            </tbody>
                          </table>
                        </div>
                      </div>
                    } @else {
                      <div class="cb-var">
                        <span class="cb-var-key">{{ v.label || v.key }}</span>
                        <span class="cb-var-val">{{ format(detail().outputs[v.key]) }}</span>
                      </div>
                    }
                  }
                </div>
              } @else {
                <div class="cb-none">
                  Nothing captured
                  @if (detail().call) { — the call ran but the agent reported no values. }
                  @else if (detail().attempts) { — not reached on {{ detail().attempts === 1 ? 'the one dial' : 'any of the ' + detail().attempts + ' dials' }}. }
                  @else { — this contact has not been called yet. }
                </div>
              }
            </div>

            <!-- Transcript -->
            <div class="cb-section">
              <div class="cb-section-title">Transcript</div>
              @if (detail().transcript.length) {
                <div class="cb-turns">
                  @for (t of detail().transcript; track $index) {
                    @if (t.role === 'user' || t.role === 'agent') {
                      <div [class]="'turn' + (t.role === 'user' ? ' me' : '')">
                        <span class="turn-time">{{ time(t.ts) }}</span>
                        <span class="turn-who">{{ t.role === 'user' ? 'Caller' : 'Agent' }}</span>
                        <span class="turn-text">{{ t.text }}</span>
                      </div>
                    } @else if (t.role === 'tool') {
                      <div class="turn cb-turn-tool">
                        <span class="turn-time">{{ time(t.ts) }}</span>
                        <span class="turn-who">Tool</span>
                        <span class="turn-text mono cb-tool">{{ t.tool }}({{ compact(t.args) }})</span>
                      </div>
                    } @else if (t.role === 'note') {
                      <div class="turn cb-turn-tool">
                        <span class="turn-time">{{ time(t.ts) }}</span>
                        <span class="turn-who">·</span>
                        <span class="turn-text cb-note">{{ t.text }}</span>
                      </div>
                    }
                  }
                </div>
              } @else {
                <div class="cb-none">No transcript — {{ detail().attempts ? 'nobody answered.' : 'this contact has no completed call.' }}</div>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .cb {
        display: grid;
        grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
        align-items: start;
      }
      /* Single column on narrow screens: two panes side by side below ~880px
         leaves the transcript too narrow to read. */
      @media (max-width: 880px) {
        .cb { grid-template-columns: minmax(0, 1fr); }
        .cb-list { border-right: none; border-bottom: 1px solid var(--line); max-height: 320px; }
      }
      .cb-list {
        border-right: 1px solid var(--line);
        max-height: 640px;
        overflow-y: auto;
      }
      .cb-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        padding: 11px 14px;
        border: none;
        border-bottom: 1px solid var(--line-row);
        border-left: 2px solid transparent;
        background: transparent;
        text-align: left;
        cursor: pointer;
        font: inherit;
        color: inherit;
      }
      .cb-item:hover { background: var(--raised); }
      .cb-item.on { background: var(--raised); border-left-color: var(--red); }
      .cb-item-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .cb-item-side { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
      .cb-dl {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        color: var(--faint);
        border: 1px solid transparent;
      }
      .cb-dl:hover { color: var(--ink); border-color: var(--line); background: var(--card); }
      .cb-phone { font-size: 12.5px; color: var(--ink-2); }
      .cb-name {
        font-size: 11.5px;
        color: var(--faint);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cb-detail { padding: 16px; min-width: 0; }
      .cb-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--line);
      }
      .cb-title { font-size: 15px; font-weight: 600; color: var(--ink); }
      .cb-sub { font-size: 11.5px; color: var(--faint); margin-top: 3px; }
      .cb-section { margin-top: 18px; }
      .cb-section-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--faint);
        margin-bottom: 9px;
      }
      .cb-none { font-size: 12.5px; color: var(--faint); }
      .cb-vars { display: flex; flex-direction: column; gap: 1px; }
      .cb-var {
        display: grid;
        grid-template-columns: minmax(120px, 34%) minmax(0, 1fr);
        gap: 12px;
        padding: 8px 10px;
        background: var(--raised);
        border-radius: 6px;
      }
      .cb-var-key { font-size: 12.5px; color: var(--muted); }
      .cb-var-val { font-size: 12.5px; color: var(--ink-2); word-break: break-word; }
      .cb-turns {
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow: hidden;
        max-height: 460px;
        overflow-y: auto;
      }
      .cb-turn-tool { background: var(--raised); }
      .cb-tool { font-size: 11.5px; color: var(--muted); word-break: break-word; }
      .cb-note { font-size: 12px; color: var(--faint); font-style: italic; }
      .cb-meta { font-size: 11px; color: var(--muted); }
      .cb-next { text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--muted); }
      .cb-att td, .cb-lines td { font-size: 12px; padding: 6px 8px; vertical-align: top; }
      .cb-att th, .cb-lines th { font-size: 11px; padding: 6px 8px; white-space: nowrap; }
      .cb-raw { color: var(--muted); cursor: help; }
      .cb-var-list { grid-template-columns: minmax(0, 1fr); }
    `,
  ],
})
export class ContactsBrowserComponent implements OnChanges {
  @Input() rows: any[] = [];
  @Input() outVars: any[] = [];
  @Input() campaignId = '';

  private api = inject(ApiService);

  selected = signal('');
  detail = signal<any>(null);
  loading = signal(false);
  error = signal('');

  // Fires once per campaign, not on every ten-second poll refresh: `rows` gets a
  // new array reference on each load(), and re-selecting the top row on every
  // poll would yank an operator out of whatever contact they're actually reading.
  private autoSelected = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['campaignId'] && !changes['campaignId'].firstChange) {
      this.autoSelected = false;
      this.selected.set('');
      this.detail.set(null);
    }
    if (!this.autoSelected && this.rows.length) {
      this.autoSelected = true;
      this.select(this.rows[0]);
    }
  }

  async select(row: any): Promise<void> {
    const id = String(row.primary_id);
    // Clicking the open row closes it, so the list can be given the full width.
    if (this.selected() === id) {
      this.selected.set('');
      this.detail.set(null);
      return;
    }
    this.selected.set(id);
    this.detail.set(null);
    this.error.set('');
    this.loading.set(true);
    try {
      const d = await this.api.campaignContactDetail(this.campaignId, id);
      // Guard against a slow response for a row the operator has already left:
      // without this the previous contact's transcript lands in the open pane.
      if (this.selected() === id) this.detail.set(d);
    } catch (e: any) {
      if (this.selected() === id) this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }

  round(n: number): number {
    return Math.round(n || 0);
  }

  hasOutputs(): boolean {
    return Object.keys(this.detail()?.outputs || {}).length > 0;
  }

  /** The list's own download link — the detail pane need not be open for it. */
  downloadFor(callId: string): string {
    return this.api.recordingUrls(callId).download;
  }

  audioUrl(): string {
    return this.api.recordingUrls(this.detail()?.audio?.call_id || '').audio;
  }
  downloadUrl(): string {
    return this.api.recordingUrls(this.detail()?.audio?.call_id || '').download;
  }

  /** Status word, colour and one line of detail (result, reason or attempt), see utils/status.ts. */
  st(r: any) { return rowStatus(r || {}); }

  fmtSecs = fmtSecs;
  resultLabel = resultLabel;
  reasonLabel = reasonLabel;
  callStatusLabel = callStatusLabel;
  anomalyLabel = anomalyLabel;
  isList(v: any): boolean { return Array.isArray(v); }
  /** Columns of a list answer that hold at least one value, in the agent's field order. */
  listCols(v: any, rows: any[]): string[] {
    const keys = [...(v.fields || []).map((f: any) => f.key), ...Object.keys(rows[0] || {})];
    return [...new Set(keys)].filter((k) => rows.some((r) => r[k] !== '' && r[k] !== null && r[k] !== undefined && r[k] !== 0));
  }
  hangupLabel(h: string): string {
    const v = String(h || '').replace(/\s+/g, '').toLowerCase();
    return v === 'userhangup' ? 'Caller' : v === 'agenthangup' ? 'Agent' : v === 'systemhangup' ? 'System' : h || '—';
  }
  rawTitle(p: any): string { return Object.entries(p || {}).filter(([, x]) => x !== '').map(([k, x]) => `${k}: ${x}`).join('\n'); }
  clock(ts: string): string {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  /** Booleans render as yes/no; everything else as its own text. */
  format(v: any): string {
    if (v === true) return 'Yes';
    if (v === false) return 'No';
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
  }

  compact(args: any): string {
    return Object.entries(args || {})
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
  }

  time(ts: string): string {
    if (!ts) return '';
    const t = String(ts);
    // ISO timestamp -> HH:MM:SS, which is what the console's transcript shows.
    const m = t.match(/T(\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : t.slice(11, 19);
  }
}
