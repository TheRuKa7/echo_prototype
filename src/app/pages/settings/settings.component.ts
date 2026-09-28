import { Component, inject, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../components/icon/icon.component';
import { HealthService } from '../../services/health.service';
import { AuthService } from '../../services/auth.service';
import { API_BASE } from '../../core/endpoints';

/**
 * Where the operator-facing diagnostics live now.
 *
 * These used to sit in the header on every page — a latency figure and two
 * dependency lamps that only matter when something is wrong. They are read
 * deliberately, not glanced at, so they belong behind a click.
 *
 * HealthService is a root singleton polling on its own 15s interval, so this
 * page only reads its signals; navigating here starts nothing and leaving it
 * stops nothing.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent, FormsModule],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-sub">Backend connection and dependency status.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <span class="card-title">
            <app-icon name="user" [size]="14"></app-icon>
            Organization
          </span>
        </div>
        <div class="health-rows">
          <div class="health-row">
            <span>Signed in as</span>
            <code>{{ auth.me()?.email || '—' }}</code>
          </div>
          @if (memberships().length > 1) {
            <div class="health-row">
              <span>Current organization</span>
              <select class="input" style="width: auto" [ngModel]="auth.currentOrgId()" (ngModelChange)="switchOrg($event)">
                @for (m of memberships(); track m.org_id) {
                  <option [value]="m.org_id">{{ m.org_name }} ({{ m.role }})</option>
                }
              </select>
            </div>
          } @else {
            <div class="health-row">
              <span>Organization</span>
              <code>{{ orgLabel() }}</code>
            </div>
          }
          @if (auth.me()?.platform_admin) {
            <div class="health-row"><span>Platform admin</span><code>yes</code></div>
          }
          @if (auth.me()?.agent_admin) {
            <div class="health-row"><span>Agent admin</span><code>yes</code></div>
          }
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <span class="card-title">
            <app-icon name="activity" [size]="14"></app-icon>
            System health
          </span>
          <button class="btn btn-sm" (click)="refresh()">Refresh</button>
        </div>

        <div class="health-grid">
          @for (l of lamps(); track l.name) {
            <div class="health-card">
              <div class="health-card-head">
                <span [class]="'dot ' + l.state"></span>
                <span class="health-card-name">{{ l.name }}</span>
              </div>
              <div class="health-card-value mono">{{ l.value }}</div>
              <div class="health-card-note">{{ l.note }}</div>
            </div>
          }
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <span class="card-title">
            <app-icon name="link" [size]="14"></app-icon>
            Backend
          </span>
        </div>
        <div class="health-rows">
          <div class="health-row">
            <span>API base</span>
            <code>{{ apiBase }}</code>
          </div>
          @if (healthData()?.base_url) {
            <div class="health-row">
              <span>Reported base URL</span>
              <code>{{ healthData().base_url }}</code>
            </div>
          }
          <div class="health-row">
            <span>Version</span>
            <code>{{ healthData()?.version || '—' }}</code>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SettingsComponent {
  private healthService = inject(HealthService);
  auth = inject(AuthService);
  apiBase = API_BASE || window.location.origin;
  healthData = this.healthService.health;
  today = this.healthService.todayMetrics;
  memberships = computed(() => this.auth.me()?.memberships || []);
  orgLabel = computed(() => {
    const m = this.auth.currentMembership();
    return m ? `${m.org_name} (${m.role})` : '—';
  });
  switchOrg(orgId: string): void {
    this.auth.setCurrentOrg(orgId);
    // Simplest correct reset: every dataload-backed list/detail view refetches
    // under the new org rather than trying to invalidate each one by hand.
    window.location.reload();
  }

  /** Same three checks the header used to show, with room for a real label. */
  lamps = computed(() => {
    const h = this.healthData();
    const tel = h?.telephony || {};
    const t = this.today();
    return [
      {
        name: 'Backend',
        state: h ? 'ok' : 'bad',
        value: h ? `${h.ms}ms` : 'unreachable',
        note: h ? 'round-trip to /health' : 'the API did not respond',
      },
      {
        name: 'Ozonetel',
        state: tel.ozonetel_configured ? 'ok' : '',
        value: tel.ozonetel_configured ? 'ready' : 'not configured',
        note: tel.ozonetel_configured
          ? 'credentials present — outbound calls can be placed'
          : 'set OZONETEL_API_KEY and OZONETEL_USER_NAME',
      },
      {
        name: 'Storage',
        state: t?.storage_connected ? 'ok' : 'bad',
        value: t?.storage_connected ? 'mongo' : 'down',
        note: t?.storage_connected
          ? 'call history and campaigns are being saved'
          : 'live calls still work; finished ones are not saved',
      },
    ];
  });

  refresh(): void {
    this.healthService.poll();
  }
}
