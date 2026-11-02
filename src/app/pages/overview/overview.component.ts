
/** Older call result words to the outcome words used everywhere else (PRD-ECHO-19). */
const RESULT_TO_OUTCOME: Record<string, string> = { conversation: 'completed', no_response: 'no_reply', disconnected_early: 'caller_hung_up', voicemail: 'voicemail', technical_drop: 'call_dropped' };
import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { EchoMarkComponent } from '../../components/echo-mark/echo-mark.component';
import { CampaignNamePipe } from '../../pipes/campaign-name.pipe';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { FmtDurationPipe } from '../../pipes/fmt-duration.pipe';
import { GROUPS, outcomeView as ov, statusHover } from '../../utils/status';
import { fmtNum, fmtSecs } from '../../utils/format';
import { CallingReportComponent, CallingReportSource, ReportScope } from '../../components/calling-report/calling-report.component';
import { AuthService } from '../../services/auth.service';
import { CreditsService, fmtCredits } from '../../services/credits.service';

/**
 * The dashboard: one funnel ribbon (dialled, reached, completed), one
 * bar of what happened, and the call log grouped by day. Each number says what
 * it is a share of, so nobody acts on a percentage they cannot check.
 */
@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [EchoMarkComponent, CampaignNamePipe, 
    FormsModule,
    IconComponent,
    FmtDurationPipe,
    CallingReportComponent,
  ],
  template: `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Overview</h1>
        <div class="page-actions">
          @if (metrics()?.active_calls > 0) {
            <span class="pill live"><app-echo-mark mode="live" [size]="18" [tile]="false"></app-echo-mark>{{ metrics().active_calls }} on the line</span>
          }
        </div>
      </div>

      <!-- What needs a person today, each one click from the fix. -->
      @if (needs().length) {
        <div class="ov-needs" role="list" aria-label="Needs you">
          @for (n of needs(); track n.to) {
            <button type="button" role="listitem" [class]="'ov-need ' + n.cls" (click)="go(n.to)"><app-icon [name]="n.icon" [size]="14"></app-icon><b class="mono">{{ n.n }}</b> {{ n.text }} <app-icon name="chevronRight" [size]="13"></app-icon></button>
          }
        </div>
      }
      @if (error()) { <div class="note bad">{{ error() }}</div> }
      @if (!storage()) { <div class="note bad">Call history is not being saved right now. Live calls still work.</div> }

      <!-- The calling report (Calling-Report-Logic.md v1): the same component and numbers as Clarix. Every number on this page comes from it. -->
      <app-calling-report [source]="reportSource" (scopeChange)="onReportScope($event)"></app-calling-report>

      <div class="card" style="margin-top: 12px">
        <div class="filter-bar">
          <label class="search"><app-icon name="search" [size]="14"></app-icon><input class="input" type="search" placeholder="Search name or number" [ngModel]="search()" (ngModelChange)="onSearch($event)" aria-label="Search calls" /></label>
          <select class="select" [ngModel]="campaign()" (ngModelChange)="setFilter('campaign', $event)" aria-label="Campaign">
            <option value="">All campaigns</option>
            @for (c of campaigns(); track c.campaign_id) { <option [value]="c.campaign_id">{{ c.name | campaignName }}</option> }
          </select>
          <select class="select" [ngModel]="range()" (ngModelChange)="setFilter('range', $event)" aria-label="When">
            @for (r of RANGES; track r.key) { <option [value]="r.key">{{ r.label }}</option> }
          </select>
          @if (filtered()) { <button class="btn btn-sm" (click)="clearFilters()"><app-icon name="close" [size]="12"></app-icon> Clear</button> }
          <span style="flex: 1"></span>
          <a class="icon-btn" [href]="api.callsReportUrl(query())" download [class.off]="!calls().length" title="Download these calls as a spreadsheet" aria-label="Download these calls"><app-icon name="table" [size]="16"></app-icon></a>
        </div>

        @if (calls().length === 0) {
          <div class="empty">
            <div class="empty-icon"><app-icon name="phone" [size]="18"></app-icon></div>
            <div class="empty-title">{{ filtered() ? 'No calls match' : 'No calls yet' }}</div>
            <div class="empty-sub">{{ filtered() ? 'Clear the filters to see everything.' : 'Start a campaign, or try an agent in the call console.' }}</div>
          </div>
        } @else {
          @for (d of days_(); track d.label) {
            <div class="ov-day"><span>{{ d.label }}</span><span class="row-sub">{{ d.calls.length }} call{{ d.calls.length === 1 ? '' : 's' }}</span></div>
            @for (c of d.calls; track c.call_id) {
              <div class="ov-row" tabindex="0" (click)="openCall(c.call_id)" (keydown.enter)="openCall(c.call_id)" title="Open the call page">
                <span class="mono ov-time">{{ clock(c.started_at) }}</span>
                <span class="ov-who"><b>{{ c.contact_name || c.phone || 'Unknown' }}</b><span class="row-sub">{{ c.phone }} · {{ agentLabel(c.agent) }}</span></span>
                <span><span [class]="'tag ' + statusClass(c)">{{ statusLabel(c) }}</span></span>
                <span class="row-sub ov-sum" [title]="c.summary || ''">{{ c.summary || '' }}</span>
                <span class="mono ov-len">{{ c.duration_seconds | fmtDuration }}</span>
                <span class="ov-acts" (click)="$event.stopPropagation()">
                  <a class="icon-btn" [href]="api.callTranscriptUrl(c.call_id)" download title="Download transcript" aria-label="Download transcript"><app-icon name="transcript" [size]="15"></app-icon></a>
                  <a class="icon-btn" [href]="api.recordingUrls(c.call_id).download" download title="Download audio" aria-label="Download audio"><app-icon name="headphones" [size]="15"></app-icon></a>
                </span>
              </div>
            }
          }
          @if (total() > calls().length) { <div class="row-sub" style="padding: 10px 16px">Showing the latest {{ calls().length }} of {{ total() }}. Narrow the filters to find older calls.</div> }
        }
      </div>
    </div>
    `,
})
export class OverviewComponent implements OnInit, OnDestroy {
  api = inject(ApiService);
  private router = inject(Router);
  private auth = inject(AuthService);
  private credits = inject(CreditsService);
  private intervalId: any = null;
  private openFollowUps = signal(0);

