import { Component, inject, signal, computed, OnInit, HostListener } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { RecordingComponent } from '../call-console/recording.component';
import { GuideComponent } from '../../components/guide/guide.component';
import { fmtTime, fmtSecs } from '../../utils/format';
import { outcomeView, goalView, dialSentence } from '../../utils/status';

/**
 * The call page: everything about one contact's call on one page.
 *
 * Opened two ways:
 *   /campaigns/:cid/contacts/:pid  a campaign contact: outcome, every dial, rows
 *                                  and answers, plus the call if someone picked up
 *   /calls/:id                     any call by id (console tests, the overview list)
 *
 * Previous and next step through the campaign's contacts without going back to
 * the list. Transcript, audio and the full record download from the top bar.
 */
@Component({
  selector: 'app-call-analysis',
  standalone: true,
  imports: [RouterLink, IconComponent, RecordingComponent, GuideComponent],
  template: `
    <div class="page analysis-page">
      <div class="analysis-nav-bar">
        <nav class="crumbs" aria-label="Breadcrumb">
          @if (cid()) {
            <a routerLink="/campaigns">Campaigns</a><span>/</span>
            <a [routerLink]="['/campaigns', cid()]">{{ contact()?.campaign?.name || 'Campaign' }}</a><span>/</span>
          } @else {
            <a routerLink="/overview">Calls</a><span>/</span>
          }
          <b>{{ title() }}</b>
        </nav>
        <div class="analysis-nav-actions">
          @if (cid() && contact()) {
            <div class="cp-nav">
              <button class="icon-btn" [disabled]="!contact().prev" (click)="go(contact().prev)" title="Previous contact (k)" aria-label="Previous contact"><app-icon name="chevronLeft" [size]="15"></app-icon></button>
              <span class="row-sub mono">{{ contact().position }} of {{ contact().total }}</span>
              <button class="icon-btn" [disabled]="!contact().next" (click)="go(contact().next)" title="Next contact (j)" aria-label="Next contact"><app-icon name="chevronRight" [size]="15"></app-icon></button>
            </div>
          }
          @if (callId()) {
            <a class="icon-btn" [href]="api.callTranscriptUrl(callId())" download title="Download transcript" aria-label="Download transcript"><app-icon name="transcript" [size]="15"></app-icon></a>
            <a class="icon-btn" [href]="api.recordingUrls(callId()).download" download title="Download audio" aria-label="Download audio"><app-icon name="headphones" [size]="15"></app-icon></a>
          }
          <button class="icon-btn" (click)="exportRecord()" title="Download the full record (JSON)" aria-label="Download the full record"><app-icon name="download" [size]="15"></app-icon></button>
        </div>
      </div>


      @if (loading()) {
        <div class="empty"><div class="empty-title">Loading…</div></div>
      } @else if (error()) {
        <div class="note bad">{{ error() }}</div>
      } @else {
        <!-- What happened, in one line -->
        <div class="card cp-outcome" style="margin-top: 16px">
          <span [class]="'tag ' + ov().cls" style="font-size: 13px" [title]="ov().help">{{ ov().label }}</span><app-guide topic="outcomes"></app-guide>
          <div style="flex: 1; min-width: 200px">
            <div class="cp-outcome-main">{{ sentence() }}</div>
            <div class="cp-outcome-sub">{{ ov().help }}@if (nextTry()) { · next try {{ nextTry() }} }</div>
          </div>
          @if (gv(); as g) { <span [class]="'tag ' + g.cls">{{ g.label }}</span> }
          <div class="progress-facts">
            @if (contact()) { <span>Dials <b>{{ contact().attempts || 0 }}</b></span> }
            <span>Talk <b>{{ fmtSecs(talkSeconds()) }}</b></span>
            @if (call()?.started_at) { <span>Started <b>{{ fmtTime(call().started_at) }}</b></span> }
            <span>Agent <b>{{ contact()?.campaign?.agent_label || agentLabel() }}</b></span>
          </div>
        </div>

        <div class="cp-grid">
          <div class="col-stack">
            @if (answerPairs().length) {
              <div class="card analysis-card">
                <div class="card-head"><span class="card-title"><app-icon name="check" [size]="14"></app-icon> Answers</span></div>
                <div class="cp-kv">
                  @for (kv of answerPairs(); track kv.key) { <span>{{ kv.key }}</span><span>{{ kv.value }}</span> }
                </div>
              </div>
            }

            @if (contact()?.rows?.length) {
              <div class="card analysis-card">
                <div class="card-head">
                  <span class="card-title"><app-icon name="rows" [size]="14"></app-icon> Rows on this call ({{ contact().rows.length }})</span>
                  @if (contact().parts > 1) { <span class="row-sub">call {{ contact().part }} of {{ contact().parts }} for this contact</span> }
                </div>
                <div class="scroll-x">
                  <table class="table cp-rows">
                    <thead><tr><th>#</th><th>File row</th>@for (c of contact().row_columns; track c) { <th>{{ nice(c) }}</th> }@for (f of answerCols(); track f) { <th class="cp-ans">{{ nice(f) }}</th> }</tr></thead>
                    <tbody>
                      @for (r of contact().rows; track r.n) {
                        <tr>
                          <td class="mono">{{ r.n }}</td><td class="mono row-sub">{{ r.row }}</td>
                          @for (c of contact().row_columns; track c) { <td>{{ r.values[c] }}</td> }
                          @for (f of answerCols(); track f) { <td class="cp-ans">{{ show(r.answer?.[f]) }}</td> }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }

            @if (contact()?.attempt_log?.length) {
              <div class="card analysis-card">
                <div class="card-head"><span class="card-title"><app-icon name="repeat" [size]="14"></app-icon> Dials ({{ contact().attempt_log.length }}) <app-guide topic="retry"></app-guide></span></div>
                <div class="scroll-x">
                  <table class="table cp-rows">
                    <thead><tr><th>#</th><th>When</th><th>Ring</th><th>Talk</th><th>Ended by</th><th>Outcome</th><th>Provider said</th></tr></thead>
                    <tbody>
                      @for (a of contact().attempt_log; track a.attempt) {
                        <tr>
                          <td class="mono">{{ a.attempt }}</td>
                          <td class="mono">{{ clock(a.started_at) }}</td>
                          <td class="mono">{{ fmtSecs(a.ring_seconds) }}</td>
                          <td class="mono">{{ a.talk_seconds ? fmtSecs(a.talk_seconds) : '—' }}</td>
                          <td>{{ endedBy(a.facts?.picked_up ? a.facts?.ended_by : "") }}</td>
                          <td><span [class]="'tag ' + outcomeView(a.outcome).cls">{{ outcomeView(a.outcome).label }}</span>
                            @if (a.facts?.provider_disagrees) { <span class="tag warn" title="The provider said not answered, but Echo heard the caller">check</span> }</td>
                          <td class="mono row-sub" [title]="raw(a.provider)">{{ a.provider_name }}: {{ a.provider?.Status }} · {{ a.provider?.CustomerStatus }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }

            @if (contextPairs().length) {
              <div class="card analysis-card">
                <div class="card-head"><span class="card-title"><app-icon name="database" [size]="14"></app-icon> Call details</span></div>
                <div class="cp-kv">@for (kv of contextPairs(); track kv.key) { <span>{{ nice(kv.key) }}</span><span>{{ kv.value }}</span> }</div>
              </div>
            }
          </div>

          <div class="col-stack">
            @if (callId()) {
              <div class="card analysis-card">
                <div class="card-head"><span class="card-title"><app-icon name="volume" [size]="14"></app-icon> Recording</span></div>
                <div class="card-body" style="padding: 14px 16px"><app-recording [streamSid]="callId()" [recordingUrl]="call()?.recording_url || ''"></app-recording></div>
              </div>

              <div class="card analysis-card">
                <div class="card-head">
                  <span class="card-title"><app-icon name="fileText" [size]="14"></app-icon> Summary and next steps</span>
                  @if (analysis()?.priority) { <span [class]="'priority-pill ' + analysis().priority.toLowerCase()">{{ analysis().priority }} priority</span> }
                </div>
                <div class="card-body" style="padding: 14px 16px">
                  <p class="summary-narrative">{{ analysis()?.executive_summary || call()?.summary || 'Summary is being prepared.' }}</p>
                  @if (analysis()?.action_items?.length) {
                    <ul class="action-items-list" style="margin-top: 10px">
                      @for (x of analysis().action_items; track $index) { <li><span class="bullet-dot"></span><span>{{ x }}</span></li> }
                    </ul>
                  }
                </div>
              </div>

              <div class="card analysis-card">
                <div class="card-head">
                  <span class="card-title"><app-icon name="message" [size]="14"></app-icon> Transcript ({{ messages().length }} turns)</span>
                  <button class="btn btn-sm" (click)="copyTranscript()"><app-icon name="copy" [size]="12"></app-icon> {{ copied() ? 'Copied' : 'Copy' }}</button>
                </div>
                <div class="transcript-chat-container cp-turns">
                  @if (!messages().length) {
                    <div class="empty-sub" style="padding: 16px">No words were spoken on this call.</div>
                  } @else {
                    <div class="chat-flow">
                      @for (m of messages(); track $index) {
                        @if (m.speaker === 'tool') {
                          <div class="chat-tool-row"><div class="chat-tool-pill"><app-icon name="sliders" [size]="11"></app-icon><span class="tool-name mono">{{ m.tool === 'submit_call_outputs' ? 'Answers sent' : m.tool }}</span></div></div>
                        } @else {
                          <div [class]="'chat-msg-row ' + (m.speaker === 'agent' ? 'agent-side' : 'customer-side')">
                            <div class="chat-msg-meta"><span class="speaker-name-text">{{ m.speaker === 'agent' ? agentLabel() : 'Caller' }}</span><span class="chat-time mono">{{ offset(m.ts) }}</span></div>
                            <div [class]="'chat-bubble ' + (m.speaker === 'agent' ? 'agent-bubble' : 'customer-bubble')">{{ m.text }}</div>
                          </div>
                        }
                      }
                    </div>
                  }
                </div>
              </div>
            } @else {
              <div class="card analysis-card">
                <div class="empty" style="padding: 28px 16px">
                  <div class="empty-icon"><app-icon name="phoneOff" [size]="18"></app-icon></div>
                  <div class="empty-title">No recording or transcript</div>
                  <div class="empty-sub">{{ ov().group === 'in_progress' ? 'This contact has not been reached yet.' : 'Nobody picked up, so nothing was recorded.' }}</div>
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .analysis-page { max-width: 1500px; margin: 0 auto; width: 100%; }
    .analysis-nav-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
    .crumbs { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 13px; color: var(--muted); min-width: 0; }
    .crumbs a { color: var(--muted); } .crumbs a:hover { color: var(--ink); text-decoration: underline; }
    .crumbs b { color: var(--ink); font-size: 15px; }
    .analysis-nav-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .col-stack { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .analysis-card { overflow: hidden; margin: 0; }
    .summary-narrative { font-size: 13.5px; line-height: 1.6; color: var(--ink-2); margin: 0; }
    .action-items-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--ink-2); }
    .action-items-list li { display: flex; gap: 10px; }
    .bullet-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--red); margin-top: 7px; flex-shrink: 0; }
    .priority-pill { font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
    .priority-pill.low { color: var(--green-ink); background: var(--green-wash); }
    .priority-pill.medium { color: var(--amber); background: #fef3c7; }
    .priority-pill.high { color: var(--red-hover); background: var(--red-wash); }
    .cp-rows td, .cp-rows th { font-size: 12px; padding: 6px 8px; white-space: nowrap; vertical-align: top; }
    .cp-ans { background: var(--raised); }
    .transcript-chat-container { padding: 14px; background: var(--bg); }
  `],
})
export class CallAnalysisComponent implements OnInit {
  api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  cid = signal('');
  pid = signal('');
  callId = signal('');
  contact = signal<any>(null);
  call = signal<any>(null);
  analysis = signal<any>(null);
  loading = signal(true);
  error = signal('');
  copied = signal(false);

