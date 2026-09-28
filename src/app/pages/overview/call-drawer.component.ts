import { Component, Input, Output, EventEmitter, inject, signal, computed, OnChanges, HostListener } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { RecordingComponent } from '../call-console/recording.component';
import { fmtDuration, fmtTime } from '../../utils/format';

/**
 * One call, opened beside the log rather than inside it.
 *
 * The transcript used to expand in-flow between two table rows, which pushed
 * everything below it down the page and made a long call a scroll away from the
 * row it belonged to. A drawer keeps the list still and the call in view.
 *
 * Everything here comes from one GET /api/calls/{id}. Two of the four sections
 * are derived rather than served:
 *
 *   recording — call_id *is* the stream_sid, so the recording endpoints take it
 *               directly and RecordingComponent handles playback + download.
 *   outputs   — the agent reports via the `submit_call_outputs` tool, so the
 *               arguments of that TOOL_CALL event are the captured variables.
 *
 * Inputs are shown only when the backend logs a CALL_CONTEXT event; the call
 * document does not otherwise carry the context the agent was started with.
 */
@Component({
  selector: 'app-call-drawer',
  standalone: true,
  imports: [IconComponent, RecordingComponent, RouterLink],
  template: `
    <div class="drawer-backdrop" (click)="close.emit()"></div>
    <aside class="drawer" role="dialog" aria-label="Call detail">
      <header class="drawer-head">
        <div style="min-width: 0">
          <div class="drawer-title">{{ call?.contact_name || call?.agent || 'Call' }}</div>
          <div class="drawer-sub mono">{{ callId }}</div>
        </div>
        <div style="display: flex; gap: 8px; flex-shrink: 0">
          <a class="btn btn-sm btn-primary" [routerLink]="['/calls', callId]" (click)="close.emit()" title="Open the full call analysis page">
            <app-icon name="activity" [size]="12"></app-icon> Full Analysis &rarr;
          </a>
          <button class="btn btn-sm" (click)="close.emit()" aria-label="Close">
            <app-icon name="close" [size]="13"></app-icon>
          </button>
        </div>
      </header>

      @if (error()) {
        <div class="drawer-body"><div class="note bad">Could not load this call: {{ error() }}</div></div>
      } @else if (!detail()) {
        <div class="drawer-body"><div class="empty empty-sub">Loading call…</div></div>
      } @else {
        <div class="drawer-meta">
          <div><span class="drawer-meta-k">Started</span><span class="drawer-meta-v">{{ fmtTime(call.started_at) }}</span></div>
          <div><span class="drawer-meta-k">Length</span><span class="drawer-meta-v mono">{{ fmtDuration(call.duration_seconds) }}</span></div>
          <div><span class="drawer-meta-k">Turns</span><span class="drawer-meta-v mono">{{ call.num_turns ?? 0 }}</span></div>
          <div><span class="drawer-meta-k">Source</span><span class="drawer-meta-v">{{ call.source || '—' }}</span></div>
          <div><span class="drawer-meta-k">Mode</span><span class="drawer-meta-v">{{ call.mode || '—' }}</span></div>
        </div>

        <div class="drawer-body">
          <section class="drawer-section">
            <div class="drawer-section-head">
              <app-icon name="play" [size]="12"></app-icon> Recording
            </div>
            <div class="drawer-section-body">
              <app-recording [streamSid]="callId" [recordingUrl]="call.recording_url || ''"></app-recording>
            </div>
          </section>

          @if (inputs().length) {
            <section class="drawer-section">
              <div class="drawer-section-head">
                <app-icon name="upload" [size]="12"></app-icon> Input variables
              </div>
              <div class="drawer-section-body">
                <div class="kv-rows">
                  @for (v of inputs(); track v.key) {
                    <div class="kv-row"><span class="kv-k">{{ v.key }}</span><span class="kv-v">{{ v.value }}</span></div>
                  }
                </div>
              </div>
            </section>
          }

          <section class="drawer-section">
            <div class="drawer-section-head">
              <app-icon name="download" [size]="12"></app-icon> Output variables
            </div>
            <div class="drawer-section-body">
              @if (outputs().length) {
                <div class="kv-rows">
                  @for (v of outputs(); track v.key) {
                    <div class="kv-row"><span class="kv-k">{{ v.key }}</span><span class="kv-v">{{ v.value }}</span></div>
                  }
                </div>
              } @else {
                <div class="empty empty-sub" style="padding: 12px 0">
                  The agent did not report any outcome for this call.
                </div>
              }
            </div>
          </section>

          <section class="drawer-section">
            <div class="drawer-section-head">
              <app-icon name="message" [size]="12"></app-icon> Transcript
            </div>
            <div class="drawer-section-body">
              @if (turns().length === 0) {
                <div class="empty empty-sub" style="padding: 12px 0">No turns recorded for this call.</div>
              } @else {
                <div class="chat-flow">
                  @for (e of turns(); track $index) {
                    @if (e.kind === 'TOOL_CALL') {
                      <div class="chat-tool-row">
                        <div class="chat-tool-pill">
                          <app-icon name="sliders" [size]="11"></app-icon>
                          <span class="tool-name mono">{{ e.tool }}()</span>
                          <span class="tool-status">Executed</span>
                        </div>
                      </div>
                    } @else {
                      <div [class]="'chat-msg-row ' + (e.kind === 'AGENT_TURN' ? 'agent-side' : 'customer-side')">
                        <div class="chat-msg-meta">
                          <div class="speaker-label">
                            <app-icon [name]="e.kind === 'AGENT_TURN' ? 'bot' : 'user'" [size]="11"></app-icon>
                            <span class="speaker-name-text">{{ e.kind === 'AGENT_TURN' ? agentLabel() : (call?.contact_name || 'Caller') }}</span>
                          </div>
                          <span class="chat-time mono">{{ offset(e.ts) }}</span>
                        </div>
                        <div [class]="'chat-bubble ' + (e.kind === 'AGENT_TURN' ? 'agent-bubble' : 'customer-bubble')">{{ e.text }}</div>
                      </div>
                    }
                  }
                </div>
              }
            </div>
          </section>
        </div>

        <footer class="drawer-foot">
          <a class="btn btn-sm" [href]="recording.download" download>
            <app-icon name="download" [size]="13"></app-icon> Download audio
          </a>
          <button class="btn btn-sm" (click)="downloadTranscript()">
            <app-icon name="file" [size]="13"></app-icon> Download transcript
          </button>
        </footer>
      }
    </aside>
  `,
})
export class CallDrawerComponent implements OnChanges {
  @Input() callId = '';
  @Output() close = new EventEmitter<void>();

