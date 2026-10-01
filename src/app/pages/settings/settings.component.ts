import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { HintComponent } from '../../components/hint/hint.component';
import { GuideComponent } from '../../components/guide/guide.component';
import { StatusReferenceComponent } from '../../components/status-reference/status-reference.component';
import { HealthService } from '../../services/health.service';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { API_BASE } from '../../core/endpoints';
import { CALL_STATUSES, statusHover } from '../../utils/status';

const ROLE_WORDS: Record<string, string> = {
  org_admin: 'Admin',
  campaign_manager: 'Campaign manager',
  user: 'Member',
};
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
type Tab = 'workspace' | 'telephony' | 'calling' | 'data' | 'integrations' | 'developer';

/**
 * Platform settings for the workspace, in tabs, with one Save:
 * workspace (time zone, calling hours, parallel calls), telephony (provider,
 * lines, recording, DND), calling defaults for new agents, data retention and
 * where results can be sent. Each field explains itself with an info icon.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent, FormsModule, RouterLink, HintComponent, GuideComponent, StatusReferenceComponent],
  template: `
    <div class="page">
      <div class="page-head agent-head">
        <h1 class="page-title">Settings</h1>
        <div class="page-actions">
          @if (dirty()) { <button class="btn btn-ghost" (click)="discard()">Discard</button> }
          <button class="btn btn-primary" [disabled]="!dirty() || saving() || !isOrgAdmin()" (click)="save()" [title]="isOrgAdmin() ? '' : 'Only admins can change settings'">{{ saving() ? 'Saving…' : dirty() ? 'Save changes' : 'Saved' }}</button>
        </div>
      </div>
      @if (error()) { <div class="note bad">{{ error() }}</div> }
      @if (toast()) { <div class="toast" role="status">{{ toast() }}</div> }

      <div class="card">
        <div class="card-head">
          <span class="card-title">
            @for (t of TABS; track t.key) { <button [class]="'tab' + (tab() === t.key ? ' on' : '')" (click)="tab.set(t.key)">{{ t.label }}</button> }
          </span>
        </div>

        @if (s(); as st) {
          @if (tab() === 'workspace') {
            <div class="card-body settings-tab">
              <div class="set-grid">
                <div class="field"><span class="field-label">Signed in as</span><code>{{ auth.me()?.email || '—' }}</code></div>
                <label class="field"><span class="field-label">Workspace <app-hint text="Each workspace has its own agents, campaigns, lines and team."></app-hint></span>
                  @if (memberships().length > 1) {
                    <select class="select" [ngModel]="auth.currentOrgId()" (ngModelChange)="switchOrg($event)">@for (m of memberships(); track m.org_id) { <option [value]="m.org_id">{{ m.org_name }}</option> }</select>
                  } @else { <code>{{ auth.currentMembership()?.org_name || '—' }}</code> }
                </label>
                <div class="field"><span class="field-label">Your role <app-hint [text]="roleHelp()"></app-hint></span><span>{{ roleWords() }}@if (isOrgAdmin()) { · <a class="link" routerLink="/team">Team</a> }</span></div>
              </div>
              <div class="set-grid">
                <label class="field"><span class="field-label">Time zone <app-hint text="Used for calling hours, schedules and every time shown in Echo."></app-hint></span>
                  <select class="select" [ngModel]="st.workspace.timezone" (ngModelChange)="patch('workspace', { timezone: $event })">@for (z of ZONES; track z) { <option [value]="z">{{ z }}</option> }</select></label>
                <label class="field"><span class="field-label">Default language <app-hint text="Language new agents start with. Each agent can change it."></app-hint></span>
                  <select class="select" [ngModel]="st.workspace.language" (ngModelChange)="patch('workspace', { language: $event })">@for (l of LANGS; track l[0]) { <option [value]="l[0]">{{ l[1] }}</option> }</select></label>
                <label class="field"><span class="field-label">Calls at the same time <app-hint text="Most calls this workspace places at once. Extra calls wait in the queue."></app-hint></span>
                  <input class="input" type="number" min="1" max="200" [ngModel]="st.workspace.max_parallel_calls" (ngModelChange)="patch('workspace', { max_parallel_calls: +$event || 1 })" /></label>
              </div>
              <div class="field">
                <span class="field-label">Calling hours <app-hint text="Echo only dials inside these hours and days. Calls outside wait for the next window."></app-hint></span>
                <div class="hours">
                  <input class="input" type="time" [ngModel]="st.workspace.calling_hours.from" (ngModelChange)="patchHours({ from: $event })" aria-label="From" />
                  <span class="row-sub">to</span>
                  <input class="input" type="time" [ngModel]="st.workspace.calling_hours.to" (ngModelChange)="patchHours({ to: $event })" aria-label="To" />
                  <div class="seg" role="group" aria-label="Days">
                    @for (d of DAYS; track d[0]) { <button type="button" [class.on]="st.workspace.calling_hours.days.includes(d[0])" (click)="toggleDay(d[0])">{{ d[1] }}</button> }
                  </div>
                </div>
              </div>
            </div>
          }

          @if (tab() === 'telephony') {
            <div class="card-body settings-tab">
              <div class="set-grid">
                <div class="field"><span class="field-label">Telephony provider <app-hint text="The service that places the calls. Its keys are kept on the server."></app-hint></span>
                  <span><span [class]="'dot ' + (telephonyOk() ? 'ok' : 'bad')"></span> Ozonetel · {{ telephonyOk() ? 'connected' : 'not connected' }}</span></div>
                <label class="field"><span class="field-label">Record calls <app-hint text="Keep a recording of every answered call. Retention is set under Data."></app-hint></span>
                  <select class="select" [ngModel]="st.telephony.record_calls" (ngModelChange)="patch('telephony', { record_calls: $event === true || $event === 'true' })"><option [ngValue]="true">On</option><option [ngValue]="false">Off</option></select></label>
                <label class="field"><span class="field-label">Skip DND numbers <app-hint text="Numbers on the national do not disturb list are not dialled and get call status Blocked."></app-hint></span>
                  <select class="select" [ngModel]="st.telephony.dnd_check" (ngModelChange)="patch('telephony', { dnd_check: $event === true || $event === 'true' })"><option [ngValue]="true">On</option><option [ngValue]="false">Off</option></select></label>
              </div>
              <div class="field">
                <span class="field-label">Lines <app-guide topic="line"></app-guide></span>
                <div class="lines">
                  @for (l of lines(); track l.name) {
                    <div class="line-row">
                      <span class="mono"><b>{{ l.name }}</b></span>
                      <span class="row-sub">{{ l.did || 'no number' }} · {{ l.type || 'Outbound' }}</span>
                      <span class="row-sub">{{ l.agents.length ? 'Used by ' + l.agents.join(', ') : 'Not used by any agent' }}</span>
                      <button class="icon-btn" [disabled]="!!l.agents.length || !isOrgAdmin()" (click)="removeLine(l.name)" [title]="l.agents.length ? 'Agents still call from this line' : 'Remove line'" aria-label="Remove line"><app-icon name="trash" [size]="14"></app-icon></button>
                    </div>
                  }
                  @if (!lines().length) { <div class="row-sub" style="padding: 8px 0">No lines yet. Add the line name and number set up in your telephony account.</div> }
                </div>
                @if (isOrgAdmin()) {
                  <div class="add-line">
                    <input class="input" [ngModel]="newLine().name" (ngModelChange)="setLine('name', $event)" placeholder="Line name, as in your telephony account" aria-label="Line name" />
                    <input class="input" [ngModel]="newLine().did" (ngModelChange)="setLine('did', $event)" placeholder="Number calls show" inputmode="tel" aria-label="Number" />
                    <select class="select" [ngModel]="newLine().type" (ngModelChange)="setLine('type', $event)" aria-label="Type"><option value="IVR">IVR</option><option value="Progressive">Progressive</option></select>
                    <button class="btn" (click)="addLine()" [disabled]="!newLine().name.trim()"><app-icon name="plus" [size]="13"></app-icon> Add line</button>
                  </div>
                }
              </div>
            </div>
          }

          @if (tab() === 'calling') {
            <div class="card-body settings-tab">
              <div class="row-sub">New agents start with these. Each agent can change them under Settings, Advanced.</div>
              <div class="set-grid">
                <label class="field"><span class="field-label">Tries per contact <app-guide topic="retry"></app-guide></span>
                  <input class="input" type="number" min="1" max="6" [ngModel]="st.calling_defaults.tries" (ngModelChange)="patch('calling_defaults', { tries: +$event || 1 })" /></label>
                <label class="field"><span class="field-label">Wait between tries (min) <app-hint text="Minutes from the end of one dial to the next."></app-hint></span>
                  <input class="input" type="number" min="5" max="1440" [ngModel]="st.calling_defaults.gap_minutes" (ngModelChange)="patch('calling_defaults', { gap_minutes: +$event || 60 })" /></label>
              </div>
              <div class="field">
                <span class="field-label">Try again when the call status is <app-status-reference label="How each status is worked out"></app-status-reference></span>
                <div class="tick-grid">
                  @for (o of RETRYABLE; track o.key) { <label class="choice" [title]="o.hover"><input type="checkbox" [checked]="st.calling_defaults.on.includes(o.key)" (change)="toggleRetry(o.key, $any($event.target).checked)" /> {{ o.label }}</label> }
                </div>
              </div>
            </div>
          }

          @if (tab() === 'data') {
            <div class="card-body settings-tab">
              <div class="set-grid">
                <label class="field"><span class="field-label">Keep recordings (days) <app-hint text="Recordings older than this are deleted every night."></app-hint></span>
                  <input class="input" type="number" min="1" max="3650" [ngModel]="st.data.recordings_days" (ngModelChange)="patch('data', { recordings_days: +$event || 1 })" /></label>
                <label class="field"><span class="field-label">Keep transcripts (days) <app-hint text="Transcripts and answers older than this are deleted every night."></app-hint></span>
                  <input class="input" type="number" min="1" max="3650" [ngModel]="st.data.transcripts_days" (ngModelChange)="patch('data', { transcripts_days: +$event || 1 })" /></label>
                <label class="field"><span class="field-label">Temporary reference files (days) <app-guide topic="reference"></app-guide></span>
                  <input class="input" type="number" min="1" max="90" [ngModel]="st.data.reference_days" (ngModelChange)="patch('data', { reference_days: +$event || 1 })" /></label>
                <label class="field"><span class="field-label">Hide numbers from members <app-hint text="Members see numbers as 98XXXXXX21. Admins and campaign managers see them in full."></app-hint></span>
                  <select class="select" [ngModel]="st.data.mask_numbers_for_users" (ngModelChange)="patch('data', { mask_numbers_for_users: $event === true || $event === 'true' })"><option [ngValue]="false">Off</option><option [ngValue]="true">On</option></select></label>
              </div>
              <div class="field"><span class="field-label">Call history</span><span><span [class]="'dot ' + (today()?.storage_connected ? 'ok' : 'bad')"></span> {{ today()?.storage_connected ? 'Saved' : 'Not being saved right now' }}</span></div>
            </div>
          }

          @if (tab() === 'integrations') {
            <div class="card-body settings-tab">
              <div class="field"><span class="field-label">Where results can go <app-guide topic="destination"></app-guide></span></div>
              @for (p of syncPlatforms(); track p.platform_key) {
                <div class="line-row">
                  <span><span [class]="'dot ' + (p.connected ? (countsFor(p.platform_key).failed ? 'bad' : 'ok') : '')"></span> <b>{{ p.label }}</b></span>
                  <span class="row-sub">{{ p.connected ? (countsFor(p.platform_key).total ? countsFor(p.platform_key).total + ' agent(s) send results here' : 'No agent uses it yet') : 'Not connected' }}</span>
                  @if (p.needs_url && p.connected) { <input class="input" [ngModel]="p.url" (ngModelChange)="p.url = $event" (blur)="setUrl(p)" placeholder="https://your-system.example.com/results" aria-label="Web address" /> } @else { <span></span> }
                  <button class="btn btn-sm" [disabled]="!isOrgAdmin()" (click)="toggleConnect(p)">{{ p.connected ? 'Disconnect' : 'Connect' }}</button>
                </div>
              }
            </div>
          }

          @if (tab() === 'developer') {
            <div class="card-body settings-tab">
              <div class="set-grid">
                <div class="field"><span class="field-label">API</span><code>{{ apiBase }}</code></div>
                <div class="field"><span class="field-label">Voice service</span><code>{{ api.webrtcBase }}</code></div>
                <div class="field"><span class="field-label">Version</span><code>{{ healthData()?.version || '—' }}</code></div>
                <div class="field"><span class="field-label">Round trip</span><code>{{ healthData() ? healthData().ms + ' ms' : 'unreachable' }}</code></div>
              </div>
            </div>
          }
        } @else { <div class="card-body row-sub">Loading…</div> }
      </div>
    </div>
  `,
  styles: [`
    .hours { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .hours .input { width: auto; }
    .lines { border: 1px solid var(--line); border-radius: 10px; padding: 2px 12px; }
    .line-row { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(120px, 1fr) minmax(0, 1.4fr) auto; gap: 12px; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--line-soft); }
    .line-row:last-child { border-bottom: 0; }
    .add-line { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 130px auto; gap: 8px; margin-top: 10px; }
    @media (max-width: 760px) { .line-row, .add-line { grid-template-columns: 1fr; } }
  `],
})
export class SettingsComponent implements OnInit {
  private healthService = inject(HealthService);
  api = inject(ApiService);
  auth = inject(AuthService);
  apiBase = API_BASE || window.location.origin;
  healthData = this.healthService.health;
  today = this.healthService.todayMetrics;
  memberships = computed(() => this.auth.me()?.memberships || []);
  isOrgAdmin = computed(() => !!this.auth.me()?.platform_admin || this.auth.currentMembership()?.role === 'org_admin');

  readonly TABS: { key: Tab; label: string }[] = [
    { key: 'workspace', label: 'Workspace' }, { key: 'telephony', label: 'Telephony' }, { key: 'calling', label: 'Calling defaults' },
    { key: 'data', label: 'Data' }, { key: 'integrations', label: 'Integrations' }, { key: 'developer', label: 'Developer' },
  ];
  readonly DAYS = DAYS;
  readonly ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];
  readonly LANGS = [['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['hinglish', 'Hinglish'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['mr-IN', 'Marathi'], ['bn-IN', 'Bengali'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ar', 'Arabic']];
  readonly RETRYABLE = CALL_STATUSES.filter((s) => s.group !== 'in_progress' && s.group !== 'not_dialled').map((s) => ({ key: s.key, label: s.label, hover: statusHover(s.key) }));

  tab = signal<Tab>('workspace');
  s = signal<any>(null);
  private saved = signal('');
  dirty = computed(() => !!this.s() && JSON.stringify(this.s()) !== this.saved());
  saving = signal(false);
  error = signal('');
  toast = signal('');

  telephony = signal<any>(null);
  telephonyOk = computed(() => this.telephony()?.ozonetel_configured === true);
  private oznCampaigns = signal<any[]>([]);
  private agents = signal<any[]>([]);
  syncPlatforms = signal<{ platform_key: string; label: string; connected?: boolean; needs_url?: boolean; url?: string }[]>([]);
  newLine = signal({ name: '', did: '', type: 'IVR' });
  setLine(k: 'name' | 'did' | 'type', v: string): void { this.newLine.update((l) => ({ ...l, [k]: v })); }

  lines = computed(() => this.oznCampaigns().map((c) => ({ ...c, agents: this.agents().filter((a) => a.ozonetel_campaign === c.name).map((a) => a.label) })));
  countsFor(key: string) {
    const list = this.agents().filter((a: any) => a.synced_platform === key);
    return { total: list.length, failed: list.filter((a: any) => a.sync_status === 'failed').length };
  }
  roleWords = computed(() => ROLE_WORDS[this.auth.currentMembership()?.role || ''] || (this.auth.me()?.platform_admin ? 'Platform admin' : '—'));
  roleHelp = computed(() => 'Admins manage the team, settings, agents and every campaign. Campaign managers run campaigns. Members see the campaigns shared with their group.');

  ngOnInit(): void { this.loadAll(); }

  private org(): string { return this.auth.currentOrgId(); }
  private async loadAll(): Promise<void> {
    this.api.webrtcHealth().then((h) => this.telephony.set(h?.telephony || {})).catch(() => this.telephony.set({}));
    this.api.ozonetelCampaigns(true).then((r) => this.oznCampaigns.set(r.campaigns || [])).catch(() => this.oznCampaigns.set([]));
    if (this.org()) {
      this.api.orgSyncPlatforms(this.org()).then((p) => this.syncPlatforms.set(p as any)).catch(() => this.syncPlatforms.set([]));
      this.api.orgSettings(this.org()).then((st) => { this.s.set(structuredClone(st)); this.saved.set(JSON.stringify(st)); }).catch((e) => this.error.set(e.message));
    }
    try {
      const [tester, list] = await Promise.all([this.api.agents(), this.api.agentList()]);
      const route = new Map((tester || []).map((a: any) => [a.key, a.ozonetel_campaign]));
      this.agents.set((list.agents || []).map((a: any) => ({ ...a, ozonetel_campaign: route.get(a.key) || '' })));
    } catch { this.agents.set([]); }
  }

  patch(part: string, c: any): void { this.s.update((x) => ({ ...x, [part]: { ...x[part], ...c } })); }
  patchHours(c: any): void { this.patch('workspace', { calling_hours: { ...this.s().workspace.calling_hours, ...c } }); }
  toggleDay(d: string): void {
    const days: string[] = this.s().workspace.calling_hours.days;
    this.patchHours({ days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d] });
  }
  toggleRetry(k: string, on: boolean): void {
    const cur: string[] = this.s().calling_defaults.on;
    this.patch('calling_defaults', { on: on ? [...new Set([...cur, k])] : cur.filter((x) => x !== k) });
  }
  discard(): void { this.s.set(JSON.parse(this.saved())); }
  async save(): Promise<void> {
    this.saving.set(true); this.error.set('');
    try { const st = await this.api.saveOrgSettings(this.org(), this.s()); this.s.set(structuredClone(st)); this.saved.set(JSON.stringify(st)); this.say('Settings saved.'); }
    catch (e: any) { this.error.set(`Not saved: ${e.message}`); }
    finally { this.saving.set(false); }
  }
  async addLine(): Promise<void> {
    try { await this.api.addLine(this.org(), this.newLine()); this.newLine.set({ name: '', did: '', type: 'IVR' }); this.say('Line added.'); this.loadAll(); }
    catch (e: any) { this.error.set(e.message); }
  }
  async removeLine(name: string): Promise<void> {
    try { await this.api.removeLine(this.org(), name); this.say('Line removed.'); this.loadAll(); }
    catch (e: any) { this.error.set(e.message); }
  }
  async toggleConnect(p: any): Promise<void> {
    try { const t = await this.api.setSyncPlatform(this.org(), p.platform_key, { connected: !p.connected, url: p.url || '' }); this.syncPlatforms.update((l) => l.map((x) => (x.platform_key === p.platform_key ? { ...x, ...t } : x))); }
    catch (e: any) { this.error.set(e.message); }
  }
  async setUrl(p: any): Promise<void> {
    try { await this.api.setSyncPlatform(this.org(), p.platform_key, { connected: true, url: p.url || '' }); this.say('Web address saved.'); }
    catch (e: any) { this.error.set(e.message); }
  }
  switchOrg(orgId: string): void { this.auth.setCurrentOrg(orgId); window.location.reload(); }
  private say(m: string): void { this.toast.set(m); setTimeout(() => this.toast.set(''), 2600); }
}