  /** Where the calling report reads from. A row with a call opens the call page; one without opens its contact. */
  readonly reportSource: CallingReportSource = {
    report: (sc) => this.api.callingReport(sc),
    calls: (sc, box, skip, limit) => this.api.callingReportCalls(sc, box, skip, limit),
    exportXlsx: (sc, box) => this.api.callingReportExport(sc, box),
    testNumbers: () => this.api.reportTestNumbers(),
    saveTestNumbers: (n) => this.api.saveReportTestNumbers(n),
    openFollowUps: () => this.router.navigate(['/follow-ups']),
    openCall: (row) => {
      if (row.call_id) this.router.navigate(['/calls', row.call_id]);
      else if (row.primary_id && row.campaign_id !== 'console') this.router.navigate(['/campaigns', row.campaign_id, 'contacts', row.primary_id]);
    },
  };
  /** The report's period and single agent drive the sections below it. */
  onReportScope(sc: ReportScope): void {
    const agent = sc.agents.length === 1 ? sc.agents[0] : '';
    if (sc.days !== this.days()) this.days.set(sc.days);
    if (agent !== this.agent()) this.setAgent(agent); else this.load();
  }
  private unrouted = signal(0);
  needs = computed(() => {
    const out: { n: string; text: string; to: string; icon: string; cls: string }[] = [];
    if (this.openFollowUps()) out.push({ n: String(this.openFollowUps()), text: this.openFollowUps() === 1 ? 'follow up needs a person' : 'follow ups need a person', to: '/follow-ups', icon: 'userCheck', cls: 'warn' });
    if (this.auth.canAdmin() && this.unrouted()) out.push({ n: String(this.unrouted()), text: this.unrouted() === 1 ? 'agent has no phone line yet' : 'agents have no phone line yet', to: '/agents', icon: 'route', cls: '' });
    if (this.auth.canRun() && this.credits.low()) out.push({ n: fmtCredits(this.credits.balance()), text: 'credits left; calls stop at zero', to: '/credits', icon: 'coins', cls: 'bad' });
    return out;
  });
  go(to: string): void { this.router.navigateByUrl(to); }
  private loadNeeds(): void {
    this.api.followUps('open').then((r) => this.openFollowUps.set(r.counts?.open || 0)).catch(() => undefined);
    if (this.auth.canAdmin()) this.api.agentList(false).then((l) => this.unrouted.set((l.agents || []).filter((a: any) => !a.ozonetel_campaign).length)).catch(() => undefined);
  }