  private api = inject(ApiService);
  detail = signal<any>(null);
  error = signal('');
  fmtTime = fmtTime;
  fmtDuration = fmtDuration;
  recording: any = {};

  get call(): any {
    return this.detail() || {};
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close.emit();
  }

  /**
   * Keyed on callId rather than construction: clicking a second row while the
   * drawer is open reuses this instance, so loading from ngOnInit would leave
   * the previous call's transcript on screen under the new call's header.
   */
  async ngOnChanges(): Promise<void> {
    const id = this.callId;
    this.recording = this.api.recordingUrls(id);
    this.detail.set(null);
    this.error.set('');
    try {
      const doc = await this.api.call(id);
      if (this.callId === id) this.detail.set(doc); // a faster click won the race
    } catch (e: any) {
      if (this.callId === id) this.error.set(e.message);
    }
  }

  /** The agent's own key, formatted — no character name is invented for it. */
  agentLabel(): string {
    const key = this.call?.agent || '';
    if (!key) return 'Agent';
    return key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
  }

  private events = computed<any[]>(() => this.detail()?.events || []);

  turns = computed(() =>
    this.events().filter((e) => ['USER_TURN', 'AGENT_TURN', 'TOOL_CALL'].includes(e.kind)),
  );

  /** The arguments the agent passed to submit_call_outputs — its reported outcome. */
  outputs = computed(() => {
    const call = [...this.events()]
      .reverse()
      .find((e) => e.kind === 'TOOL_CALL' && e.tool === 'submit_call_outputs');
    return this.toPairs(call?.args);
  });

  /** Present only if the backend logged the call's starting context. */
  inputs = computed(() => {
    const ctx = this.events().find((e) => e.kind === 'CALL_CONTEXT');
    return this.toPairs(ctx?.context ?? this.detail()?.context);
  });

  private toPairs(obj: any): { key: string; value: string }[] {
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(obj).map(([key, value]) => ({
      key,
      value:
        value === null || value === undefined || value === ''
          ? '—'
          : typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value),
    }));
  }

  private t0(): number | null {
    const s = this.detail()?.started_at;
    return s ? new Date(s).getTime() : null;
  }

  offset(ts: string): string {
    const t0 = this.t0();
    if (!t0 || !ts) return '--:--';
    const s = Math.max(0, Math.round((new Date(ts).getTime() - t0) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  /** The transcript as a text file, built in the browser — no endpoint for it. */
  downloadTranscript(): void {
    const lines = this.turns().map((e) => {
      const who = e.kind === 'USER_TURN' ? 'caller' : e.kind === 'TOOL_CALL' ? 'tool' : 'agent';
      const text = e.kind === 'TOOL_CALL' ? `${e.tool}()` : e.text;
      return `[${this.offset(e.ts)}] ${who}: ${text}`;
    });
    const head = [
      `Call:    ${this.callId}`,
      `Agent:   ${this.call.agent || '—'}`,
      `Started: ${this.call.started_at || '—'}`,
      `Length:  ${fmtDuration(this.call.duration_seconds)}`,
      '',
    ];
    const out = this.outputs();
    const tail = out.length
      ? ['', 'Outputs:', ...out.map((v) => `  ${v.key}: ${v.value}`)]
      : [];
    const blob = new Blob([[...head, ...lines, ...tail].join('\n')], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.callId}-transcript.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
