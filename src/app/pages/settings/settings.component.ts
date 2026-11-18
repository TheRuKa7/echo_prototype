import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { HealthService } from '../../services/health.service';
import { ApiService } from '../../services/api.service';
import { API_BASE } from '../../core/endpoints';
import { CallingRulesComponent, CallingRulesSource, DncListComponent, DncSource } from '../../components/shared-screens/shared-screens';

type SettingsTab = 'status' | 'flows' | 'rules' | 'dnc';

/** Settings: workspace health, calling flows toggle, country calling rules, and DND registry. */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, CallingRulesComponent, DncListComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-sub">Backend connection, workspace calling flows, country rules and do-not-call list.</p>
        </div>
        <div class="seg" role="tablist" aria-label="Settings sections">
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'status'" [class.on]="tab() === 'status'" (click)="tab.set('status')">Status &amp; health</button>
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'flows'" [class.on]="tab() === 'flows'" (click)="openFlows()">Calling flows</button>
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'rules'" [class.on]="tab() === 'rules'" (click)="tab.set('rules')">Calling rules</button>
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'dnc'" [class.on]="tab() === 'dnc'" (click)="tab.set('dnc')">Do-not-call</button>
        </div>
      </div>

      @if (error()) { <div class="note bad">{{ error() }}</div> }

      @if (tab() === 'status') {
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
      }

      @if (tab() === 'flows') {
        <div class="card">
          <div class="card-head" style="gap:10px; flex-wrap:wrap">
            <div class="card-title">Calling flows <span class="pill" style="margin-left:6px">{{ enabledCount() }} on · {{ flows().length }} total</span></div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-left:auto">
              <input class="input" style="max-width:220px; min-height:30px" [ngModel]="flowQ()" (ngModelChange)="flowQ.set($event)" placeholder="Search flows or numbers…" aria-label="Search flows" />
              <div class="seg" role="group" aria-label="Show flows">
                <button type="button" [class.on]="flowFilter() === 'on'" (click)="flowFilter.set('on')">On ({{ enabledCount() }})</button>
                <button type="button" [class.on]="flowFilter() === 'all'" (click)="flowFilter.set('all')">All ({{ flows().length }})</button>
              </div>
            </div>
          </div>
          <div class="health-rows">
            @for (f of shownFlows(); track f.name) {
              <div class="health-row">
                <div style="min-width:0">
                  <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
                    <b class="mono">{{ f.name }}</b>
                    @if (f.did) { <span class="tag muted mono">{{ f.did }}</span> }
                    @if (f.type) { <span class="tag">{{ f.type }}</span> }
                  </div>
                  @if (f.used_by?.length) {
                    <div class="row-sub" style="margin-top:2px">Used by: {{ f.used_by.join(', ') }}</div>
                  }
                </div>
                <label class="vf-check" style="gap:8px; font-size:12px">
                  <input type="checkbox" [checked]="!!f.enabled" [disabled]="toggling() === f.name" (change)="toggleFlow(f, $any($event.target).checked)" />
                  <span>{{ f.enabled ? 'On for agents' : 'Off' }}</span>
                </label>
              </div>
            } @empty {
              <div class="empty-sub" style="padding:14px 16px">{{ flowsLoading() ? 'Loading calling flows…' : 'No calling flows match.' }}</div>
            }
          </div>
        </div>
      }

      @if (tab() === 'rules') {
        <app-calling-rules [source]="rulesSource"></app-calling-rules>
      }

      @if (tab() === 'dnc') {
        <app-dnc-list [source]="dncSource"></app-dnc-list>
      }
    </div>
  `,
})
export class SettingsComponent implements OnInit {
  auth = inject(AuthService);
  health = inject(HealthService);
  private api = inject(ApiService);
  private router = inject(Router);
  apiBase = API_BASE;
  h = this.health.health;
  tab = signal<SettingsTab>('status');
  error = signal('');
  org = computed(() => this.auth.currentMembership()?.org_name ? `${this.auth.currentMembership()?.org_name} (${this.auth.currentMembership()?.role})` : '—');
  isAgentAdmin = computed(() => !!this.auth.me()?.platform_admin || !!this.auth.me()?.agent_admin);

  flows = signal<any[]>([]);
  flowsLoading = signal(false);
  flowQ = signal('');
  flowFilter = signal<'on' | 'all'>('on');
  toggling = signal<string | null>(null);
  enabledCount = computed(() => this.flows().filter((f) => f.enabled).length);
  shownFlows = computed(() => {
    const q = this.flowQ().trim().toLowerCase();
    return this.flows()
      .filter((f) => this.flowFilter() === 'all' || f.enabled)
      .filter((f) => !q || `${f.name} ${f.did || ''} ${f.type || ''}`.toLowerCase().includes(q))
      .slice(0, 60);
  });

  readonly rulesSource: CallingRulesSource = {
    list: () => this.api.callingRules(),
    save: (code, rule) => this.api.saveCallingRule(code, rule),
    reset: (code) => this.api.resetCallingRule(code),
    preview: (rule, country, hour) => this.api.retryPreview(rule, country, hour),
  };
  readonly dncSource: DncSource = {
    load: (q) => this.api.dncLoad(q),
    add: (e) => this.api.dncAdd(e),
    remove: (phone, reason) => this.api.dncRemove(phone, reason),
    setAuto: (on) => this.api.dncAuto(on),
    openCall: (id) => this.router.navigate(['/calls', id]),
  };

  ngOnInit(): void {
    this.loadFlows();
  }

  openFlows(): void {
    this.tab.set('flows');
    if (!this.flows().length) this.loadFlows();
  }

  async loadFlows(): Promise<void> {
    const orgId = this.auth.currentOrgId();
    if (!orgId) return;
    this.flowsLoading.set(true);
    try {
      const res = await this.api.telephonyFlows(orgId);
      this.flows.set(res.flows || []);
    } catch {
      this.flows.set([]);
    } finally {
      this.flowsLoading.set(false);
    }
  }

  async toggleFlow(f: any, enabled: boolean): Promise<void> {
    const orgId = this.auth.currentOrgId();
    if (!orgId) return;
    this.toggling.set(f.name);
    this.error.set('');
    try {
      const updated = await this.api.setFlowEnabled(orgId, f.name, enabled);
      this.flows.update((list) => list.map((x) => (x.name === f.name ? updated : x)));
    } catch (e: any) {
      this.error.set(e.message || 'Could not update flow');
    } finally {
      this.toggling.set(null);
    }
  }
}
