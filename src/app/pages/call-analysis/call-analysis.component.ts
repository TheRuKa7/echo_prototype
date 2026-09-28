import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { RecordingComponent } from '../call-console/recording.component';
import { fmtTime } from '../../utils/format';
import { FmtDurationPipe } from '../../pipes/fmt-duration.pipe';
import { FmtNumPipe } from '../../pipes/fmt-num.pipe';

interface ChatMessage {
  speaker: 'agent' | 'customer' | 'tool';
  text: string;
  ts: string;
  tool?: string;
}

/**
 * The full-page counterpart to the call drawer: one call, everything known
 * about it. `analysis` is a separate, optional record — a call that hasn't
 * been analysed yet (or predates this feature) simply has none, and every
 * analysis-derived field on this page renders blank rather than guessing.
 * Re-analyze is what fills it in, for old and new calls alike.
 */
@Component({
  selector: 'app-call-analysis',
  standalone: true,
  imports: [RouterLink, IconComponent, RecordingComponent, FmtDurationPipe, FmtNumPipe],
  template: `
    <div class="page analysis-page">
      <div class="analysis-nav-bar">
        <div class="analysis-nav-left">
          <a [routerLink]="backLink()" class="back-link">
            <app-icon name="back" [size]="14"></app-icon>
            <span>{{ backLabel() }}</span>
          </a>
          <div class="call-title-group">
            <div class="call-icon-badge"><app-icon name="phone" [size]="15"></app-icon></div>
            <h1 class="call-heading">{{ call()?.contact_name || call()?.agent || 'Call' }}</h1>
            <span class="call-id-pill mono" (click)="copyCallId()" title="Click to copy call ID">
              {{ callId() }}
              <app-icon name="copy" [size]="11"></app-icon>
            </span>
            @if (copiedId()) { <span class="copy-toast">Copied</span> }
          </div>
        </div>
        <div class="analysis-nav-actions">
          <button class="btn btn-sm" (click)="reanalyze()" [disabled]="reanalyzing() || !call()?.num_turns" title="Run AI analysis on this call's transcript">
            <app-icon name="activity" [size]="13" [class.spin]="reanalyzing()"></app-icon>
            {{ reanalyzing() ? 'Analyzing…' : (analysis() ? 'Re-analyze' : 'Analyze') }}
          </button>
          <button class="btn btn-sm" (click)="exportCallReport()" title="Export the raw call record as JSON">
            <app-icon name="download" [size]="13"></app-icon> Export JSON
          </button>
        </div>
      </div>

      @if (reanalyzeError()) {
        <div class="note bad">{{ reanalyzeError() }}</div>
      }

      @if (loading()) {
        <div class="empty"><div class="empty-title">Loading call…</div></div>
      } @else if (error()) {
        <div class="note bad">{{ error() }}</div>
      } @else {
        <div class="kpi-strip card">
          <div class="kpi-item">
            <span class="kpi-label"><app-icon name="clock" [size]="12"></app-icon> Duration</span>
            <span class="kpi-val mono">{{ call()?.duration_seconds | fmtDuration }}</span>
          </div>
          <div class="kpi-divider"></div>
          <div class="kpi-item">
            <span class="kpi-label"><app-icon name="activity" [size]="12"></app-icon> Priority</span>
            <span class="kpi-val">
              @if (analysis()?.priority) {
                <span [class]="'priority-pill ' + analysis().priority.toLowerCase()">{{ analysis().priority }}</span>
              } @else { <span class="kpi-blank">Not analyzed</span> }
            </span>
          </div>
          <div class="kpi-divider"></div>
          <div class="kpi-item">
            <span class="kpi-label"><app-icon name="check" [size]="12"></app-icon> Issue resolved</span>
            <span class="kpi-val">
              @if (analysis()?.issue_resolved === true) { <span class="tag ok">Yes</span> }
              @else if (analysis()?.issue_resolved === false) { <span class="tag bad">No</span> }
              @else { <span class="kpi-blank">—</span> }
            </span>
          </div>
          <div class="kpi-divider"></div>
          <div class="kpi-item">
            <span class="kpi-label"><app-icon name="bot" [size]="12"></app-icon> Agent</span>
            <span class="kpi-val" style="font-weight: 600">{{ agentLabel() }}</span>
          </div>
          <div class="kpi-divider"></div>
          <div class="kpi-item">
            <span class="kpi-label"><app-icon name="user" [size]="12"></app-icon> Contact</span>
            <span class="kpi-val mono" style="font-weight: 600; color: var(--ink-2)">{{ call()?.contact_name || call()?.phone || '—' }}</span>
          </div>
          <div class="kpi-divider"></div>
          <div class="kpi-item">
            <span class="kpi-label"><app-icon name="calendar" [size]="12"></app-icon> Call time</span>
            <span class="kpi-val mono" style="font-size: 12px; color: var(--muted)">{{ fmtTime(call()?.started_at) }}</span>
          </div>
        </div>

        <div class="analysis-three-column-grid">
          <div class="col-stack">
            <div class="card analysis-card">
              <div class="card-head">
                <span class="card-title"><app-icon name="fileText" [size]="14"></app-icon> Executive summary</span>
                @if (analysis()) { <span class="chip key" style="font-size: 10px">AI SYNTHESIZED</span> }
              </div>
              <div class="card-body" style="padding: 16px">
                @if (analysis()?.executive_summary) {
                  <p class="summary-narrative">{{ analysis().executive_summary }}</p>
                } @else if (call()?.summary && call()?.summary !== '—') {
                  <p class="summary-narrative">{{ call()?.summary }}</p>
                  <p class="card-hint" style="margin-top: 8px">From the agent's reported outcome — run analysis for a fuller summary.</p>
                } @else {
                  <div class="empty-sub">Not analyzed yet. Click {{ analysis() ? 'Re-analyze' : 'Analyze' }} above.</div>
                }
              </div>
            </div>

            <div class="card analysis-card">
              <div class="card-head">
                <span class="card-title"><app-icon name="database" [size]="14"></app-icon> Call context</span>
                <span class="mono" style="font-size: 11px; color: var(--faint)">{{ contextItems().length }} fields</span>
              </div>
              <div class="context-table">
                @if (analysis()?.call_purpose) {
                  <div class="context-row"><span class="context-k">Purpose</span><span class="context-v">{{ analysis().call_purpose }}</span></div>
                }
                @if (analysis()?.issue_category) {
                  <div class="context-row"><span class="context-k">Category</span><span class="context-v"><span class="tag ok">{{ analysis().issue_category }}</span></span></div>
                }
                @if (analysis()?.suggested_issue) {
                  <div class="context-row"><span class="context-k">Issue raised</span><span class="context-v">{{ analysis().suggested_issue }}</span></div>
                }
                @for (item of contextItems(); track item.key) {
                  <div class="context-row"><span class="context-k">{{ item.label }}</span><span class="context-v mono">{{ item.value }}</span></div>
                }
                @if (!contextItems().length && !analysis()) {
                  <div class="empty-sub" style="padding: 12px 16px">No input context recorded for this call.</div>
                }
              </div>
            </div>

            <div class="card analysis-card">
              <div class="card-head">
                <span class="card-title"><app-icon name="check" [size]="14"></app-icon> Action items</span>
              </div>
              <div class="card-body" style="padding: 14px 16px">
                @if (analysis()?.action_items?.length) {
                  <ul class="action-items-list">
                    @for (action of analysis().action_items; track $index) {
                      <li><span class="bullet-dot"></span><span class="action-text">{{ action }}</span></li>
                    }
                  </ul>
                } @else {
                  <div class="empty-sub">{{ analysis() ? 'None suggested.' : 'Not analyzed yet.' }}</div>
                }
              </div>
            </div>
          </div>

          <div class="col-stack">
            <div class="card analysis-card">
              <div class="card-head">
                <span class="card-title"><app-icon name="sliders" [size]="14"></app-icon> Technical details</span>
                <span class="mono" style="font-size: 10.5px; color: var(--faint)">{{ (call()?.source || '').toUpperCase() }}</span>
              </div>
              <div class="tech-matrix">
                @if (call()?.campaign_name) {
                  <div class="tech-row"><span class="tech-k">Campaign</span><span class="tech-v" style="font-weight: 600">{{ call().campaign_name }}</span></div>
                }
                <div class="tech-row"><span class="tech-k">Provider</span><span class="tech-v mono">{{ call()?.provider || '—' }}</span></div>
                @if (call()?.called_number) {
                  <div class="tech-row"><span class="tech-k">DID dialled</span><span class="tech-v mono">{{ call().called_number }}</span></div>
                }
                <div class="tech-row"><span class="tech-k">Phone</span><span class="tech-v mono">{{ call()?.phone || '—' }}</span></div>
                <div class="tech-row"><span class="tech-k">Status</span><span class="tech-v"><span class="tag ok">{{ call()?.status || '—' }}</span></span></div>
                @if (call()?.disconnect_reason) {
                  <div class="tech-row"><span class="tech-k">Hangup reason</span><span class="tech-v mono">{{ call().disconnect_reason }}</span></div>
                }
                <div class="tech-row"><span class="tech-k">Agent key</span><span class="tech-v mono" style="font-size: 11px">{{ call()?.agent || '—' }}</span></div>
                <div class="tech-row"><span class="tech-k">Started</span><span class="tech-v mono">{{ fmtTime(call()?.started_at) }}</span></div>
                <div class="tech-row"><span class="tech-k">Ended</span><span class="tech-v mono">{{ fmtTime(call()?.ended_at) }}</span></div>
                <div class="tech-row"><span class="tech-k">Duration</span><span class="tech-v mono" style="font-weight: 600">{{ call()?.duration_seconds | fmtDuration }}</span></div>
                <div class="tech-row"><span class="tech-k">Turns</span><span class="tech-v mono">{{ call()?.num_turns ?? 0 }}</span></div>
                <div class="tech-row"><span class="tech-k">Total tokens</span><span class="tech-v mono">{{ call()?.total_tokens | fmtNum }}</span></div>
                @if (analysis()?.analyzed_at) {
                  <div class="tech-row"><span class="tech-k">Last analyzed</span><span class="tech-v mono">{{ fmtTime(analysis().analyzed_at) }}</span></div>
                }
              </div>
            </div>

            @if (hasOutputs()) {
              <div class="card analysis-card">
                <div class="card-head">
                  <span class="card-title"><app-icon name="check" [size]="14"></app-icon> Reported outcome</span>
                </div>
                <div class="context-table">
                  @for (kv of outputPairs(); track kv.key) {
                    <div class="context-row"><span class="context-k">{{ kv.key }}</span><span class="context-v">{{ kv.value }}</span></div>
                  }
                </div>
              </div>
            }
          </div>

          <div class="col-stack">
            <div class="card analysis-card">
              <div class="card-head">
                <span class="card-title"><app-icon name="volume" [size]="14"></app-icon> Call recording</span>
              </div>
              <div class="card-body" style="padding: 14px 16px">
                <app-recording [streamSid]="callId()" [recordingUrl]="call()?.recording_url || ''"></app-recording>
              </div>
            </div>

            <div class="card analysis-card transcript-card">
              <div class="card-head">
                <span class="card-title"><app-icon name="message" [size]="14"></app-icon> Transcript ({{ messages().length }} turns)</span>
                <div style="display: flex; gap: 6px">
                  <button class="btn btn-sm" (click)="copyTranscript()">
                    <app-icon name="copy" [size]="12"></app-icon> {{ copiedTranscript() ? 'Copied!' : 'Copy' }}
                  </button>
                  <button class="btn btn-sm" (click)="downloadTxt()">
                    <app-icon name="download" [size]="12"></app-icon> .txt
                  </button>
                </div>
              </div>
              <div class="transcript-chat-container">
                @if (messages().length === 0) {
                  <div class="empty" style="padding: 32px 16px"><div class="empty-sub">No dialogue turns recorded for this call.</div></div>
                } @else {
                  <div class="chat-flow">
                    @for (msg of messages(); track $index) {
                      @if (msg.speaker === 'tool') {
                        <div class="chat-tool-row">
                          <div class="chat-tool-pill">
                            <app-icon name="sliders" [size]="11"></app-icon>
                            <span class="tool-name mono">{{ msg.tool }}()</span>
                            <span class="tool-status">Executed</span>
                          </div>
                        </div>
                      } @else {
                        <div [class]="'chat-msg-row ' + (msg.speaker === 'agent' ? 'agent-side' : 'customer-side')">
                          <div class="chat-msg-meta">
                            <div class="speaker-label">
                              <app-icon [name]="msg.speaker === 'agent' ? 'bot' : 'user'" [size]="12"></app-icon>
                              <span class="speaker-name-text">{{ msg.speaker === 'agent' ? agentLabel() : (call()?.contact_name || 'Caller') }}</span>
                            </div>
                            <span class="chat-time mono">{{ offset(msg.ts) }}</span>
                          </div>
                          <div [class]="'chat-bubble ' + (msg.speaker === 'agent' ? 'agent-bubble' : 'customer-bubble')">{{ msg.text }}</div>
                        </div>
                      }
                    }
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .analysis-page { max-width: 1600px; margin: 0 auto; width: 100%; }
    .analysis-nav-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
    .analysis-nav-left { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .back-link { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--ink-3); padding: 5px 10px; background: var(--raised); border: 1px solid var(--line); border-radius: 6px; }
    .call-title-group { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .call-icon-badge { width: 32px; height: 32px; border-radius: 8px; background: var(--red-wash); color: var(--red); border: 1px solid var(--red-wash-line); display: flex; align-items: center; justify-content: center; }
    .call-heading { font-size: 18px; font-weight: 700; color: var(--ink); margin: 0; }
    .call-id-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; background: var(--raised); color: var(--ink-3); border: 1px solid var(--line); border-radius: 6px; font-size: 11.5px; cursor: pointer; }
    .copy-toast { font-size: 11px; font-weight: 600; color: var(--green-ink); background: var(--green-wash); padding: 2px 6px; border-radius: 4px; }
    .analysis-nav-actions { display: flex; align-items: center; gap: 8px; }
    .kpi-strip { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 14px 20px; gap: 12px; margin-top: 16px; }
    .kpi-item { display: flex; flex-direction: column; gap: 4px; min-width: 110px; }
    .kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); display: flex; align-items: center; gap: 5px; }
    .kpi-val { font-size: 14px; font-weight: 500; color: var(--ink); }
    .kpi-blank { color: var(--faint); font-weight: 400; }
    .kpi-divider { width: 1px; height: 32px; background: var(--line); }
    .priority-pill { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
    .priority-pill.low { color: var(--green-ink); background: var(--green-wash); }
    .priority-pill.medium { color: var(--amber); background: #fef3c7; }
    .priority-pill.high { color: var(--red-hover); background: var(--red-wash); }
    .analysis-three-column-grid { display: grid; grid-template-columns: 1.15fr 0.95fr 1.35fr; gap: 16px; align-items: start; margin-top: 16px; }
    @media (max-width: 1200px) { .analysis-three-column-grid { grid-template-columns: 1fr; } .kpi-divider { display: none; } }
    .col-stack { display: flex; flex-direction: column; gap: 16px; }
    .analysis-card { overflow: hidden; }
    .summary-narrative { font-size: 13.5px; line-height: 1.65; color: var(--ink-2); margin: 0; }
    .context-table { display: flex; flex-direction: column; }
    .context-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line-soft); font-size: 12.5px; }
    .context-row:last-child { border-bottom: none; }
    .context-k { color: var(--muted); font-weight: 500; min-width: 110px; }
    .context-v { color: var(--ink); font-weight: 500; text-align: right; }
    .action-items-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .action-items-list li { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.5; color: var(--ink-2); }
    .bullet-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--red); margin-top: 7px; flex-shrink: 0; }
    .tech-matrix { display: flex; flex-direction: column; }
    .tech-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; border-bottom: 1px solid var(--line-soft); font-size: 12px; }
    .tech-row:last-child { border-bottom: none; }
    .tech-k { color: var(--muted); font-weight: 500; }
    .tech-v { color: var(--ink); text-align: right; }
    .transcript-card { display: flex; flex-direction: column; }
    .transcript-chat-container { max-height: 640px; overflow-y: auto; padding: 16px; background: var(--bg); }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `],
})
export class CallAnalysisComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  callId = signal('');
  /** Where "Analysis →" was clicked from — carried in the query string so
   * this page can return there instead of always landing on Overview. */
  fromCampaignId = signal('');
  backLink = computed(() => (this.fromCampaignId() ? ['/campaigns', this.fromCampaignId()] : ['/overview']));
  backLabel = computed(() => (this.fromCampaignId() ? 'Back to campaign' : 'Back to calls'));
  call = signal<any>(null);
  analysis = signal<any>(null);
  loading = signal(true);
  error = signal('');
  reanalyzing = signal(false);
  reanalyzeError = signal('');
  copiedId = signal(false);
  copiedTranscript = signal(false);

  fmtTime = fmtTime;

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((qp) => {
      this.fromCampaignId.set(qp.get('from') === 'campaign' ? qp.get('campaignId') || '' : '');
    });
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id') || '';
      if (id) {
        this.callId.set(id);
        this.load(id);
      } else {
        this.error.set('No call ID in the route.');
        this.loading.set(false);
      }
    });
  }

  async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.api.call(id);
      this.call.set(data);
      this.analysis.set(data.analysis || null);
    } catch (e: any) {
      this.error.set(e.message || 'Could not load this call.');
    } finally {
      this.loading.set(false);
    }
  }

  async reanalyze(): Promise<void> {
    this.reanalyzing.set(true);
    this.reanalyzeError.set('');
    try {
      const result = await this.api.analyzeCall(this.callId());
      this.analysis.set(result);
    } catch (e: any) {
      this.reanalyzeError.set(e.message || 'Analysis failed.');
    } finally {
      this.reanalyzing.set(false);
    }
  }

  copyCallId(): void {
    navigator.clipboard?.writeText(this.callId());
    this.copiedId.set(true);
    setTimeout(() => this.copiedId.set(false), 2000);
  }

  /** The agent's own key, formatted — the only agent-identity field this call
   * actually stores. No character name is invented for it. */
  agentLabel(): string {
    const key = this.call()?.agent || '';
    if (!key) return 'Agent';
    return key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
  }

  contextItems(): { key: string; label: string; value: string }[] {
    const ctx = this.call()?.context || {};
    const skip = new Set(['contact_name', 'contact_phone']);
    return Object.entries(ctx)
      .filter(([k, v]) => !skip.has(k) && v !== null && v !== undefined && v !== '')
      .map(([k, v]) => ({
        key: k,
        label: k.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        value: String(v),
      }));
  }

  /** submit_call_outputs args — the call doc carries this in `events` only. */
  private extractedOutputs(): Record<string, any> {
    const events = this.call()?.events || [];
    const call = [...events].reverse().find((e: any) => e.kind === 'TOOL_CALL' && e.tool === 'submit_call_outputs');
    return call?.args || {};
  }

  hasOutputs(): boolean {
    return Object.keys(this.extractedOutputs()).length > 0;
  }

  outputPairs(): { key: string; value: string }[] {
    return Object.entries(this.extractedOutputs()).map(([key, value]) => ({
      key,
      value: value === null || value === undefined || value === '' ? '—' : String(value),
    }));
  }

  private t0(): number | null {
    const s = this.call()?.started_at;
    return s ? new Date(s).getTime() : null;
  }

  offset(ts: string): string {
    const t0 = this.t0();
    if (!t0 || !ts) return '--:--';
    const s = Math.max(0, Math.round((new Date(ts).getTime() - t0) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  messages(): ChatMessage[] {
    const events = this.call()?.events || [];
    return events
      .filter((e: any) => ['USER_TURN', 'AGENT_TURN', 'TOOL_CALL'].includes(e.kind))
      .map((e: any): ChatMessage => {
        if (e.kind === 'TOOL_CALL') return { speaker: 'tool', text: '', ts: e.ts, tool: e.tool };
        return { speaker: e.kind === 'AGENT_TURN' ? 'agent' : 'customer', text: e.text || '', ts: e.ts };
      });
  }

  copyTranscript(): void {
    const text = this.messages()
      .filter((m) => m.speaker !== 'tool')
      .map((m) => `${m.speaker === 'agent' ? this.agentLabel() : (this.call()?.contact_name || 'Caller')} [${this.offset(m.ts)}]: ${m.text}`)
      .join('\n\n');
    navigator.clipboard?.writeText(text);
    this.copiedTranscript.set(true);
    setTimeout(() => this.copiedTranscript.set(false), 2000);
  }

  downloadTxt(): void {
    const text = this.messages()
      .filter((m) => m.speaker !== 'tool')
      .map((m) => `${m.speaker === 'agent' ? this.agentLabel() : (this.call()?.contact_name || 'Caller')} [${this.offset(m.ts)}]: ${m.text}`)
      .join('\r\n\r\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${this.callId()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportCallReport(): void {
    const data = JSON.stringify({ ...this.call(), analysis: this.analysis() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-${this.callId()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
