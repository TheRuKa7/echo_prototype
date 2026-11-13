import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { HealthService } from '../../services/health.service';
import { API_BASE } from '../../core/endpoints';

/** Settings, as in Echo QA: who you are in which organization, and whether the backend and its dependencies are up. */
@Component({
  selector: 'app-settings',
  standalone: true,
  template: `
    <div class="page">
      <div class="page-head"><h1 class="page-title">Settings</h1><p class="page-sub">Backend connection and dependency status.</p></div>

      <div class="card" style="margin-bottom: 16px">
        <div class="card-head"><div class="card-title">Organization</div></div>
        <div class="card-body settings-tab">
          <div class="set-grid">
            <div class="field"><span class="field-label">Signed in as</span><code>{{ auth.me()?.email || '—' }}</code></div>
            <div class="field"><span class="field-label">Organization</span><span>{{ org() }}</span></div>
            <div class="field"><span class="field-label">Agent admin</span><span>{{ isAgentAdmin() ? 'yes' : 'no' }}</span></div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px">
        <div class="card-head">
          <div class="card-title">System health</div>
          <button type="button" class="btn btn-sm" (click)="health.poll()">Refresh</button>
        </div>
        <div class="card-body settings-tab">
          <div class="set-grid">
            <div class="field"><span class="field-label">Backend</span>
              @if (h(); as hh) { <span>{{ hh.ms }}ms round-trip to /health</span> } @else { <span class="bad-text">Not reachable</span> }
            </div>
            <div class="field"><span class="field-label">Ozonetel</span>
              <span>{{ h()?.ozonetel?.configured === false ? 'not configured' : 'configured' }}</span>
              @if (h()?.ozonetel?.configured === false) { <span class="row-sub">set OZONETEL_API_KEY and OZONETEL_USER_NAME</span> }
            </div>
            <div class="field"><span class="field-label">Storage</span>
              <span>{{ h()?.storage || 'mongo' }}</span>
              <span class="row-sub">call history and campaigns are being saved</span>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Backend API</div></div>
        <div class="card-body settings-tab">
          <div class="set-grid">
            <div class="field"><span class="field-label">Base</span><code>{{ apiBase }}</code></div>
            <div class="field"><span class="field-label">Version</span><span>{{ h()?.version || '—' }}</span></div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SettingsComponent {
  auth = inject(AuthService);
  health = inject(HealthService);
  apiBase = API_BASE;
  h = this.health.health;
  org = computed(() => this.auth.currentMembership()?.org_name ? `${this.auth.currentMembership()?.org_name} (${this.auth.currentMembership()?.role})` : '—');
  isAgentAdmin = computed(() => !!this.auth.me()?.platform_admin || !!this.auth.me()?.agent_admin);
}
