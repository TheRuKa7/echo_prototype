import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';
import { AgentSyncMenuComponent, SyncPlatformOption } from './agent-sync-menu.component';

@Component({
  selector: 'app-agents',
  standalone: true,
  imports: [FormsModule, IconComponent, AgentSyncMenuComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="page-title">Agents</div>
          <div class="page-sub">
            Each agent owns its prompt, the inputs it expects per call, and the
            values it reports when the call ends.
          </div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" (click)="creating.set(!creating())">
            <app-icon name="plus" [size]="14"></app-icon>
            New agent
          </button>
        </div>
      </div>

      @if (!storage()) {
        <div class="note bad">
          MongoDB is unreachable, so agents can be run but not created or edited.
          Check <span class="mono">MONGO_URI</span> in backend/.env.
        </div>
      }
      @if (error()) { <div class="note bad">{{ error() }}</div> }

      @if (creating()) {
        <div class="card">
          <div class="card-head">
            <div class="card-title">New agent</div>
          </div>
          <div class="card-body">
            <form (ngSubmit)="create()">
              <div class="fields campaign-form">
                <label class="field">
                  <span class="field-label">Name</span>
                  <input class="input" autofocus [(ngModel)]="label" name="label" placeholder="Order payment follow-up" />
                </label>
                <label class="field">
                  <span class="field-label">Start from</span>
                  <select class="select" [(ngModel)]="copyFrom" name="copyFrom">
                    <option value="">Blank agent</option>
                    @for (a of agents(); track a.key) {
                      <option [value]="a.key">Copy of {{ a.label }}</option>
                    }
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">Description</span>
                  <input class="input" [(ngModel)]="description" name="description" placeholder="What this agent is for" />
                </label>
                <label class="field">
                  <span class="field-label">Ozonetel campaign</span>
                  <select class="select" [(ngModel)]="oznCampaign" name="oznCampaign">
                    <option value="">{{ oznCampaigns().length ? 'Select a campaign…' : 'None available' }}</option>
                    @for (c of oznCampaigns(); track c.name) {
                      <option [value]="c.name">{{ c.name }}{{ c.type ? ' — ' + c.type : '' }}{{ c.did ? ' · ' + c.did : '' }}</option>
                    }
                  </select>
                  <span class="hint" style="margin: 2px 0 0">
                    Where this agent's calls are queued. Campaigns running this agent
                    inherit it, and cannot upload contacts until it is set.
                  </span>
                </label>
              </div>
              @if (oznError()) { <div class="note bad">Could not load Ozonetel campaigns: {{ oznError() }}</div> }
              <div class="hint">
                {{ copyFrom()
                  ? 'Copies that agent’s prompts, input variables and output variables — edit them on the next screen.'
                  : 'Creates an empty agent. Add a prompt and its variables on the next screen.' }}
              </div>
              <div class="page-actions" style="margin-top: 14px">
                <button class="btn btn-primary" [disabled]="busy() || !label().trim()">
                  {{ busy() ? 'Creating…' : 'Create agent' }}
                </button>
                <button type="button" class="btn" (click)="creating.set(false)">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      }

      <div class="card">
        <div class="card-head">
          <div class="card-title">{{ agents().length }} agents</div>
        </div>
        @if (loading()) {
          <div class="card-body">Loading…</div>
        } @else if (agents().length === 0) {
          <div class="empty">
            <div class="empty-icon"><app-icon name="bot" [size]="22"></app-icon></div>
            <div class="empty-title">No agents yet</div>
            <div class="empty-sub">Create one to give the console something to run.</div>
          </div>
        } @else {
          <div class="scroll-x">
            <div class="grid-head" [style.grid-template-columns]="cols()">
              <span>Agent</span><span>Models</span><span>Inputs</span><span>Outputs</span><span>Primary id</span>
              @if (syncPlatforms().length) { <span></span> }
            </div>
            @for (a of agents(); track a.key; let i = $index) {
              <div
                class="grid-row clickable"
                [style.grid-template-columns]="cols()"
                [style.animation-delay]="(i < 12 ? i * 20 : 240) + 'ms'"
                (click)="navTo(a.key)"
              >
                <span style="min-width: 0">
                  <div class="row-title">{{ a.label }}</div>
                  <div class="row-sub mono">{{ a.key }}</div>
                </span>
                <span class="chip-row" style="margin-top: 0">
                  @if (a.providers.length === 0) {
                    <span class="row-sub">No prompt yet</span>
                  } @else {
                    @for (p of a.providers; track p) {
                      <span class="chip">{{ providerLabel(p) }}</span>
                    }
                  }
                </span>
                <span>{{ a.input_count }}</span>
                <span [class]="a.output_count ? 'good' : ''">{{ a.output_count }}</span>
                <span class="mono row-sub">{{ a.primary_id_key || '—' }}</span>
                @if (syncPlatforms().length) {
                  <span style="display: flex; justify-content: flex-end">
                    <app-agent-sync-menu
                      [agentKey]="a.key"
                      [syncedPlatform]="a.synced_platform"
                      [syncStatus]="a.sync_status"
                      [lastError]="a.sync_last_error"
                      [platforms]="syncPlatforms()"
                      (synced)="onAgentSynced(a, $event)"
                    ></app-agent-sync-menu>
                  </span>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class AgentsComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  /** Extra trailing column for the Sync menu, only when this org has a third
   * party configured at all — otherwise the feature doesn't exist here. */
  cols(): string {
    return this.syncPlatforms().length ? '1.6fr 1.3fr 90px 90px 1fr 90px' : '1.6fr 1.3fr 90px 90px 1fr';
  }

  agents = signal<any[]>([]);
  meta = signal<any>(null);
  storage = signal(true);
  loading = signal(true);
  error = signal('');
  syncPlatforms = signal<SyncPlatformOption[]>([]);

  creating = signal(false);
  label = signal('');
  description = signal('');
  copyFrom = signal('');
  oznCampaign = signal('');
  oznCampaigns = signal<any[]>([]);
  oznError = signal('');
  busy = signal(false);

  ngOnInit(): void { this.load(); this.loadOzonetel(); this.loadSyncPlatforms(); }

  async loadSyncPlatforms(): Promise<void> {
    const orgId = this.auth.currentOrgId();
    if (!orgId) return;
    try {
      this.syncPlatforms.set(await this.api.orgSyncPlatforms(orgId));
    } catch {
      // No third party configured (or not permitted) reads the same as none
      // available — Sync just doesn't show up, no error banner for this.
      this.syncPlatforms.set([]);
    }
  }

  /** Patches the one row locally instead of reloading the whole list. Matches
   * what the backend just set: freshly armed, not yet actually delivered —
   * the poller flips it to 'synced'/'failed' on its next tick. */
  onAgentSynced(agent: any, platformKey: string): void {
    this.agents.update((list) =>
      list.map((a) =>
        a.key === agent.key
          ? { ...a, synced_platform: platformKey, sync_status: 'pending', sync_last_error: null }
          : a,
      ),
    );
  }

  async loadOzonetel(): Promise<void> {
    try {
      this.oznCampaigns.set((await this.api.ozonetelCampaigns(true)).campaigns || []);
      this.oznError.set('');
    } catch (e: any) {
      this.oznCampaigns.set([]);
      this.oznError.set(e.message);
    }
  }

  async load(): Promise<void> {
    try {
      const [list, m] = await Promise.all([this.api.agentList(), this.api.agentMeta()]);
      this.agents.set(list.agents || []);
      this.storage.set(list.storage_connected !== false);
      this.meta.set(m);
      this.error.set('');
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }

  async create(): Promise<void> {
    const l = this.label().trim();
    if (!l) return;
    this.busy.set(true);
    try {
      const out = await this.api.createAgent({
        label: l,
        description: this.description().trim(),
        copy_from: this.copyFrom() || undefined,
        ozonetel_campaign: this.oznCampaign(),
        ozonetel_type: this.oznCampaigns().find((c) => c.name === this.oznCampaign())?.type || '',
      });
      this.router.navigate(['/agents', out.agent.key]);
    } catch (err: any) {
      this.error.set(err.message);
      this.busy.set(false);
    }
  }

  navTo(key: string): void { this.router.navigate(['/agents', key]); }

  providerLabel(p: string): string {
    return this.meta()?.providers?.find((x: any) => x.key === p)?.label || p;
  }
}
