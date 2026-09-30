import { resultLabel } from '../../utils/status';
import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { FmtNumPipe } from '../../pipes/fmt-num.pipe';
import { FmtDurationPipe } from '../../pipes/fmt-duration.pipe';
import { FmtTimePipe } from '../../pipes/fmt-time.pipe';
import { fmtNum, fmtDuration, fmtSecs } from '../../utils/format';
import { CallDrawerComponent } from './call-drawer.component';

/**
 * The dashboard: the campaign funnel on top, the call log underneath.
 *
 * The tiles answer "how is the whole operation doing" and the table answers
 * "what happened on this call". Several of the tiles are derived from what the
 * agent reported rather than measured directly, so each one carries a note
 * saying what it counted — a percentage with no stated denominator is a number
 * people act on without being able to check.
 */
@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    FmtNumPipe,
    FmtDurationPipe,
    FmtTimePipe,
    CallDrawerComponent,
  ],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Overview</h1>
          <p class="page-sub">
            Calls placed by the agent, newest first. Live calls appear while they run.
          </p>
        </div>
        <div class="page-actions">
          @if (metrics()?.active_calls > 0) {
            <span class="pill live">
              <span class="dot live"></span>
              {{ metrics().active_calls }} on the line
            </span>
          }
          <!-- Built from the same params as the table, so it downloads what is
               on screen rather than the unfiltered history. -->
          <a
            class="btn"
            [href]="api.callsReportUrl(query())"
            download
            [class.disabled]="!calls().length"
            title="Download the filtered call log as a spreadsheet"
          >
            <app-icon name="download" [size]="13"></app-icon> Report
          </a>
        </div>
      </div>

      @if (error()) {
        <div class="note bad">{{ error() }}</div>
      }

      @if (!storage()) {
        <div class="note bad">
          Call history is not being saved right now. Live calls still work.
        </div>
      }

      <div class="tiles">
        @for (s of stats(); track s.label) {
          <div class="tile">
            <span class="tile-label">{{ s.label }}</span>
            <span [class]="'tile-value' + (s.on ? ' on' : '')">{{ s.value }}</span>
            <span class="tile-note">{{ s.note }}</span>
          </div>
        }
      </div>

      <div class="card" style="margin-top: 12px">
        <div class="card-head">
          <span class="card-title">
            <app-icon name="activity" [size]="14"></app-icon>
            Call log
          </span>
          <span class="card-hint">Select a call to open it</span>
        </div>

        <div class="filters">
          <input
            class="input filter-search"
            type="search"
            placeholder="Search number…"
            [ngModel]="search()"
            (ngModelChange)="onSearch($event)"
          />
          <select class="select" [ngModel]="campaign()" (ngModelChange)="setFilter('campaign', $event)">
            <option value="">All campaigns</option>
            @for (c of campaigns(); track c.campaign_id) {
              <option [value]="c.campaign_id">{{ c.name }}</option>
            }
          </select>
          <select class="select" [ngModel]="duration()" (ngModelChange)="setFilter('duration', $event)">
            @for (d of DURATIONS; track d.key) {
              <option [value]="d.key">{{ d.label }}</option>
            }
          </select>
          <select class="select" [ngModel]="range()" (ngModelChange)="setFilter('range', $event)">
            @for (r of RANGES; track r.key) {
              <option [value]="r.key">{{ r.label }}</option>
            }
          </select>
          @if (filtered()) {
            <button class="btn btn-sm" (click)="clearFilters()">
              <app-icon name="close" [size]="12"></app-icon> Clear
            </button>
            <span class="filter-count">{{ total() }} matching</span>
          }
        </div>

        @if (calls().length === 0) {
          <div class="empty">
            <div class="empty-icon"><app-icon name="botSimple" [size]="18" [strokeWidth]="1.8"></app-icon></div>
            @if (filtered()) {
              <div class="empty-title">No calls match these filters</div>
              <div class="empty-sub">Widen the time range, or clear the filters to see everything.</div>
            } @else {
              <div class="empty-title">No calls yet</div>
              <div class="empty-sub">Start one from the call console, or upload contacts to a campaign.</div>
            }
          </div>
        } @else {
          @if (selected().size) {
            <div class="bulk-actions-toolbar" style="margin: 0 16px 10px">
              <div class="bulk-left">
                <span class="bulk-pill">{{ selected().size }} selected</span>
                @if (bulkStatus()) { <span class="bulk-sub">{{ bulkStatus() }}</span> }
              </div>
              <div class="bulk-btns">
                <button class="btn btn-sm" (click)="downloadSelectedCsv()">
                  <app-icon name="download" [size]="12"></app-icon> Export CSV
                </button>
                <button class="btn btn-sm" (click)="downloadSelectedAudio()">
                  <app-icon name="volume" [size]="12"></app-icon> Download audio
                </button>
                <button class="btn btn-sm" (click)="reanalyzeSelected()" [disabled]="bulkBusy()">
                  <app-icon name="activity" [size]="12"></app-icon> {{ bulkBusy() ? 'Analyzing…' : 'Re-analyze' }}
                </button>
                <button class="btn btn-sm" (click)="clearSelection()">Clear</button>
              </div>
            </div>
          }
          <div class="scroll-x">
            <div style="min-width: 1360px">
              <div class="grid-head" [style.grid-template-columns]="cols">
                <span class="row-check"><input type="checkbox" [checked]="allSelected()" (change)="toggleAll()" (click)="$event.stopPropagation()" /></span>
                <span>Time</span><span>Contact</span><span>Number</span><span>Agent</span>
                <span>Length</span><span>Status</span><span>Campaign</span><span>Turns</span>
                <span>Summary</span><span>Tokens</span><span></span>
              </div>
              @for (c of calls(); track c.call_id; let i = $index) {
                <div
                  [class]="'grid-row clickable' + (openId() === c.call_id ? ' open' : '') + (isSelected(c) ? ' selected-row' : '')"
                  [style.grid-template-columns]="cols"
                  [style.animation-delay]="(i < 12 ? i * 20 : 240) + 'ms'"
                  (click)="toggleOpen(c.call_id)"
                >
                  <span class="row-check"><input type="checkbox" [checked]="isSelected(c)" (change)="toggleOne(c)" (click)="$event.stopPropagation()" /></span>
                  <span class="mono" style="font-size: 11.5px; color: var(--faint)">{{ c.started_at | fmtTime }}</span>
                  <!-- A name resolved from the number rather than from the call's
                       own binding is marked, so "who we called" and "who owns
                       that number" are not shown as the same claim. -->
                  <span
                    class="cell-clip"
                    [style.color]="c.contact_name ? 'var(--ink-2)' : 'var(--ghost)'"
                    [title]="contactTitle(c)"
                  >{{ c.contact_name || '—' }}{{ c.contact_name_matched_by === 'phone' ? ' ·' : '' }}</span>
                  <span class="mono" style="font-size: 12px">{{ c.phone || '—' }}</span>
                  <span class="cell-clip" [title]="c.agent || ''">{{ agentLabel(c.agent) }}</span>
                  <span class="mono" style="font-size: 12px">{{ c.duration_seconds | fmtDuration }}</span>
                  <span><span [class]="'tag ' + statusClass(c)">{{ statusLabel(c) }}</span></span>
                  <span class="cell-clip" [title]="c.campaign_name || ''">{{ c.campaign_name || '—' }}</span>
                  <span class="mono" style="font-size: 12px">{{ c.num_turns ?? 0 }}</span>
                  <!-- Clamped to two lines so one verbose remark can't set the
                       height of every row, and expanded in place on click. The
                       value itself is never trimmed — see summarize() — so this
                       hides detail rather than destroying it. -->
                  <span
                    [class]="'cell-summary' + (summaryOpen(c.call_id) ? ' open' : '')"
                    [title]="c.summary || ''"
                    (click)="toggleSummary(c.call_id, $event)"
                  >{{ c.summary || '—' }}</span>
                  <span class="mono" style="font-size: 12px; color: var(--muted)">{{ c.total_tokens | fmtNum }}</span>
                  <span>
                    <a class="btn btn-sm btn-ghost" [routerLink]="['/calls', c.call_id]" (click)="$event.stopPropagation()" title="Open full call analysis">
                      Analysis &rarr;
                    </a>
                  </span>
                </div>
              }
            </div>
          </div>
        }
      </div>

      @if (openId()) {
        <app-call-drawer [callId]="openId()!" (close)="openId.set(null)"></app-call-drawer>
      }
    </div>
  `,
})
export class OverviewComponent implements OnInit, OnDestroy {
  api = inject(ApiService);
  private intervalId: any = null;
  private searchTimer: any = null;

  cols =
    '26px 76px minmax(120px, 1fr) 106px minmax(100px, 0.9fr) 62px 90px minmax(120px, 1fr) 52px minmax(220px, 1.8fr) 68px 110px';

  /** Duration bands, in seconds. `max: 0` means "no upper bound". */
  readonly DURATIONS = [
    { key: '', label: 'Any length', min: 0, max: 0 },
    { key: 'short', label: 'Under 30s', min: 0, max: 30 },
    { key: 'mid', label: '30s – 2 min', min: 30, max: 120 },
    { key: 'long', label: 'Over 2 min', min: 120, max: 0 },
  ];

  readonly RANGES = [
    { key: '', label: 'All time', hours: 0 },
    { key: '1h', label: 'Last hour', hours: 1 },
    { key: '24h', label: 'Last 24 hours', hours: 24 },
    { key: '7d', label: 'Last 7 days', hours: 24 * 7 },
    { key: '30d', label: 'Last 30 days', hours: 24 * 30 },
  ];

  metrics = signal<any>(null);
  calls = signal<any[]>([]);
  campaigns = signal<any[]>([]);
  /** agent key -> its human label, for the Agent column. */
  agentLabels = signal<Record<string, string>>({});
  total = signal(0);
  storage = signal(true);
  error = signal('');
  openId = signal<string | null>(null);
  /** call_id -> summary expanded in place. Survives the five-second poll. */
  expandedSummaries = signal<Record<string, boolean>>({});
  stats = signal<any[]>([]);

  search = signal('');
  campaign = signal('');
  duration = signal('');
  range = signal('');

  filtered = computed(
    () => !!(this.search() || this.campaign() || this.duration() || this.range()),
  );

  /**
   * The filter as query params — one value driving both the table and the
   * report download, so the file can never contain a different set of rows
   * than the screen it was downloaded from.
   */
  query = computed<Record<string, string>>(() => {
    const params: Record<string, string> = {};
    if (this.search().trim()) params['q'] = this.search().trim();
    if (this.campaign()) params['campaign_id'] = this.campaign();
    const band = this.DURATIONS.find((d) => d.key === this.duration());
    if (band?.min) params['min_duration'] = String(band.min);
    if (band?.max) params['max_duration'] = String(band.max);
    const window = this.RANGES.find((r) => r.key === this.range());
    if (window?.hours) params['hours'] = String(window.hours);
    return params;
  });

  ngOnInit(): void {
    this.loadReference();
    this.load();
    this.intervalId = setInterval(() => this.load(), 5000);
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  toggleOpen(id: string): void {
    this.openId.set(this.openId() === id ? null : id);
  }

  summaryOpen(id: string): boolean {
    return !!this.expandedSummaries()[id];
  }

  /**
   * Expand one summary in place.
   *
   * stopPropagation, or reading a summary also opens the call drawer over the
   * table you are reading it in.
   */
  toggleSummary(id: string, event: Event): void {
    event.stopPropagation();
    const open = { ...this.expandedSummaries() };
    if (open[id]) delete open[id];
    else open[id] = true;
    this.expandedSummaries.set(open);
  }

  // ── Selection & bulk actions ────────────────────────────────────────────

  selected = signal<Set<string>>(new Set());
  bulkBusy = signal(false);
  bulkStatus = signal('');

  isSelected(c: any): boolean {
    return this.selected().has(c.call_id);
  }

  allSelected(): boolean {
    const rows = this.calls();
    return rows.length > 0 && this.selected().size === rows.length;
  }

  toggleOne(c: any): void {
    const next = new Set(this.selected());
    if (!next.delete(c.call_id)) next.add(c.call_id);
    this.selected.set(next);
  }

  toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.calls().map((c) => c.call_id)));
  }

  clearSelection(): void {
    this.selected.set(new Set());
    this.bulkStatus.set('');
  }

  private selectedRows(): any[] {
    const ids = this.selected();
    return this.calls().filter((c) => ids.has(c.call_id));
  }

  downloadSelectedCsv(): void {
    const list = this.selectedRows();
    if (!list.length) return;
    const headers = ['Time', 'Contact', 'Number', 'Agent', 'Duration (s)', 'Status', 'Campaign', 'Turns', 'Summary', 'Total Tokens', 'Call ID'];
    const rows = list.map((c) => [
      c.started_at ?? '',
      c.contact_name ?? '',
      c.phone ?? '',
      this.agentLabel(c.agent),
      c.duration_seconds ?? 0,
      this.statusLabel(c),
      c.campaign_name ?? '',
      c.num_turns ?? 0,
      c.summary ?? '',
      c.total_tokens ?? 0,
      c.call_id ?? '',
    ]);
    const csv = '﻿' + [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selected-calls-${list.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Staggered, not simultaneous — browsers drop downloads fired in the same tick. */
  downloadSelectedAudio(): void {
    this.selectedRows().forEach((c, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = this.api.recordingUrls(c.call_id).download;
        a.download = `${c.call_id}.wav`;
        a.click();
      }, i * 400);
    });
  }

  async reanalyzeSelected(): Promise<void> {
    const list = this.selectedRows();
    if (!list.length) return;
    this.bulkBusy.set(true);
    let ok = 0;
    for (const c of list) {
      try {
        await this.api.analyzeCall(c.call_id);
        ok++;
      } catch {
        // best-effort — one failed call must not stop the rest of the batch
      }
    }
    this.bulkBusy.set(false);
    this.bulkStatus.set(`Analyzed ${ok} of ${list.length}`);
  }

  /** Debounced: typing a ten-digit number should be one request, not ten. */
  onSearch(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 350);
  }

  setFilter(which: 'campaign' | 'duration' | 'range', value: string): void {
    ({ campaign: this.campaign, duration: this.duration, range: this.range })[which].set(value);
    this.load();
  }

  clearFilters(): void {
    this.search.set('');
    this.campaign.set('');
    this.duration.set('');
    this.range.set('');
    this.load();
  }

  /** The agent's label, falling back to its key so a removed agent still shows. */
  agentLabel(key: string): string {
    return this.agentLabels()[key] || key || '—';
  }

  /** Says where a contact name came from, when it wasn't the call's own record. */
  contactTitle(call: any): string {
    if (!call.contact_name) return 'No contact recorded for this call';
    if (call.contact_name_matched_by === 'phone') {
      return `${call.contact_name} — matched by phone number from an uploaded list. This call was never linked to a campaign, so this is who owns the number, not a recorded result.`;
    }
    return call.contact_name;
  }

  /**
   * A call's state in one word.
   *
   * "Completed" on a call where nobody said anything is technically true and
   * practically a lie — the leg answered and no audio flowed either way, which
   * is the failure an operator is scanning this column for.
   */
  statusLabel(call: any): string {
    if (call.status === 'in_progress') return 'On the call';
    if ((call.num_turns ?? 0) === 0) return 'No audio';
    return resultLabel(this.result(call)) || 'Completed';
  }

  statusClass(call: any): string {
    if (call.status === 'in_progress') return 'info';
    if ((call.num_turns ?? 0) === 0) return 'bad';
    return this.result(call) === 'conversation' ? 'ok' : 'warn';
  }

  /**
   * What happened on the call. Newer backends send call_result; for older ones it
   * is read from the summary the backend already writes ("Agent spoke, caller
   * never did", "Ended without a reported outcome"), so the log stops calling
   * every call "completed".
   */
  private result(call: any): string {
    if (call.call_result) return call.call_result;
    const s = String(call.summary || '');
    if (/^Agent spoke, caller never did/.test(s)) return 'no_response';
    if (/^Ended without a reported outcome/.test(s)) return 'disconnected_early';
    return 'conversation';
  }

  /**
   * The campaign filter's options and the agent labels, fetched once.
   *
   * Both are reference data that the five-second poll has no reason to re-read,
   * and both are conveniences — losing either must not blank the page.
   */
  private async loadReference(): Promise<void> {
    try {
      const out = await this.api.campaigns();
      this.campaigns.set(out.campaigns || []);
    } catch {
      this.campaigns.set([]);
    }
    try {
      const agents = await this.api.agents();
      this.agentLabels.set(
        Object.fromEntries((agents || []).map((a: any) => [a.key, a.label || a.key])),
      );
    } catch {
      this.agentLabels.set({});
    }
  }

  private async load(): Promise<void> {
    try {
      const [m, c] = await Promise.all([
        this.api.metrics(),
        this.api.calls({ limit: '50', ...this.query() }),
      ]);
      this.metrics.set(m);
      this.calls.set(c.calls || []);
      this.total.set(c.total ?? 0);
      this.storage.set(c.storage_connected);
      this.error.set('');
      this.stats.set(this.tiles(m));
    } catch (e: any) {
      this.error.set(e.message);
    }
  }

  /** The funnel, top to bottom, then the two aggregate call stats. */
  private tiles(m: any): any[] {
    const f = m?.funnel || {};
    const pct = (rate: number) => `${Math.round((rate || 0) * 100)}%`;
    return [
      {
        label: 'Rows uploaded',
        value: fmtNum(f.planned ?? 0),
        on: (f.planned ?? 0) > 0,
        note: `uploaded across ${f.campaigns ?? 0} campaign${f.campaigns === 1 ? '' : 's'}`,
      },
      {
        label: 'Will dial',
        value: fmtNum(f.will_dial ?? 0),
        on: (f.will_dial ?? 0) > 0,
        note: f.gated
          ? `${f.gated} held back by data checks or a missing route`
          : 'nothing gated',
      },
      {
        label: 'Dialled',
        value: fmtNum(f.attempted ?? 0),
        on: (f.attempted ?? 0) > 0,
        note: `${fmtNum(f.attempts ?? 0)} dials · ${f.attempts_per_call ?? 0} per contact`,
      },
      {
        label: 'Reached',
        value: pct(f.reach_rate ?? f.connected_rate),
        on: (f.connected ?? 0) > 0,
        note: `${f.connected ?? 0} of ${f.attempted ?? 0} answered at least once · answer rate ${pct(f.answer_rate)} per dial`,
      },
      {
        label: 'Conversations',
        value: pct(f.conversation_rate),
        on: (f.conversation ?? 0) > 0,
        note: `${f.conversation ?? 0} of ${f.attempted ?? 0} dialled contacts talked it through`,
      },
      {
        label: 'Goal achieved',
        value: pct(f.achieved_rate),
        on: (f.achieved ?? 0) > 0,
        note: `${f.achieved ?? 0} of ${f.conversation ?? 0} conversations reported an outcome`,
      },
      {
        label: 'Not reached',
        value: fmtNum((f.by_status?.no_answer || 0) + (f.by_status?.busy || 0) + (f.by_status?.unreachable || 0) + (f.by_status?.retry_exhausted || 0)),
        on: true,
        note: `no answer ${f.by_status?.no_answer || 0} · busy ${f.by_status?.busy || 0} · unreachable ${f.by_status?.unreachable || 0} · tried 3 times ${f.by_status?.retry_exhausted || 0}`,
      },
      {
        label: 'Answered, no talk',
        value: fmtNum((f.by_result?.no_response || 0) + (f.by_result?.disconnected_early || 0) + (f.by_result?.voicemail || 0)),
        on: true,
        note: `silent ${f.by_result?.no_response || 0} · hung up early ${f.by_result?.disconnected_early || 0} · voicemail ${f.by_result?.voicemail || 0}`,
      },
      {
        label: 'Still open',
        value: fmtNum(f.open ?? 0),
        on: (f.open ?? 0) > 0,
        note: `${f.by_status?.retry_scheduled || 0} waiting for a retry`,
      },
      {
        label: 'Callbacks asked',
        value: fmtNum(f.callbacks_open ?? 0),
        on: (f.callbacks_open ?? 0) > 0,
        note: 'caller asked to be rung back',
      },
      {
        label: 'Talk time',
        value: fmtSecs(f.talk_seconds),
        on: (f.talk_seconds ?? 0) > 0,
        note: `avg ${fmtDuration(m?.avg_duration_seconds)} per answered call · ${m?.avg_turns_per_call ?? 0} turns`,
      },
      {
        label: 'Technical drops',
        value: fmtNum(f.tech_failures ?? 0),
        on: (f.tech_failures ?? 0) > 0,
        note: 'answered, but the agent could not run the call',
      },
    ];
  }
}
