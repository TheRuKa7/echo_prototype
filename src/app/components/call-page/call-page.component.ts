import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NeedDirective } from '../shared-screens/preview';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * One call page: every call list in Echo and Clarix opens this, by report row id. Header with the call status and outcome,
 * summary, answers, next step, recording, transcript, dials, inputs and (where kept) the timeline; Previous and Next step
 * through the call's campaign; a person can change the outcome of an answered call. Rows with no conversation show their
 * dials and reason instead. Echo and Clarix use this same file with their own CallPageSource. Keep the two copies identical.
 */

export interface CallDetail {
  id: string; call_id: string | null; campaign_id: string; agent: string; campaign: string; uploaded_by: string; caller_name: string; phone: string; email: string;
  call_date: string | null; duration_seconds: number | null; retries: number; dials_count: number; call_status: string; status_reason: string; goal_reached: string;
  callback_at: string | null; summary: string; outcome_source?: 'review' | 'person'; changed_by?: string; changed_at?: string | null; change_note?: string; review_status_reason?: string;
  answers: { key: string; label: string; value: string }[]; inputs: { key: string; value: string }[]; transcript: { who: string; text: string; at: string | null }[];
  has_audio: boolean; audio_path: string | null; dials: { n: number; at: string; ring_seconds: number | null; talk_seconds: number | null; result: string; provider: string }[];
  /** Rows that shared this call, each with its own state and the answers saved for it. */
  rows?: { n: number; row: number; say: string; state: string; state_label: string; saved_second: number | null; answer: Record<string, unknown> }[];
  goal_evaluation?: {
    overall: 'positive' | 'negative' | 'partial' | null;
    rollup: string;
    counts: { positive: number; partial: number; negative: number; skipped: number };
    goals: {
      id: string; name: string; outcome: 'positive' | 'negative' | 'partial' | 'skipped'; reason?: string;
      traces: { bucket: string; field: string; op: string; expected: string; actual: string; passed: boolean }[];
    }[];
  } | null;
  timeline: { at: string; type: string; status: string; detail: string }[]; prev_id: string | null; next_id: string | null; position: number; of: number; outcome_options: string[];
}
/** The contact memory brief the agent got before the call. */
export interface CallMemory { on: boolean; calls: number; lines: string[]; variable: string; last?: { id: string; date: string; result: string; campaign: string }[] }
/** Diagnostics for one call, for the technical reader. */
export interface CallDiagnostics {
  summary: { p50_ms: number | null; p90_ms: number | null; turns: number; interruptions: number; slow_turns: number };
  turns: { n: number; text: string; listen_ms: number; think_ms: number; speak_ms: number; total_ms: number; interrupted: boolean }[];
  tools: { name: string; at: string; args: Record<string, unknown>; status: number; ms: number; result: string }[];
  ivr: { at: string; detected: string; action: string; after_ms: number } | null;
  ended: { code: string; text: string }; guardrail: string; rerun: { at: string; by: string; result: string } | null;
  dials: { n: number; at: string; ring_seconds: number | null; talk_seconds: number | null; result: string; provider: string; sip: number }[];
  dnc: { reason: string; at: string } | null;
}
/** A message the page suggests for this call, by its status. */
export interface StepMessage { key: string; channel: 'whatsapp' | 'email'; title: string; text: string; attach_vcard?: boolean; callback_cta?: boolean }
/** What happens next for a call: when it is called again and what to send. Messages are recorded by the demo, not sent. */
export interface CallSteps {
  rule: { schedule: string; base_minutes: number; retries: number; from: string; to: string; skip_sunday: boolean; avoid_lunch: boolean; avoid_saturday?: boolean; prefer_prime_slots?: boolean; branded_name?: string };
  retry: { label: string; plan: string[]; left: number } | null;
  messages: StepMessage[];
  sent: { channel: 'whatsapp' | 'email'; key: string; text: string; at: string; by: string; to: string }[];
  caller_id: string;
  branded_caller?: { number: string; name: string; call_reason: string; providers: { key: string; label: string; badge: string }[] };
  vcard?: string;
  dnc?: { reason: string; at: string } | null;
  result_rule?: { key: string; label: string; act: 'retry' | 'stop' | 'callback'; tries: number; gap: number | null; message: 'none' | 'whatsapp' | 'both' } | null;
  voicemail_script?: string | null;
  fast_hook_script?: string | null;
  /** The number's country and its calling rules (Settings › Calling rules). */
  country?: { code: string; name: string; tz_label: string; hours_today: string; register: string; on_register: boolean; register_action: 'block' | 'warn' };
}
export interface CallPageSource {
  detail(id: string): Promise<CallDetail>;
  /** Next steps: the retry plan and messages; sending one returns the steps again. */
  steps?(id: string): Promise<CallSteps>;
  /** Opens Supplier 360 for this number, where the product has it. */
  openSupplier?(phone: string): void;
  /** Technical detail for one call: latency per turn, tool calls, phone menu, why it ended. */
  diagnostics?(id: string): Promise<CallDiagnostics>;
  /** What the agent knew before this call, from earlier calls to the same number. */
  memory?(id: string): Promise<CallMemory>;
  sendMessage?(id: string, m: { channel: string; key: string; text: string }): Promise<CallSteps>;
  audio(path: string): Promise<Blob>;
  changeOutcome(id: string, statusReason: string, note: string): Promise<CallDetail>;
  /** Where Back goes when the page was opened directly (no list to go back to). */
  home: string;
  /** The route the page lives at, for Previous and Next, e.g. "/calls". */
  base: string;
}

/** Status dots — mid tones that read on both light and dark chip surfaces (≥3:1 on soft bg). */
const COLORS: Record<string, string> = {
  success: 'var(--ds-success, #16a34a)',
  not_successful: 'var(--ds-danger, #dc2626)',
  no_conversation: '#7c3aed',
  not_picked_up: 'var(--ds-warning, #d97706)',
  in_progress: 'var(--ds-text-muted, #78716c)',
  not_planned: 'var(--ds-text-disabled, #a8a29e)',
};

