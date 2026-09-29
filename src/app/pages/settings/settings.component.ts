import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { HealthService } from '../../services/health.service';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { API_BASE } from '../../core/endpoints';

const ROLE_WORDS: Record<string, string> = {
  org_admin: 'Admin: manages the team, agents and every campaign',
  campaign_manager: 'Campaign manager: runs campaigns and sees their results',
  user: 'Member: sees the campaigns shared with their group',
};

/**
 * Workspace, calling and integration settings, with the engine diagnostics folded
 * away under Developer.
 *
 * Telephony state comes from the voice backend's /health, the only one that
 * reports it. The data service's /health has no telephony block, which used to
 * make this page say "not configured" while calls were going out fine.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent, FormsModule, RouterLink],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-sub">Your workspace, how calls go out, and what Echo is connected to.</p>
        </div>
        <div class="page-actions">
          <button class="btn" (click)="refresh()"><app-icon name="activity" [size]="13"></app-icon> Check again</button>
        </div>
      </div>

      <div class="settings-grid">
        <div class="card">
          <div class="card-head"><span class="card-title"><app-icon name="user" [size]="14"></app-icon> Workspace</span></div>
          <div class="health-rows">
            <div class="health-row"><span>Signed in as</span><code>{{ auth.me()?.email || '—' }}</code></div>
            @if (memberships().length > 1) {
              <div class="health-row">
                <span>Workspace</span>
                <select class="select" style="width: auto" [ngModel]="auth.currentOrgId()" (ngModelChange)="switchOrg($event)">
                  @for (m of memberships(); track m.org_id) { <option [value]="m.org_id">{{ m.org_name }}</option> }
                </select>
              </div>
            } @else {
              <div class="health-row"><span>Workspace</span><code>{{ auth.currentMembership()?.org_name || '—' }}</code></div>
            }
            <div class="health-row"><span>Your role</span><span class="settings-value">{{ roleWords() }}</span></div>
            @if (auth.me()?.platform_admin || auth.me()?.agent_admin) {
              <div class="health-row"><span>Extra access</span><span class="settings-value">{{ extraAccess() }}</span></div>
            }
            @if (isOrgAdmin()) {
              <div class="health-row"><span>Team</span><a class="link" routerLink="/team">Manage people and groups</a></div>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-head"><span class="card-title"><app-icon name="phone" [size]="14"></app-icon> Calling</span></div>
          <div class="health-rows">
            <div class="health-row">
              <span><span [class]="'dot ' + (telephonyOk() ? 'ok' : telephony() === null ? '' : 'bad')"></span> Ozonetel</span>
              <span class="settings-value">{{ telephonyOk() ? 'Connected, calls can be placed' : telephony() === null ? 'Checking…' : 'Not connected. Ask your admin to add the Ozonetel keys.' }}</span>
            </div>
            @for (r of routes(); track r.name) {
              <div class="health-row">
                <span class="mono">{{ r.name }}</span>
                <span class="settings-value">{{ r.type || 'Outbound' }} · {{ r.agents.length ? r.agents.join(', ') : 'no agent uses it yet' }}</span>
              </div>
            }
            @if (!routes().length && telephony() !== null) {
              <div class="health-row"><span>Routes</span><span class="settings-value">No Ozonetel campaigns found</span></div>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-head"><span class="card-title"><app-icon name="link" [size]="14"></app-icon> Integrations</span></div>
          <div class="health-rows">
            @if (syncPlatforms().length) {
              @for (p of syncPlatforms(); track p.platform_key) {
                <div class="health-row">
                  <span><span [class]="'dot ' + (syncCounts().failed ? 'bad' : 'ok')"></span> {{ p.label }}</span>
                  <span class="settings-value">
                    {{ syncCounts().synced }} agents in sync
                    @if (syncCounts().pending) { · {{ syncCounts().pending }} waiting }
                    @if (syncCounts().failed) { · <b class="bad">{{ syncCounts().failed }} failed</b> }
                    · <a class="link" routerLink="/agents">Agents</a>
                  </span>
                </div>
              }
            } @else {
              <div class="health-row"><span>Connected apps</span><span class="settings-value">None. Agents stay in Echo only.</span></div>
            }
            <div class="health-row">
              <span><span [class]="'dot ' + (today()?.storage_connected ? 'ok' : 'bad')"></span> Call history</span>
              <span class="settings-value">{{ today()?.storage_connected ? 'Saved' : 'Not being saved. Live calls still work.' }}</span>
            </div>
          </div>
        </div>
      </div>

      <details class="card dev-card">
        <summary class="card-head"><span class="card-title"><app-icon name="server" [size]="14"></app-icon> Developer</span></summary>
        <div class="health-rows">
          <div class="health-row"><span>API</span><code>{{ apiBase }}</code></div>
          <div class="health-row"><span>Voice service</span><code>{{ api.webrtcBase }}</code></div>
          <div class="health-row"><span>Version</span><code>{{ healthData()?.version || '—' }}</code></div>
          <div class="health-row"><span>Round trip</span><code>{{ healthData() ? healthData().ms + ' ms' : 'unreachable' }}</code></div>
        </div>
      </details>
    </div>
  `,
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

  telephony = signal<any>(null);
  telephonyOk = computed(() => this.telephony()?.ozonetel_configured === true);
  private oznCampaigns = signal<any[]>([]);
  private agents = signal<any[]>([]);
  syncPlatforms = signal<{ platform_key: string; label: string }[]>([]);

  routes = computed(() =>
    this.oznCampaigns().map((c) => ({
      ...c,
      agents: this.agents().filter((a) => a.ozonetel_campaign === c.name).map((a) => a.label),
    })),
  );
  syncCounts = computed(() => {
    const list = this.agents();
    return {
      synced: list.filter((a) => a.sync_status === 'synced').length,
      pending: list.filter((a) => a.sync_status === 'pending').length,
      failed: list.filter((a) => a.sync_status === 'failed').length,
    };
  });
  roleWords = computed(() => ROLE_WORDS[this.auth.currentMembership()?.role || ''] || '—');
  extraAccess = computed(() =>
    [this.auth.me()?.platform_admin ? 'Platform admin (every workspace)' : '', this.auth.me()?.agent_admin ? 'Can edit every agent' : '']
      .filter(Boolean)
      .join(' · '),
  );

  ngOnInit(): void { this.loadAll(); }

  private async loadAll(): Promise<void> {
    this.api.webrtcHealth().then((h) => this.telephony.set(h?.telephony || {})).catch(() => this.telephony.set({}));
    this.api.ozonetelCampaigns(true).then((r) => this.oznCampaigns.set(r.campaigns || [])).catch(() => this.oznCampaigns.set([]));
    const orgId = this.auth.currentOrgId();
    if (orgId) this.api.orgSyncPlatforms(orgId).then((p) => this.syncPlatforms.set(p)).catch(() => this.syncPlatforms.set([]));
    try {
      const [tester, list] = await Promise.all([this.api.agents(), this.api.agentList()]);
      const route = new Map((tester || []).map((a: any) => [a.key, a.ozonetel_campaign]));
      this.agents.set((list.agents || []).map((a: any) => ({ ...a, ozonetel_campaign: route.get(a.key) || '' })));
    } catch { this.agents.set([]); }
  }

  switchOrg(orgId: string): void {
    this.auth.setCurrentOrg(orgId);
    window.location.reload();
  }

  refresh(): void {
    this.healthService.poll();
    this.loadAll();
  }
}