  // Compare: the report under the funnel. Share sends exactly this.
  readonly BYS = [{ key: 'campaign', label: 'Campaign' }, { key: 'agent', label: 'Agent' }, { key: 'day', label: 'Day' }];
  report = signal<any>(null);
  /** Scope of the lists behind the stats: the same period and agent as the page. */
  rowScope = computed(() => ({ days: String(this.days()), agent: this.agent() }));
  by = signal('campaign');
  // One agent, or all. Nothing about the agent is assumed: its answers and its file columns come from its own setup.
  agent = signal('');
  agents = computed<{ key: string; label: string }[]>(() => this.report()?.agents || []);
  agentName = computed(() => this.agents().find((a) => a.key === this.agent())?.label || this.agent());
  answers = computed<any[]>(() => this.report()?.answers || []);
  input = computed<any>(() => (this.report()?.input?.rows ? this.report().input : null));
  why = computed<any>(() => this.report()?.why || null);
  rowsLine = computed<any>(() => this.report()?.rows_line || null);
  bys = computed(() => this.BYS.filter((b) => !(this.agent() && b.key === 'agent')));
  setAgent(k: string): void { this.agent.set(k || ''); if (k && this.by() === 'agent') this.by.set('campaign'); if (!this.columns().some((c) => c.key === this.by()) && this.isColumn()) this.by.set('campaign'); this.showAll.set(false); this.load(); }
  pickRow(r: any): void { if (this.by() === 'agent') this.setAgent(r.key); }
  /** CODE_WORDS and snake_case answers read as plain words; anything already written for people is left alone. */
  pretty(v: string): string { const s = String(v); if (!/^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/.test(s) && s !== s.toUpperCase()) return s; const t = s.replace(/_/g, ' ').toLowerCase(); return t[0].toUpperCase() + t.slice(1); }
  showAll = signal(false);
  columns = computed<{ key: string; label: string }[]>(() => this.report()?.columns || []);
  isColumn = computed(() => !this.BYS.some((b) => b.key === this.by()));
  byLabel = computed(() => this.BYS.find((b) => b.key === this.by())?.label || this.cap(this.columns().find((c) => c.key === this.by())?.label || this.by()));
  reportRows = computed<any[]>(() => { const rows = this.report()?.rows || []; return this.showAll() ? rows : rows.slice(0, 6); });
  rt = computed<any>(() => this.report()?.total || {});
  workspace = computed(() => this.auth.currentMembership()?.org_name || 'Echo');
  period = computed(() => (this.days() === 1 ? 'Today' : `Last ${this.days()} days`));
  madeAt = computed(() => new Date(this.report()?.generated_at || Date.now()).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }));
  private cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  pc(a: number, b: number): number { return b ? Math.round((a / b) * 100) : 0; }
  setBy(k: string): void { this.by.set(k); this.showAll.set(false); this.load(); }
  rowLabel(r: any): string { return this.by() === 'day' ? this.dayLabel(r.label) : this.by() === 'campaign' ? String(r.label || '').replace(/_[0-9a-f]{20,}$/i, '') : r.label; }
  dayLabel(d: string): string { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  goFollowUps(): void { this.router.navigate(['/follow-ups']); }
  private searchTimer: any = null;

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
  /** call_id -> summary expanded in place. Survives the five-second poll. */
  expandedSummaries = signal<Record<string, boolean>>({});
  days = signal(30);
  readonly WINDOWS = [{ days: 1, label: 'Today' }, { days: 7, label: '7 days' }, { days: 30, label: '30 days' }];
  fmtSecs = fmtSecs;
  hover = statusHover;
  f = computed(() => this.metrics()?.funnel || {});
  g = computed<Record<string, number>>(() => this.f().by_group || {});
  groups = computed(() => GROUPS.map((x) => ({ ...x, count: this.g()[x.key] || 0 })));
  groupTotal = computed(() => this.groups().reduce((n, x) => n + x.count, 0));
  mixLabel = computed(() => this.groups().filter((x) => x.count).map((x) => `${x.label} ${x.count}`).join(', '));
  topOutcomes = computed(() => Object.entries(this.f().by_outcome || {}).map(([key, count]) => ({ ...ov(key), count: count as number }))
    .filter((o) => o.count).sort((a, b) => b.count - a.count).slice(0, 8));
  /** Dialled, reached, completed: each with its share of the step before. */
  funnel = computed(() => {
    const f = this.f(); const o = f.by_outcome || {};
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}% of ${b}` : 'nothing yet');
    const dialled = f.attempted || 0, reached = f.connected || 0, done = o.completed || 0;
    return [
      { key: 'dialled', icon: 'phoneOut', label: 'Dialled', value: fmtNum(dialled), rate: `${fmtNum(f.attempts || 0)} dials`, focus: '', help: 'Contacts dialled at least once in this period.' },
      { key: 'reached', icon: 'phone', label: 'Reached', value: fmtNum(reached), rate: pct(reached, dialled), focus: 'reached', help: 'Telephony status Answered on at least one dial.' },
      { key: 'completed', icon: 'message', label: 'Completed', value: fmtNum(done), rate: pct(done, reached), focus: 'completed', help: 'Call status Completed: caller spoke and the agent finished.' },
    ];
  });
  /** Calls in the log, grouped under Today, Yesterday or the date. */
  days_ = computed(() => {
    const out: { label: string; calls: any[] }[] = [];
    const key = (d: Date) => d.toDateString();
    const today = key(new Date()); const y = new Date(); y.setDate(y.getDate() - 1); const yest = key(y);
    for (const c of this.calls()) {
      const d = new Date(c.started_at); const k = key(d);
      const label = k === today ? 'Today' : k === yest ? 'Yesterday' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
      const last = out[out.length - 1];
      if (last?.label === label) last.calls.push(c); else out.push({ label, calls: [c] });
    }
    return out;
  });
  setDays(n: number): void { this.days.set(n); this.load(); }
  clock(ts: string): string { return ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''; }

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
    this.loadNeeds();
    this.loadReference();
    this.load();
    this.intervalId = setInterval(() => this.load(), 5000);
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  /** Every call opens on its own page (no side panel). */
  openCall(id: string): void { this.router.navigate(['/calls', id]); }

  summaryOpen(id: string): boolean {
    return !!this.expandedSummaries()[id];
  }

  /**
   * Expand one summary in place.
   *
   * stopPropagation, or reading a summary also opens the call page.
   */
  toggleSummary(id: string, event: Event): void {
    event.stopPropagation();
    const open = { ...this.expandedSummaries() };
    if (open[id]) delete open[id];
    else open[id] = true;
    this.expandedSummaries.set(open);
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
    return ov(RESULT_TO_OUTCOME[this.result(call) || ''] || 'completed').label;
  }

  statusClass(call: any): string {
    if (call.status === 'in_progress') return 'info';
    if ((call.num_turns ?? 0) === 0) return 'bad';
    return ov(RESULT_TO_OUTCOME[this.result(call) || ''] || 'completed').cls;
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
      const [m, c, r] = await Promise.all([
        this.api.metrics(this.days(), this.agent()),
        this.api.calls({ limit: '50', ...this.query(), agent: this.agent() }),
        this.api.reportSummary({ days: String(this.days()), by: this.by(), agent: this.agent() }).catch(() => null),
      ]);
      this.metrics.set(m);
      if (r) this.report.set(r);
      this.calls.set(c.calls || []);
      this.total.set(c.total ?? 0);
      this.storage.set(c.storage_connected);
      this.error.set('');
    } catch (e: any) {
      this.error.set(e.message);
    }
  }


}