@Component({
  selector: 'app-call-page',
  standalone: true,
  imports: [NeedDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cp" [class.cp-busy]="loading()">
      <div class="cp-bar">
        <button type="button" class="cp-btn" (click)="back()"><span aria-hidden="true">←</span> Back</button>
        @if (d(); as c) {
          @if (c.of > 1) {
            <button type="button" class="cp-btn" [disabled]="!c.prev_id" (click)="go(c.prev_id)"><span aria-hidden="true">‹</span> Previous</button>
            <span class="cp-muted">{{ c.position }} of {{ c.of }} in this campaign</span>
            <button type="button" class="cp-btn" [disabled]="!c.next_id" (click)="go(c.next_id)">Next <span aria-hidden="true">›</span></button>
          }
          <span class="cp-grow"></span>
          <button need="calls:export" type="button" class="cp-btn" (click)="exportJson()" title="Every detail of this call in one file, for your IT team">Download details</button>
        }
      </div>

      @if (error()) { <p class="cp-note bad" role="alert">{{ error() }}</p> }

      @if (d(); as c) {
        <!-- Hero Status & Executive Header -->
        <header class="cp-hero">
          <div class="cp-hero-main">
            <div class="cp-hero-id">
              <div class="cp-avatar" aria-hidden="true">{{ initials(c.caller_name || c.phone) }}</div>
              <div>
                <h1 class="cp-title">{{ c.caller_name || c.phone || 'Unknown caller' }}</h1>
                <div class="cp-sub-row">
                  <span class="mono">{{ c.phone || '—' }}</span>
                  @if (c.email) { <span>· {{ c.email }}</span> }
                  @if (source().openSupplier && c.phone) { <span>· <button type="button" class="cp-linkbtn" (click)="source().openSupplier!(c.phone)">Supplier 360 <span aria-hidden="true">↗</span></button></span> }
                </div>
                <div class="cp-sub-row">
                  <span>Agent: <b>{{ c.agent }}</b></span>
                  <span>· Campaign: <b>{{ c.campaign }}</b></span>
                  @if (c.call_date) { <span>· {{ when(c.call_date) }}</span> }
                </div>
              </div>
            </div>
            <div class="cp-chips">
              <span class="cp-chip cp-chip-strong"><i [style.background]="color()"></i>{{ c.call_status }}</span>
              <span class="cp-chip" [class]="'cp-chip cp-out-' + outcomeTone()">{{ outcomeLabel() }}</span>
              <span class="cp-chip" [class.good]="c.goal_reached === 'Yes'">Goal: {{ c.goal_reached }}</span>
              @if (answered() && hasTalked() && !editing()) {
                <button need="calls:edit" type="button" class="cp-btn cp-btn-sm" (click)="startEdit()">Change outcome</button>
              }
            </div>
          </div>

          @if (inRetryOrCallback()) {
            <div class="cp-prog-banner" role="status">
              <span class="cp-prog-dot" aria-hidden="true"></span>
              <div class="cp-prog-copy">
                <b>Currently in progress — {{ c.callback_at ? 'Scheduled callback at ' + c.callback_at : c.call_status === 'In progress' ? 'Retry queue active' : 'Callback / retry scheduled' }}</b>
                <span>
                  @if (steps()?.retry?.plan?.length) {
                    Next dial: {{ when(steps()!.retry!.plan[0]) }} ({{ steps()!.retry!.left }} attempt{{ steps()!.retry!.left === 1 ? '' : 's' }} left)
                  } @else {
                    {{ c.status_reason || 'Waiting for next dial window' }}
                  }
                </span>
              </div>
            </div>
          }

          @if (c.outcome_source === 'person') {
            <p class="cp-note">Outcome overridden by {{ c.changed_by }}@if (c.changed_at) { on {{ when(c.changed_at) }} }: "{{ c.review_status_reason }}" → "{{ c.status_reason }}"@if (c.change_note) { · {{ c.change_note }} }</p>
          }

          @if (answered() && editing()) {
            <div class="cp-edit-bar">
              <b>Change outcome</b>
              <select [value]="pick()" (change)="pick.set($any($event.target).value)" aria-label="Outcome">
                @for (o of c.outcome_options; track o) { <option [value]="o" [selected]="o === pick()">{{ o }}</option> }
              </select>
              <input type="text" placeholder="Reason or note…" [value]="note()" (input)="note.set($any($event.target).value)" aria-label="Note">
              <button type="button" class="cp-btn" (click)="editing.set(false)">Cancel</button>
              <button type="button" class="cp-btn cp-primary" (click)="saveOutcome()">Save</button>
            </div>
          }

          @if (hasTalked()) {
            <div class="cp-summary-box">
              <span class="cp-summary-k">Call summary</span>
              <p>{{ c.summary || reasonText() }}</p>
            </div>
          }
        </header>

        @if (!hasTalked()) {
          <!-- Locked / Non-talk state card -->
          <section class="cp-card cp-locked-card">
            <div class="cp-locked-head">
              <h2>{{ c.call_status === 'In progress' ? 'Call Currently In Progress' : 'Call Not Picked Up / No Conversation' }}</h2>
              <p class="cp-muted">
                No conversation occurred on this call. Status: <b>{{ c.call_status }} — {{ c.status_reason }}</b>.
              </p>
            </div>
            @if (c.dials.length) {
              <div class="cp-scroll">
                <table class="cp-tbl">
                  <thead><tr><th>Dial #</th><th>When</th><th>Ring</th><th>Talk</th><th>Result</th><th>Line / Provider</th></tr></thead>
                  <tbody>
                    @for (x of c.dials; track x.n) {
                      <tr><td>#{{ x.n }}</td><td>{{ when(x.at) }}</td><td>{{ x.ring_seconds ?? '—' }}s</td><td>{{ x.talk_seconds ?? 0 }}s</td><td><b>{{ x.result || '—' }}</b></td><td class="cp-muted">{{ x.provider || '—' }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            @if (steps()?.retry?.plan?.length) {
              <div class="cp-times">
                @for (t of steps()!.retry!.plan; track $index) { <span [class.first]="$first">{{ $first ? 'Next attempt: ' : '' }}{{ when(t) }}</span> }
              </div>
            }
            <div><button type="button" class="cp-btn" (click)="back()"><span aria-hidden="true">←</span> Return to call list</button></div>
          </section>
        } @else {
          <!-- Metrics Strip -->
          <div class="cp-metrics" role="list" aria-label="Call metrics">
            <div class="cp-stat" role="listitem"><span>Talk duration</span><b>{{ mmss(c.duration_seconds) }}</b></div>
            <div class="cp-stat" role="listitem"><span>Dials attempted</span><b>{{ c.dials_count || c.dials.length || 1 }}</b></div>
            <div class="cp-stat" role="listitem"><span>Total ring time</span><b>{{ totalRingSeconds() }}s</b></div>
            <div class="cp-stat" role="listitem"><span>Transcript turns</span><b>{{ c.transcript.length }}</b></div>
            <div class="cp-stat" role="listitem"><span>Inputs loaded</span><b>{{ c.inputs.length }}</b></div>
            <div class="cp-stat cp-stat-good" role="listitem"><span>Outputs saved</span><b>{{ c.answers.length }}</b></div>
          </div>

          @if (c.goal_evaluation; as ge) {
            @if (ge.goals.length) {
              <section class="cp-card cge-card" aria-label="Goals">
                <div class="cge-head">
                  <h2>Goals</h2>
                  <div class="cge-summary">
                    @for (g of ge.goals; track g.id) {
                      <span class="cg-pill" [class.pos]="g.outcome === 'positive'" [class.par]="g.outcome === 'partial'" [class.neg]="g.outcome === 'negative'" [title]="g.reason || g.outcome">
                        {{ g.name }}: {{ g.outcome === 'positive' ? 'Positive' : g.outcome === 'negative' ? 'Negative' : g.outcome === 'skipped' ? 'Skipped' : 'Partial' }}
                      </span>
                    }
                    @if (ge.overall; as ov) {
                      <span class="cg-pill" [class.pos]="ov === 'positive'" [class.par]="ov === 'partial'" [class.neg]="ov === 'negative'" [title]="'Rollup: ' + ge.rollup.replaceAll('_', ' ')">
                        Overall: {{ ov === 'positive' ? 'Positive' : ov === 'negative' ? 'Negative' : 'Partial' }}
                      </span>
                    }
                  </div>
                </div>
                <details class="cge-details">
                  <summary>Rule breakdown</summary>
                  <div class="cge-list">
                    @for (g of ge.goals; track g.id) {
                      <div class="cge-row">
                        <div class="cge-row-main">
                          <span class="cg-pill" [class.pos]="g.outcome === 'positive'" [class.par]="g.outcome === 'partial'" [class.neg]="g.outcome === 'negative'">
                            {{ g.outcome === 'positive' ? 'Positive' : g.outcome === 'negative' ? 'Negative' : g.outcome === 'skipped' ? 'Skipped' : 'Partial' }}
                          </span>
                          <b>{{ g.name }}</b>
                          @if (g.reason) { <span class="cp-muted" style="font-size:12px">· {{ g.reason }}</span> }
                        </div>
                        @if (g.traces.length) {
                          <div class="cge-traces">
                            @for (t of g.traces; track $index) {
                              <span class="cge-trace" [class.pass]="t.bucket !== 'negative' && t.passed" [class.neg-hit]="t.bucket === 'negative' && t.passed">
                                {{ t.bucket === 'negative' ? (t.passed ? 'Neg ✓ ' : 'Neg ✕ ') : (t.bucket === 'when' ? 'When ' : '') + (t.passed ? '✓ ' : '✕ ') }}{{ t.field }} ({{ t.actual }})
                              </span>
                            }
                          </div>
                        }
                      </div>
                    }
                  </div>
                </details>
              </section>
            }
          }

          <!-- Side-by-side Input vs Output Comparison -->
          <div class="cp-io-grid">
            <section class="cp-card cp-io-in">
              <div class="cp-card-head">
                <h2>Sheet inputs</h2>
                <span class="cp-badge-count">{{ c.inputs.length }} fields</span>
              </div>
              @if (c.inputs.length) {
                <div class="cp-kv-cards">
                  @for (i of c.inputs; track i.key) {
                    <div class="cp-kv-item" [class.cp-kv-wide]="(i.value || '').length > 36">
                      <span class="cp-kv-k">{{ i.key.replaceAll('_', ' ') }}</span>
                      <b class="cp-kv-v">{{ i.value }}</b>
                    </div>
                  }
                </div>
              } @else {
                <p class="cp-muted">No sheet input columns were attached to this call.</p>
              }
            </section>

            <section class="cp-card cp-io-out">
              <div class="cp-card-head">
                <h2>Captured answers</h2>
                <span class="cp-badge-count good">{{ c.answers.length }} captured</span>
              </div>
              @if (c.answers.length) {
                <div class="cp-kv-cards">
                  @for (a of c.answers; track a.key) {
                    <div class="cp-kv-item out" [class.cp-kv-wide]="formatAnswer(a, c).length > 36">
                      <span class="cp-kv-k">{{ a.label }}</span>
                      <b class="cp-kv-v">{{ formatAnswer(a, c) }}</b>
                    </div>
                  }
                </div>
              } @else {
                <p class="cp-muted">No structured answers were extracted on this call.</p>
              }
              @if (c.rows?.length) {
                <div class="cp-subblock">
                  <h3>Per-row extraction ({{ c.rows!.length }} rows)</h3>
                  <div class="cp-scroll">
                    <table class="cp-tbl">
                      <thead><tr><th>Row</th><th>About</th><th>State</th><th>Saved at</th><th>Extracted answer</th></tr></thead>
                      <tbody>
                        @for (r of c.rows; track r.row) {
                          <tr>
                            <td>{{ r.row }}</td>
                            <td class="cp-cut" [title]="r.say || '—'">{{ r.say || '—' }}</td>
                            <td><span class="cp-pill">{{ r.state_label }}</span></td>
                            <td>{{ r.saved_second != null ? r.saved_second + 's' : '—' }}</td>
                            <td>{{ rowAnswer(r.answer) }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              }
            </section>
          </div>

          <!-- Recording, Transcript & Dials -->
          <div class="cp-grid">
            <div class="cp-col">
              @if (c.has_audio) {
                <section class="cp-card cp-rec-card">
                  <div class="cp-card-head">
                    <h2>Call Recording</h2>
                    <span class="cp-badge-count">{{ mmss(c.duration_seconds) }}</span>
                    <span class="cp-grow"></span>
                    @if (audioUrl()) { <a class="cp-link" [href]="audioUrl()" [download]="'recording-' + c.id + '.wav'">Download .wav</a> }
                  </div>
                  @if (audioUrl()) { <audio #audioEl controls [src]="audioUrl()" preload="metadata"></audio> }
                  @else { <p class="cp-muted">Loading the recording…</p> }
                </section>
              }

              <section class="cp-card">
                <div class="cp-card-head">
                  <h2>Transcript</h2>
                  <span class="cp-badge-count">{{ c.transcript.length }} turns</span>
                  <span class="cp-grow"></span>
                  @if (c.transcript.length) {
                    <button type="button" class="cp-link" (click)="copyTranscript()">{{ copied() ? 'Copied' : 'Copy' }}</button>
                    <button type="button" class="cp-link" (click)="downloadTranscript()" aria-label="Download transcript (.txt)">.txt</button>
                  }
                </div>
                @if (c.transcript.length) {
                  <div class="cp-turns">
                    @for (t of c.transcript; track $index) {
                      <div class="cp-turn" [class.agent]="t.who === 'Agent'">
                        <div class="cp-turn-head">
                          <b>{{ t.who }}</b>
                          @if (t.at) { <small class="mono">{{ shortTime(t.at) }}</small> }
                        </div>
                        <span>{{ t.text }}</span>
                      </div>
                    }
                  </div>
                } @else {
                  <p class="cp-muted">No transcript turns recorded for this call.</p>
                }
              </section>

              @if (source().diagnostics) {
                <section class="cp-card cp-diag">
                  <div class="cp-card-head"><h2>Latency &amp; Diagnostics</h2><span class="cp-grow"></span>
                    <button type="button" class="cp-btn" [attr.aria-expanded]="diagOpen()" (click)="toggleDiag(c.id)">{{ diagOpen() ? 'Hide' : 'Show' }}</button></div>
                  @if (diagOpen()) {
                    @if (diag(); as dg) {
                      <div class="cp-kv"><span>Ended</span><b>{{ dg.ended.text }} <code>{{ dg.ended.code }}</code></b>
                        <span>Guardrail</span><b>{{ dg.guardrail }}</b>
                        @if (dg.rerun) { <span>Re-run</span><b>{{ when(dg.rerun.at) }} by {{ dg.rerun.by }}: {{ dg.rerun.result }}</b> }
                        @if (dg.dnc) { <span>Do-not-call</span><b>{{ dg.dnc.reason }}</b> }</div>
                      @if (dg.ivr; as iv) { <p class="cp-note">Phone menu at {{ iv.at }}: {{ iv.detected }}. {{ iv.action }} after {{ (iv.after_ms / 1000).toFixed(1) }} s.</p> }
                      @if (dg.turns.length) {
                        <div class="cp-lat"><span>Response time <b>p50 {{ dg.summary.p50_ms }} ms</b></span><span><b>p90 {{ dg.summary.p90_ms }} ms</b></span><span>{{ dg.summary.turns }} agent turns</span>
                          <span [class.cp-warn]="dg.summary.interruptions">{{ dg.summary.interruptions }} interrupted</span><span [class.cp-warn]="dg.summary.slow_turns">{{ dg.summary.slow_turns }} slow (&gt; 1.2s)</span></div>
                        <div class="cp-scroll"><table class="cp-tbl"><thead><tr><th>#</th><th>Agent said</th><th>Listen</th><th>Think</th><th>Speak</th><th>Total</th></tr></thead><tbody>
                          @for (t of dg.turns; track t.n) { <tr [class.cp-slow]="t.total_ms > 1200"><td>{{ t.n }}</td><td class="cp-cut" [title]="t.text">{{ t.text }}@if (t.interrupted) { <small> · interrupted</small> }</td><td>{{ t.listen_ms }}</td><td>{{ t.think_ms }}</td><td>{{ t.speak_ms }}</td><td><b>{{ t.total_ms }}</b></td></tr> }
                        </tbody></table></div>
                      }
                      @if (dg.tools.length) {
                        <b class="cp-sub">Tool calls</b>
                        @for (tc of dg.tools; track tc.name + tc.at) { <div class="cp-tool"><code>{{ tc.name }}({{ args(tc.args) }})</code><span [class.cp-ok]="tc.status < 300" [class.cp-warn]="tc.status >= 300">{{ tc.status }}</span><span class="cp-muted">{{ tc.ms }} ms · at {{ tc.at }}</span><span>{{ tc.result }}</span></div> }
                      }
                    } @else { <p class="cp-muted">Loading the diagnostics…</p> }
                  }
                </section>
              }
            </div>

            <div class="cp-col">
              <section class="cp-card">
                <div class="cp-card-head"><h2>Dial attempts</h2><span class="cp-badge-count">{{ c.dials.length }}</span></div>
                @if (c.dials.length) {
                  <div class="cp-scroll">
                    <table class="cp-tbl">
                      <thead><tr><th>#</th><th>Time</th><th>Ring</th><th>Talk</th><th>Result</th><th>Provider</th></tr></thead>
                      <tbody>
                        @for (x of c.dials; track x.n) {
                          <tr><td><b>#{{ x.n }}</b></td><td>{{ when(x.at) }}</td><td>{{ x.ring_seconds ?? '—' }}s</td><td>{{ x.talk_seconds ?? 0 }}s</td><td>{{ x.result || '—' }}</td><td class="cp-muted">{{ x.provider || '—' }}</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else { <p class="cp-muted">No dial attempts recorded.</p> }
              </section>

              @if (memory(); as mem) {
                <section class="cp-card">
                  <div class="cp-card-head"><h2>Prior contact context</h2><span class="cp-muted">{{ mem.on ? mem.calls + ' prior call' + (mem.calls === 1 ? '' : 's') : 'Memory off' }}</span></div>
                  @if (mem.on) {
                    <ul class="cp-mem">@for (l of mem.lines; track $index) { <li>{{ l }}</li> }</ul>
                    @if (mem.last?.length) { <div class="cp-rows">@for (x of mem.last!; track x.id) { <div class="cp-row"><span class="cp-muted">{{ when(x.date) }}</span><button type="button" class="cp-linkbtn" (click)="go(x.id)">{{ x.result }}</button><span class="cp-muted">{{ x.campaign }}</span></div> }</div> }
                  }
                </section>
              }

              @if (steps(); as st) {
                <section class="cp-card cp-steps">
                  <h2>Next steps &amp; Follow-up</h2>
                  @if (st.dnc; as dn) { <p class="cp-note bad">On do-not-call list: {{ dn.reason }}.</p> }
                  @if (st.result_rule; as rr) { <p class="cp-muted">Rule for "{{ rr.label }}": {{ rr.act === 'stop' ? 'stops calling' : rr.act === 'callback' ? 'schedules callback' : 'retries ' + rr.tries + ' more time(s)' }}{{ rr.message === 'none' ? '' : rr.message === 'both' ? ', with WhatsApp and email' : ', with WhatsApp' }}.</p> }
                  @if (st.messages.length) {
                    <div class="cp-seg" role="group" aria-label="Channel">
                      @for (ch of channels(st); track ch) { <button type="button" [class.on]="channel() === ch" [attr.aria-pressed]="channel() === ch" (click)="channel.set(ch)">{{ ch === 'whatsapp' ? 'WhatsApp' : 'Email' }}</button> }
                    </div>
                    @for (m of shown(st); track m.key + m.channel) {
                      <div class="cp-msg">
                        <div class="cp-msg-head"><b>{{ m.title }}</b><span class="cp-muted">to {{ m.channel === 'email' ? (c.email || 'no email') : c.phone }}</span></div>
                        <textarea [rows]="m.channel === 'email' ? 5 : 3" [value]="draft(m)" (input)="setDraft(m, $any($event.target).value)" [attr.aria-label]="m.title"></textarea>
                        <div class="cp-msg-foot"><span class="cp-muted">From {{ st.caller_id }}</span><span class="cp-grow"></span>
                          <button type="button" class="cp-btn cp-primary" [disabled]="sending() || (m.channel === 'email' && !c.email)" (click)="send(m)">{{ m.channel === 'email' ? 'Send email' : 'Send on WhatsApp' }}</button></div>
                      </div>
                    }
                  }
                  @if (st.sent.length) {
                    <div class="cp-rows">@for (x of st.sent; track $index) { <div class="cp-row"><span class="cp-muted">{{ when(x.at) }}</span><span>{{ x.channel === 'email' ? 'Email' : 'WhatsApp' }} to {{ x.to }}</span><span class="cp-muted">by {{ x.by }}</span></div> }</div>
                  }
                </section>
              }

              @if (c.timeline.length) {
                <section class="cp-card">
                  <h2>Workflow timeline</h2>
                  <div class="cp-rows">@for (e of c.timeline; track $index) { <div class="cp-row"><span class="cp-muted">{{ when(e.at) }}</span><span>{{ plainEvent(e.type) }}</span><span class="cp-muted">{{ plainStatus(e.status) }}{{ e.detail ? ' · ' + e.detail : '' }}</span></div> }</div>
                </section>
              }
            </div>
          </div>
        }
      } @else if (!error()) { <p class="cp-muted" role="status">Loading the call…</p> }
    </div>
  `,
  styles: [`
    :host { display: block; --cp-text: var(--ds-text, var(--text, #0c0a09)); --cp-muted: var(--ds-text-muted, var(--muted, #5c5752)); --cp-line: var(--ds-border, var(--line, #e7e5e2));
      --cp-bg: var(--ds-surface, var(--card, #fff)); --cp-soft: var(--ds-surface-sunken, var(--bg-2, #f5f5f4)); --cp-good: var(--ds-success-fg, #146c34); --cp-accent: var(--ds-accent-fg, var(--ds-accent, #047857)); }
    .cp { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; color: var(--cp-text); }
    .cp > *, .cp-col > * { min-width: 0; }
    .cp-busy { opacity: .7; }
    .cp-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .cp-grow { flex: 1; }
    .cp-muted { color: var(--cp-muted); font-size: 12.5px; }
    .cp-btn { border: 1px solid var(--cp-line); background: var(--cp-bg); color: var(--cp-text); border-radius: 8px; padding: 6px 12px; min-height: 30px; font: inherit; font-size: 13px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }
    .cp-btn-sm { padding: 4px 10px; min-height: 28px; font-size: 12px; }
    .cp-btn:disabled { opacity: .45; cursor: default; }
    .cp-primary { background: var(--ds-accent, #047857); color: var(--ds-on-accent, #fff); border-color: var(--ds-accent, #047857); }
    .cp-link { border: 0; background: none; text-decoration: underline; color: var(--cp-muted); cursor: pointer; font: inherit; font-size: 13px; padding: 4px 6px; min-height: 28px; justify-self: start; display: inline-flex; align-items: center; }
    .cp-hero { border: 1px solid var(--cp-line); border-radius: 14px; background: var(--cp-bg); padding: 16px; display: grid; gap: 12px; box-shadow: var(--ds-shadow-sm, 0 1px 3px rgba(0,0,0,.04)); }
    .cp-hero-main { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
    .cp-hero-id { display: flex; align-items: center; gap: 12px; }
    .cp-avatar { width: 44px; height: 44px; border-radius: 12px; background: color-mix(in srgb, var(--ds-accent, #047857) 14%, var(--cp-soft)); color: var(--cp-accent); font-weight: 700; font-size: 15px; display: grid; place-items: center; flex: none; }
    .cp-title { margin: 0; font-size: 24px; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; }
    .cp-sub-row { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: 12.5px; color: var(--cp-muted); margin-top: 2px; }
    .cp-sub-row b { color: var(--cp-text); font-weight: 600; }
    .cp-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .cp-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--cp-line); border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 600; background: var(--cp-soft); }
    .cp-chip-strong { background: var(--cp-bg); }
    .cp-chip i { width: 8px; height: 8px; border-radius: 50%; }
    .cp-chip.good, .cp-out-good { color: var(--ds-success-fg, #146c34); border-color: var(--ds-success-border, #bbf7d0); background: var(--ds-success-bg, #f0fdf4); }
    .cp-out-warn { color: var(--ds-warning-fg, #a14d07); border-color: var(--ds-warning-border, #fcd9a4); background: var(--ds-warning-bg, #fff8eb); }
    .cp-out-info { color: var(--ds-info-fg, #3d33a0); border-color: var(--ds-info-border, #d4d1f6); background: var(--ds-info-bg, #f2f1fd); }
    .cp-out-accent { color: var(--ds-info-fg, #3d33a0); border-color: var(--ds-info-border, #d4d1f6); background: var(--ds-info-bg, #f2f1fd); }
    .cp-out-bad { color: var(--ds-danger-fg, #b91c1c); border-color: var(--ds-danger-border, #fecaca); background: var(--ds-danger-bg, #fef2f2); }
    .cp-prog-banner { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--ds-warning-bg, #fff8eb); border: 1px solid var(--ds-warning-border, #fcd9a4); color: var(--ds-warning-fg, #a14d07); }
    .cp-prog-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ds-warning, #e28a0b); flex: none; }
    .cp-prog-copy { display: grid; gap: 2px; font-size: 12.5px; }
    .cp-summary-box { padding: 10px 12px; border-radius: 10px; background: var(--cp-soft); border-left: 3px solid var(--cp-accent); display: grid; gap: 4px; }
    .cp-summary-k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--cp-muted); }
    .cp-summary-box p { margin: 0; font-size: 13.5px; line-height: 1.5; }
    .cp-edit-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 8px; background: var(--cp-soft); border: 1px solid var(--cp-line); }
    .cp-edit-bar select, .cp-edit-bar input { border: 1px solid var(--cp-line); border-radius: 6px; padding: 5px 8px; font: inherit; font-size: 13px; background: var(--cp-bg); color: var(--cp-text); }
    .cp-edit-bar input { flex: 1 1 200px; }
    .cp-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
    .cp-stat { border: 1px solid var(--cp-line); border-radius: 10px; background: var(--cp-bg); padding: 10px 12px; display: grid; gap: 2px; }
    .cp-stat span { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--cp-muted); font-weight: 600; }
    .cp-stat b { font-size: 19px; font-variant-numeric: tabular-nums; }
    .cp-stat-good { border-color: var(--ds-success-border, #bbf7d0); background: var(--ds-success-bg, #f0fdf4); }
    .cp-stat-good b { color: var(--cp-good); }
    .cp-io-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 12px; align-items: start; }
    .cp-io-in { border-top: 3px solid var(--cp-accent); }
    .cp-io-out { border-top: 3px solid var(--cp-good); }
    .cp-badge-count { font-size: 11px; font-weight: 650; padding: 2px 8px; border-radius: 999px; background: var(--cp-soft); color: var(--cp-muted); }
    .cp-badge-count.good { background: var(--ds-success-bg, #f0fdf4); color: var(--cp-good); }
    .cp-kv-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
    .cp-kv-item { border: 1px solid var(--cp-line); border-radius: 8px; padding: 7px 10px; background: var(--cp-soft); display: grid; gap: 2px; }
    .cp-kv-item.cp-kv-wide { grid-column: 1 / -1; }
    .cp-kv-item.out { background: color-mix(in srgb, var(--cp-good) 5%, var(--cp-bg)); border-color: color-mix(in srgb, var(--cp-good) 28%, var(--cp-line)); }
    .cp-kv-k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--cp-muted); font-weight: 600; }
    .cp-kv-v { font-size: 13px; font-weight: 600; word-break: break-word; }
    .cp-subblock { border-top: 1px solid var(--cp-line); padding-top: 10px; display: grid; gap: 6px; }
    .cp-subblock h3 { margin: 0; font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--cp-muted); }
    .cp-pill { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 999px; background: var(--cp-soft); border: 1px solid var(--cp-line); }
    .cp-locked-card { padding: 18px; gap: 12px; }
    .cp-locked-head h2 { margin-bottom: 4px; color: var(--cp-text); font-size: 15px; text-transform: none; letter-spacing: 0; }
    .cp-note { margin: 0; padding: 8px 12px; border-radius: 8px; background: var(--cp-soft); font-size: 13px; }
    .cp-note.bad { color: var(--ds-danger-fg, #b91c1c); }
    .cp-grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 12px; align-items: start; }
    .cp-col { display: grid; gap: 12px; }
    .cp-card { border: 1px solid var(--cp-line); border-radius: 12px; background: var(--cp-bg); padding: 12px 14px; display: grid; gap: 8px; }
    .cp-card h2 { margin: 0; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--cp-muted); font-weight: 650; }
    .cp-card p { margin: 0; font-size: 13.5px; line-height: 1.5; }
    .cp-card-head { display: flex; align-items: center; gap: 8px; }
    .cp-lat { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; }
    .cp-warn { color: var(--ds-warning-fg, #a14d07); font-weight: 600; } .cp-ok { color: var(--cp-good); font-weight: 600; }
    .cp-scroll { overflow-x: auto; }
    .cp-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
    .cp-tbl th { text-align: left; font-weight: 600; color: var(--cp-muted); padding: 5px 6px; border-bottom: 1px solid var(--cp-line); white-space: nowrap; }
    .cp-tbl td { padding: 5px 6px; border-bottom: 1px solid var(--cp-line); }
    .cp-tbl tr.cp-slow td { background: color-mix(in srgb, var(--ds-warning, #e28a0b) 10%, transparent); }
    .cp-cut { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cp-tool { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; font-size: 12.5px; border-bottom: 1px solid var(--cp-line); padding: 4px 0; }
    .cp-tool code, .cp-kv code { font-size: 12px; background: var(--cp-soft); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
    .cp-sub { font-size: 13px; }
    .cp-linkbtn { border: 0; background: none; padding: 2px 4px; color: var(--cp-accent); text-decoration: underline; font: inherit; cursor: pointer; text-align: left; }
    .cp-mem { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13.5px; }
    .cp-turns { display: grid; gap: 8px; max-height: 460px; overflow: auto; }
    .cp-turn { display: grid; gap: 3px; padding: 8px 11px; border-radius: 10px; background: var(--cp-soft); font-size: 13px; max-width: 90%; line-height: 1.45; }
    .cp-turn.agent { background: var(--ds-info-bg, #eef2ff); justify-self: end; border: 1px solid color-mix(in srgb, var(--cp-accent) 18%, transparent); }
    .cp-turn-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .cp-turn b { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--cp-muted); font-weight: 700; }
    .cp-turn small { font-size: 10.5px; color: var(--cp-muted); }
    .cp-steps { border-color: color-mix(in srgb, var(--ds-accent, #047857) 35%, var(--cp-line)); }
    .cp-times { display: flex; flex-wrap: wrap; gap: 6px; }
    .cp-times span { background: var(--cp-soft); border-radius: 6px; padding: 3px 8px; font-size: 12.5px; }
    .cp-times span.first { background: var(--cp-text); color: var(--cp-bg); }
    .cp-seg { display: inline-flex; border: 1px solid var(--cp-line); border-radius: 8px; overflow: hidden; justify-self: start; }
    .cp-seg button { border: 0; background: var(--cp-bg); color: var(--cp-text); padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer; }
    .cp-seg button.on { background: var(--cp-text); color: var(--cp-bg); }
    .cp-msg { display: grid; gap: 6px; border: 1px solid var(--cp-line); border-radius: 10px; padding: 10px; }
    .cp-msg-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 13px; }
    .cp-msg textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--cp-line); border-radius: 8px; padding: 8px; font: inherit; font-size: 13px; background: var(--cp-bg); color: var(--cp-text); resize: vertical; }
    .cp-msg-foot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; }
    .cp-kv { display: grid; grid-template-columns: minmax(110px, auto) 1fr; gap: 6px 12px; font-size: 13px; }
    .cp-kv span { color: var(--cp-muted); text-transform: capitalize; }
    .cp-kv b { font-weight: 500; word-break: break-word; }
    .cp-rows { display: grid; gap: 6px; font-size: 12.5px; }
    .cp-row { display: grid; grid-template-columns: 1.2fr 1fr 1.6fr; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--cp-line); }
    .cp-row:last-child { border-bottom: 0; }
    audio { width: 100%; height: 38px; }
    @media (max-width: 960px) { .cp-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); } .cp-io-grid, .cp-grid { grid-template-columns: minmax(0, 1fr); } .cp-bar { flex-wrap: wrap; } .cp-row { grid-template-columns: 1fr; } }
    @media (max-width: 640px) {
      .cp-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cp-tbl th, .cp-tbl td { white-space: normal; word-break: break-word; font-size: 12px; padding: 5px 4px; }
      .cp-cut { max-width: 110px; }
      .cp-btn, .cp-btn-sm, .cp-link { min-height: 36px; }
    }
  `],
})
export class CallPageComponent implements OnDestroy {
  readonly source = input.required<CallPageSource>();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly id = signal('');
  protected readonly d = signal<CallDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly audioUrl = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly pick = signal('');
  protected readonly note = signal('');
  protected readonly copied = signal(false);
  protected readonly steps = signal<CallSteps | null>(null);
  protected readonly diagOpen = signal(false);
  protected readonly memory = signal<CallMemory | null>(null);
  protected readonly diag = signal<CallDiagnostics | null>(null);
  protected toggleDiag(id: string): void {
    this.diagOpen.set(!this.diagOpen()); if (!this.diagOpen() || this.diag()) return;
    this.source().diagnostics?.(id).then((d) => this.diag.set(d)).catch(() => this.diagOpen.set(false));
  }
  protected args(a: Record<string, unknown>): string { return Object.entries(a).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', '); }
  protected readonly channel = signal<'whatsapp' | 'email'>('whatsapp');
  protected readonly sending = signal(false);
  private readonly drafts = signal<Record<string, string>>({});
  private seq = 0;

  protected readonly answered = computed(() => { const c = this.d(); return !!c && c.call_status === 'Answered'; });
  protected readonly hasTalked = computed(() => {
    const c = this.d();
    return !!c && c.call_status === 'Answered' && c.status_reason !== 'Agent not given time to speak' && (c.duration_seconds ?? 0) > 0;
  });
  protected readonly inRetryOrCallback = computed(() => {
    const c = this.d();
    const st = this.steps();
    return !!c && (c.call_status === 'In progress' || !!c.callback_at || /callback/i.test(c.status_reason || '') || !!(st?.retry && st.retry.left > 0 && c.call_status !== 'Answered'));
  });
  protected readonly totalRingSeconds = computed(() => (this.d()?.dials || []).reduce((s, d) => s + (Number(d.ring_seconds) || 0), 0));
  protected readonly outcomeLabel = computed(() => {
    const r = this.d()?.status_reason || '';
    if (r === 'Success: Accepted') return 'Positive';
    if (r === 'Success: Partial') return 'Partial';
    if (r === 'Success: Follow-up required') return 'Follow-up required';
    if (r === 'Success: Callback requested') return 'Callback requested';
    if (this.d()?.call_status === 'Answered') return 'Negative';
    return r || this.d()?.call_status || '—';
  });
  protected readonly outcomeTone = computed(() => {
    const r = this.d()?.status_reason || '';
    if (r === 'Success: Accepted') return 'good';
    if (r === 'Success: Partial') return 'warn';
    if (r === 'Success: Follow-up required') return 'info';
    if (r === 'Success: Callback requested') return 'accent';
    return 'bad';
  });
  protected initials(s: string): string {
    return String(s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
  }
  protected readonly color = computed(() => {
    const c = this.d(); if (!c) return COLORS['not_planned']; const s = c.call_status;
    if (s === 'Answered') return c.status_reason.startsWith('Success') && c.status_reason !== 'Success: Negative' ? COLORS['success'] : COLORS['not_successful'];
    if (s === 'No reply' || s === 'System issue') return COLORS['no_conversation'];
    if (s === 'Not picked' || s === 'DND' || s === 'Voicemail') return COLORS['not_picked_up'];
    return s === 'In progress' ? COLORS['in_progress'] : COLORS['not_planned'];
  });
  protected readonly reasonText = computed(() => { const c = this.d(); return c ? `${c.call_status}: ${c.status_reason}` : ''; });

  @ViewChild('audioEl') private audioEl?: ElementRef<HTMLAudioElement>;
  @HostListener('window:keydown', ['$event'])
  onShortcut(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName || '';
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag) || (e.target as HTMLElement | null)?.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'j') { const next = this.d()?.next_id; if (next) { e.preventDefault(); this.go(next); } }
    else if (k === 'k') { const prev = this.d()?.prev_id; if (prev) { e.preventDefault(); this.go(prev); } }
    else if (k === ' ') {
      const el = this.audioEl?.nativeElement;
      if (el) { e.preventDefault(); if (el.paused) el.play().catch(() => {}); else el.pause(); }
    }
  }

  constructor() {
    this.route.paramMap.subscribe((p) => this.id.set(p.get('id') || ''));
    effect(() => { const id = this.id(); if (id) untracked(() => this.load(id)); });
  }
  ngOnDestroy(): void { this.revoke(); }

  private async load(id: string): Promise<void> {
    const my = ++this.seq; this.loading.set(true); this.error.set(''); this.editing.set(false); this.revoke();
    try {
      const c = await this.source().detail(id); if (my !== this.seq) return; this.d.set(c);
      this.steps.set(null); this.drafts.set({});
      this.diag.set(null); this.diagOpen.set(false); this.memory.set(null);
      this.source().memory?.(id).then((m) => { if (my === this.seq) this.memory.set(m); }).catch(() => {});
      this.source().steps?.(id).then((st) => {
        if (my !== this.seq) return;
        const isPi = /pi[\s_-]*packaging|pi industries/i.test(`${c.agent || ''} ${c.campaign || ''}`);
        const norm = structuredClone(st);
        if (isPi) {
          if (norm.branded_caller?.name === 'Moglix Procurement') {
            norm.branded_caller.name = 'PI Industries Packaging Desk';
            norm.branded_caller.number = '+91 80 0000 0201';
            norm.caller_id = '+91 80 0000 0201';
          }
          for (const m of norm.messages || []) {
            m.text = m.text
              .replace(/\bMoglix Procurement\b/g, 'PI Industries Packaging Desk');
          }
        }
        for (const m of norm.messages || []) {
          m.text = m.text.replace(/\bfollow up by in the next\b/g, 'follow up in the next');
        }
        this.steps.set(norm);
        if (!norm.messages.some((m) => m.channel === this.channel())) this.channel.set(norm.messages[0]?.channel ?? 'whatsapp');
      }).catch(() => {});
      if (c.has_audio && c.audio_path) this.source().audio(c.audio_path).then((b) => { if (my === this.seq) this.audioUrl.set(URL.createObjectURL(b)); }).catch(() => {});
    } catch { if (my === this.seq) this.error.set('Could not load this call.'); }
    finally { if (my === this.seq) this.loading.set(false); }
  }
  private revoke(): void { const u = this.audioUrl(); if (u) URL.revokeObjectURL(u); this.audioUrl.set(null); }

  /** Back to the list the call was opened from (its filters are in its address); straight in, back to the dashboard. */
  protected back(): void {
    // A signal on newer Angular (Clarix), a plain value on older (Echo).
    const n: any = (this.router as any).lastSuccessfulNavigation; const nav = typeof n === 'function' ? n() : n;
    if (nav?.previousNavigation) history.back(); else this.router.navigate([this.source().home]);
  }
  /** Previous and Next replace this page in history, so Back still returns to the list. */
  protected go(id: string | null): void { if (id) this.router.navigate([this.source().base, id], { replaceUrl: true }); }

  // ── Next steps: messages ──
  protected channels(st: CallSteps): ('whatsapp' | 'email')[] { return (['whatsapp', 'email'] as const).filter((ch) => st.messages.some((m) => m.channel === ch)); }
  protected shown(st: CallSteps): StepMessage[] { return st.messages.filter((m) => m.channel === this.channel()); }
  protected draft(m: StepMessage): string { return this.drafts()[`${m.key}:${m.channel}`] ?? m.text; }
  protected setDraft(m: StepMessage, v: string): void { this.drafts.set({ ...this.drafts(), [`${m.key}:${m.channel}`]: v }); }
  protected async send(m: StepMessage): Promise<void> {
    const c = this.d(); if (!c || !this.source().sendMessage) return; this.sending.set(true);
    try { this.steps.set(await this.source().sendMessage!(c.id, { channel: m.channel, key: m.key, text: this.draft(m) })); } catch { this.error.set('Could not record the message.'); } finally { this.sending.set(false); }
  }
  protected ruleText(st: CallSteps): string {
    const r = st.rule; const name = ({ linear: 'linear', increasing: 'linear increasing', doubling: 'doubling' } as Record<string, string>)[r.schedule] ?? r.schedule;
    return `${r.retries} retries, ${name} from ${r.base_minutes} min, ${r.from}–${r.to}${r.skip_sunday ? ', no Sundays' : ''}${r.avoid_saturday ? ', no Saturdays' : ''}${r.avoid_lunch ? ', not 1–2 pm' : ''}${r.prefer_prime_slots ? ', 10–12 and 2–5 preferred' : ''}`;
  }
  protected downloadVcard(st: CallSteps): void {
    if (!st.vcard) return; this.save(new Blob([st.vcard], { type: 'text/vcard' }), `${(st.branded_caller?.name || 'caller').replace(/[^A-Za-z0-9]+/g, '_')}.vcf`);
  }

  protected startEdit(): void { const c = this.d(); if (!c) return; this.pick.set(c.status_reason); this.note.set(''); this.editing.set(true); }
  protected async saveOutcome(): Promise<void> {
    const c = this.d(); if (!c) return;
    try { this.d.set(await this.source().changeOutcome(c.id, this.pick(), this.note())); this.editing.set(false); } catch { this.error.set('Could not change the outcome.'); }
  }

  protected copyTranscript(): void { navigator.clipboard?.writeText(this.transcriptText()); this.copied.set(true); setTimeout(() => this.copied.set(false), 1500); }
  protected downloadTranscript(): void { this.save(new Blob([this.transcriptText()], { type: 'text/plain;charset=utf-8' }), `transcript-${this.d()?.id}.txt`); }
  protected exportJson(): void { const c = this.d(); if (c) this.save(new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' }), `call-${c.id}.json`); }
  private transcriptText(): string { return (this.d()?.transcript ?? []).map((t) => `${t.who}: ${t.text}`).join('\n'); }
  private save(blob: Blob, name: string): void { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

  /** Timeline steps in plain words: "webhook received" means the phone line sent back the call's result. */
  protected plainEvent(t: string): string {
    const m: Record<string, string> = { 'workflow triggered': 'Row picked up for calling', 'call initiated': 'Call placed', 'waiting for webhook': 'Waiting for the call result',
      'webhook received': 'Call result received', 'workflow failed': 'Call did not connect', 'workflow completed': 'Call finished', 'extraction completed': 'Answers saved', 'retry scheduled': 'Call again scheduled' };
    return m[String(t).toLowerCase()] ?? String(t).charAt(0).toUpperCase() + String(t).slice(1);
  }
  protected plainStatus(st: string): string { return ({ SUCCESS: 'Done', FAILED: 'Did not work', PENDING: 'Waiting' } as Record<string, string>)[st] ?? st; }
  protected mmss(s: number | null | undefined): string { if (s == null) return '—'; const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
  protected formatAnswer(a: { key: string; label: string; value: unknown }, c: CallDetail): string {
    const raw = a?.value;
    if (Array.isArray(raw)) {
      if (raw.every((x) => x && typeof x === 'object')) {
        return `${raw.length} row${raw.length === 1 ? '' : 's'} recorded`;
      }
      return raw.join(', ');
    }
    const str = typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : String(raw ?? '');
    if (str.includes('[object Object]')) {
      if (c.rows?.length) {
        return `${c.rows.length} row${c.rows.length === 1 ? '' : 's'} recorded (${c.rows.map((r) => `Row ${r.row}: ${this.rowAnswer(r.answer)}`).join(' · ')})`;
      }
      return 'Recorded per row (see Rows on this call)';
    }
    return str;
  }
  protected rowAnswer(a: Record<string, unknown>): string { return Object.entries(a || {}).filter(([k, v]) => k !== 'row' && v !== '' && v != null).slice(0, 3).map(([, v]) => String(v).replace(/_/g, ' ')).join(' · ') || 'no answer saved'; }
  protected when(iso: string | null): string { return iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'; }
  protected shortTime(iso: string | null): string {
    if (!iso) return '';
    const d = Date.parse(iso);
    if (!Number.isFinite(d)) return String(iso);
    return new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
}