  fmtTime = fmtTime;
  fmtSecs = fmtSecs;
  outcomeView = outcomeView;

  ov = computed(() => outcomeView(this.contact()?.outcome || (this.call() ? (this.call().num_turns ? 'completed' : 'no_reply') : '')));
  gv = computed(() => goalView(this.contact()?.goal));
  title = computed(() => this.contact()?.contact?.name || this.call()?.contact_name || this.contact()?.contact?.phone || this.call()?.phone || 'Call');
  talkSeconds = computed(() => this.contact()?.timing?.talk_seconds ?? this.call()?.duration_seconds ?? 0);
  sentence = computed(() => {
    const c = this.contact();
    const last = c?.attempt_log?.[c.attempt_log.length - 1];
    if (last) {
      const s = dialSentence(last);
      return c.attempts > 1 ? `${s}. ${c.attempts} dials in all.` : s;
    }
    if (this.ov().group === 'in_progress') return this.ov().help;
    return this.call() ? `Talked ${fmtSecs(this.call().duration_seconds)}` : this.ov().help;
  });
  nextTry = computed(() => (this.contact()?.next_attempt_at ? this.clock(this.contact().next_attempt_at) : ''));
  outputs = computed<Record<string, any>>(() => this.contact()?.outputs || this.call()?.outputs || this.extracted());
  answerPairs = computed(() => Object.entries(this.outputs() || {})
    .filter(([, v]) => !Array.isArray(v))
    .map(([key, v]) => ({ key: this.nice(key), value: this.show(v) })));
  answerCols = computed(() => {
    const rows = this.contact()?.rows || [];
    return (this.contact()?.answer_fields || []).filter((f: string) => f !== 'row' && rows.some((r: any) => !this.blank(r.answer?.[f])));
  });
  contextPairs = computed(() => {
    const ctx = this.contact()?.context || this.call()?.context || {};
    return Object.entries(ctx).filter(([k, v]) => !['rows', 'row_count'].includes(k) && !this.blank(v)).map(([key, v]) => ({ key, value: String(v) }));
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      this.cid.set(p.get('cid') || '');
      this.pid.set(p.get('pid') || '');
      this.load(p.get('id') || '');
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
    if (e.key === 'j' && this.contact()?.next) this.go(this.contact().next);
    if (e.key === 'k' && this.contact()?.prev) this.go(this.contact().prev);
  }

  async load(id: string): Promise<void> {
    this.loading.set(true); this.error.set(''); this.call.set(null); this.analysis.set(null); this.contact.set(null);
    try {
      if (this.cid()) {
        const d = await this.api.campaignContactDetail(this.cid(), this.pid());
        this.contact.set(d);
        id = d.call_id || '';
      }
      this.callId.set(id);
      if (id) {
        const c = await this.api.call(id);
        // A campaign call opens in its campaign context: rows, every dial, previous and next.
        if (!this.cid() && c.contact_ref) {
          this.router.navigate(['/campaigns', c.contact_ref.campaign_id, 'contacts', c.contact_ref.primary_id], { replaceUrl: true });
          return;
        }
        this.call.set(c);
        this.analysis.set(c.analysis || null);
      }
    } catch (e: any) {
      this.error.set(e.message || 'Could not load this call.');
    } finally { this.loading.set(false); }
  }

  go(pid: string): void { this.router.navigate(['/campaigns', this.cid(), 'contacts', pid]); }


  agentLabel(): string {
    const l = this.contact()?.campaign?.agent_label;
    if (l) return l.split(' ')[0];
    const key = this.call()?.agent || '';
    return key ? key.replace(/_/g, ' ').replace(/\b\w/g, (x: string) => x.toUpperCase()) : 'Agent';
  }
  private extracted(): Record<string, any> {
    const t = [...(this.call()?.events || [])].reverse().find((e: any) => e.kind === 'TOOL_CALL' && e.tool === 'submit_call_outputs');
    return t?.args || {};
  }
  messages() {
    return (this.call()?.events || [])
      .filter((e: any) => ['USER_TURN', 'AGENT_TURN', 'TOOL_CALL'].includes(e.kind))
      .map((e: any) => e.kind === 'TOOL_CALL' ? { speaker: 'tool', text: '', ts: e.ts, tool: e.tool } : { speaker: e.kind === 'AGENT_TURN' ? 'agent' : 'customer', text: e.text || '', ts: e.ts });
  }
  offset(ts: string): string {
    const t0 = this.call()?.started_at ? Date.parse(this.call().started_at) : 0;
    if (!t0 || !ts) return '--:--';
    const s = Math.max(0, Math.round((Date.parse(ts) - t0) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  copyTranscript(): void {
    const text = this.messages().filter((m: any) => m.speaker !== 'tool').map((m: any) => `[${this.offset(m.ts)}] ${m.speaker === 'agent' ? this.agentLabel() : 'Caller'}: ${m.text}`).join('\n');
    navigator.clipboard?.writeText(text);
    this.copied.set(true); setTimeout(() => this.copied.set(false), 1600);
  }
  exportRecord(): void {
    const blob = new Blob([JSON.stringify({ contact: this.contact(), call: this.call(), analysis: this.analysis() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `call-${this.callId() || this.pid() || 'record'}.json`; a.click();
    URL.revokeObjectURL(url);
  }
  endedBy(v: string): string { return v === 'caller' ? 'Caller' : v === 'agent' ? 'Agent' : v === 'network' ? 'Network' : '—'; }
  raw(p: any): string { return Object.entries(p || {}).filter(([, x]) => x !== '').map(([k, x]) => `${k}: ${x}`).join('\n'); }
  nice(k: string): string { return String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
  blank(v: any): boolean { return v === null || v === undefined || v === ''; }
  show(v: any): string { return v === true ? 'Yes' : v === false ? 'No' : this.blank(v) ? '—' : String(v).replace(/_/g, ' '); }
  clock(ts: string): string { return ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : ''; }
}
