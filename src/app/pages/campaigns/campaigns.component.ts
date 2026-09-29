import { campaignStatus } from '../../utils/status';
import { ConfirmComponent } from '../../components/confirm/confirm.component';
import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { fmtTime } from '../../utils/format';

@Component({
  selector: 'app-campaigns',
  standalone: true,
  imports: [FormsModule, IconComponent, ConfirmComponent, RouterLink],
  templateUrl: './campaigns.component.html',
})
export class CampaignsComponent implements OnInit {
  api = inject(ApiService);
  router = inject(Router);

  COLS = 'minmax(180px, 1.4fr) minmax(150px, 1fr) 96px 96px 108px 150px 40px';
  fmtTime = fmtTime;

  /** completed/failed are derived server-side once dialling has actually
   * concluded — see CampaignsServiceImpl.deriveStatus. Everything else
   * keeps the plain grey tag. */
  private static readonly STATUS_CLASS: Record<string, string> = {
    running: 'busy',
    ready: 'ok',
    completed: 'ok',
    failed: 'bad',
  };
  statusClass(status: string): string {
    return CampaignsComponent.STATUS_CLASS[status] || '';
  }

  campaigns = signal<any[]>([]);
  agents = signal<any[]>([]);
  loading = signal(true);
  error = signal('');
  storage = signal(true);

  creating = signal(false);
  agent = signal('');
  provider = signal('');
  busy = signal(false);
  deleting = signal('');
  exporting = signal('');
  direction = signal('outbound');
  description = signal('');


  ngOnInit(): void {
    this.load();
    this.api.agents().then(list => {
      this.agents.set(list);
      if (list[0]) {
        this.agent.set(list[0].key);
        this.provider.set(this.pickProvider(list[0]));
      }
    }).catch(e => this.error.set(`Could not load agents: ${e.message}`));
  }

  q = signal('');
  statusFilter = signal<'all' | 'open' | 'done'>('all');
  sourceFilter = signal<'all' | 'clarix' | 'internal'>('all');
  deletingAsk = signal<any>(null);
  openCount = computed(() => this.campaigns().filter((c) => !campaignStatus(c.status).final).length);
  shown = computed(() => {
    const term = this.q().trim().toLowerCase();
    return this.campaigns()
      .filter((c) => this.statusFilter() === 'all' || (this.statusFilter() === 'open') === !campaignStatus(c.status).final)
      .filter((c) => this.sourceFilter() === 'all' || (this.sourceFilter() === 'clarix' ? c.source === 'clarix' : c.source !== 'clarix'))
      .filter((c) => !term || [c.name, c.description, c.schema?.label, c.agent].some((v) => (v || '').toLowerCase().includes(term)));
  });
  label = campaignStatus;
  /** Rows that reached a person or machine. New backends send counts; older ones only responses_count. */
  reachedOf(c: any): number {
    if (!c.counts) return c.responses_count ?? 0;
    return Object.entries(c.counts).filter(([k]) => k.startsWith('completed')).reduce((n, [, v]) => n + (v as number), 0);
  }

  async load(): Promise<void> {
    try {
      const r = await this.api.campaigns();
      this.campaigns.set(r.campaigns || []);
      this.storage.set(r.storage_connected !== false);
      this.error.set('');
    } catch (e: any) { this.error.set(e.message); }
    finally { this.loading.set(false); }
  }

  async toggleCreating(): Promise<void> {
    this.creating.set(!this.creating());
  }

  // The Ozonetel campaign list used to be loaded here to populate a picker. The
  // route now belongs to the agent, so there is nothing on this screen to pick.
  onDirectionChange(): void {}

  onAgentChange(val: string): void {
    this.agent.set(val);
    this.provider.set(this.pickProvider(this.agents().find(x => x.key === val)));
  }

  /**
   * Gemini, unless this agent has no Gemini prompt.
   *
   * The model is no longer an operator choice, but the backend still rejects a
   * campaign whose agent has no prompt for the provider it was created with —
   * so falling back to whatever the agent does support keeps that from becoming
   * an unexplained 400 on a screen with no model field to correct.
   */
  private pickProvider(agent: any): string {
    const keys = (agent?.providers || []).map((p: any) => p.key);
    return keys.includes('gemini') ? 'gemini' : keys[0] || 'gemini';
  }

  currentAgent(): any { return this.agents().find(a => a.key === this.agent()); }

  /**
   * Why "New campaign" is disabled, for its tooltip.
   *
   * The button needs an agent to run, and it is disabled on an empty agent list
   * — but "empty" has two very different causes, and a greyed-out button with no
   * explanation looks like the page failed rather than like there is nothing to
   * create a campaign from yet.
   */
  createBlockedReason(): string {
    if (this.agents().length) return '';
    return 'No agents available from the live-call service — nothing to run a campaign with';
  }

  /**
   * Delete a campaign from the list it appears in.
   *
   * The confirmation names what goes with it, because it is not just the
   * campaign row: the backend deletes the uploaded contacts and every captured
   * answer under it, and a campaign that has results is usually the one nobody
   * meant to remove.
   */
  async remove(campaign: any): Promise<void> {
    const captured = campaign.responses_count ?? 0;
    const extra = captured
      ? `\n\nThis campaign has ${captured} captured result${captured === 1 ? '' : 's'}. Deleting it removes them too, and they cannot be recovered.`
      : '';
    void extra;
    this.deleting.set(campaign.campaign_id);
    this.error.set('');
    try {
      await this.api.deleteCampaign(campaign.campaign_id);
      this.deletingAsk.set(null);
      await this.load();
    } catch (e: any) { this.error.set(e.message); }
    finally { this.deleting.set(''); }
  }

  /**
   * One-click CSV of a campaign's captured responses, straight from the list —
   * no need to open the campaign first. Columns are whatever output keys the
   * responses actually carry, since this list doesn't preload the agent schema.
   */
  async downloadCampaignReport(c: any): Promise<void> {
    this.exporting.set(c.campaign_id);
    try {
      const r = await this.api.campaignResponses(c.campaign_id);
      const rows: any[] = r.responses || [];
      if (!rows.length) return;
      const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row.outputs || {}))));
      const headers = ['Primary ID', 'Name', 'Phone', 'Status', 'Captured', 'Call ID', ...keys];
      const csvRows = rows.map((row) => [
        row.primary_id ?? '',
        row.name ?? '',
        row.phone ?? '',
        row.status ?? '',
        row.captured_at ?? '',
        row.call_id ?? '',
        ...keys.map((k) => {
          const val = row.outputs?.[k];
          return val === undefined || val === null || val === '' ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
        }),
      ]);
      const csv = '﻿' + [headers, ...csvRows]
        .map((row) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campaign-${c.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.exporting.set('');
    }
  }

  /** What the campaign will be called — the backend builds the same string. */
  previewName(): string {
    const label = this.currentAgent()?.label || 'Agent';
    const t = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${label} - ${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  }

  async create(): Promise<void> {
    if (!this.agent()) return;
    this.busy.set(true); this.error.set('');
    try {
      // No name: the backend names it "[Agent] - [timestamp]" so the two cannot
      // disagree about the clock. Ozonetel routing comes from the agent.
      const created = await this.api.createCampaign({
        agent: this.agent(),
        provider: this.provider(),
        direction: this.direction(),
        description: this.description().trim(),
      });

      this.creating.set(false);
      this.description.set('');
      await this.load();
      this.router.navigate(['/campaigns', created.campaign_id]);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }
}
