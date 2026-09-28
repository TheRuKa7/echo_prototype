import { Component, inject, signal, OnInit, OnDestroy, ViewChild, ElementRef, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { ResponsesTableComponent } from './responses-table.component';
import { ContactsBrowserComponent } from './contacts-browser.component';
import { ColumnMappingComponent } from './column-mapping.component';

@Component({
  selector: 'app-campaign-detail',
  standalone: true,
  imports: [RouterLink, IconComponent, ResponsesTableComponent, ContactsBrowserComponent, ColumnMappingComponent],
  templateUrl: './campaign-detail.component.html',
})
export class CampaignDetailComponent implements OnInit, OnDestroy {
  api = inject(ApiService);
  private route = inject(ActivatedRoute);

  @ViewChild('inputRef') inputRef!: ElementRef<HTMLInputElement>;

  id = '';
  campaign = signal<any>(null);
  tab = signal<'responses' | 'contacts'>('responses');
  contacts = signal<any[]>([]);
  responses = signal<any[]>([]);
  error = signal('');
  busy = signal('');
  preview = signal<any>(null);
  confirmDial = signal(false);
  dialResult = signal<any>(null);

  private pollTimer: any = null;

  schema = computed(() => this.campaign()?.schema);
  outVars = computed(() => this.schema()?.output_variables || []);
  idLabel = computed(() => this.schema()?.primary_id_label || 'Primary id');
  captured = computed(() => this.responses().filter(r => r.status === 'captured').length);

  /** The agent's Ozonetel route — campaigns inherit it rather than owning one. */
  oznCampaign = computed(() => this.schema()?.ozonetel_campaign || '');

  /**
   * Whether any call has finished and reported. Gates the Responses tab and the
   * Results download: before the first one there is nothing to show, and an
   * empty results table reads as a failure rather than as "not yet".
   */
  hasResults = computed(() => this.captured() > 0);

  /** Falls back to contacts when the responses tab is hidden. */
  shownTab = computed(() => (this.tab() === 'responses' && !this.hasResults() ? 'contacts' : this.tab()));

  /**
   * Why the upload button is disabled, or '' when it is not.
   *
   * Both conditions are enforced by the backend too; stating them here turns a
   * 400 the operator would hit after picking a file into a sentence they can read
   * before doing so.
   */
  uploadBlockedReason = computed(() => {
    if (!this.campaign()) return '';
    if (!this.oznCampaign()) {
      return `${this.schema()?.label || 'This agent'} is not mapped to an Ozonetel campaign, so this campaign cannot be uploaded or dialled. Map it in the agent's settings.`;
    }
    if ((this.campaign().contacts_count ?? 0) > 0) {
      return 'This campaign already has its contact list. One campaign is one upload — create a new campaign to call another list.';
    }
    return '';
  });

  /**
   * The subset of uploadBlockedReason() worth a persistent red banner rather
   * than just the disabled button's tooltip. "Already has its contact list"
   * is the expected state of every campaign after its one upload — it isn't
   * a problem, so showing it as an alarm forever (including on a finished
   * campaign) is just noise. A missing Ozonetel mapping actually is a
   * problem (the campaign can never be dialled), so that one stays visible.
   */
  uploadBlockedBanner = computed(() =>
    this.campaign() && !this.oznCampaign() ? this.uploadBlockedReason() : '',
  );

  canUpload(): boolean {
    return !this.busy() && !this.uploadBlockedReason();
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.id = params.get('id') || '';
      if (this.id) this.load();
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  async load(): Promise<void> {
    try {
      const c = await this.api.campaign(this.id);
      this.campaign.set(c);
      const [ct, rs] = await Promise.all([this.api.campaignContacts(this.id), this.api.campaignResponses(this.id)]);
      this.contacts.set(ct.contacts || []);
      this.responses.set(rs.responses || []);
      this.error.set('');
      
      if (c.status === 'running' && !this.pollTimer) {
        this.pollTimer = setInterval(() => this.load(), 10000);
      } else if (c.status !== 'running') {
        this.stopPolling();
      }
    } catch (e: any) { this.error.set(e.message); }
  }

  stopPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  triggerUpload(): void { this.inputRef?.nativeElement?.click(); }

  async pick(file?: File): Promise<void> {
    this.error.set(''); this.preview.set(null);
    if (!file) return;
    if (!/\.xlsx?$|\.xlsm$/i.test(file.name)) {
      this.error.set('That file is not a spreadsheet. Upload the .xlsx template.');
      return;
    }
    this.busy.set('checking');
    try {
      const r = await this.api.uploadContacts(this.id, file, { dryRun: true });
      this.preview.set({ ...r, file });
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(''); }
  }

  /**
   * Store the list and dial it, using the mapping the operator confirmed.
   *
   * There is no store-without-dialling path, so this is the point of no return —
   * which is why the mapping screen sits in front of it rather than after.
   */
  async commitUpload(mapping: Record<string, number | null>): Promise<void> {
    const f = this.preview()?.file;
    if (!f) return;
    this.busy.set('dialling'); this.error.set('');
    try {
      const r = await this.api.uploadContacts(this.id, f, { dryRun: false, mapping });
      this.preview.set(null);
      if (this.inputRef?.nativeElement) this.inputRef.nativeElement.value = '';
      if (r.dial?.error) this.error.set(`Stored, but not dialled — ${r.dial.error}`);
      else if (r.dial?.dialled) this.dialResult.set(r.dial);
      // Contacts, not responses: nothing has been captured yet, and the responses
      // tab is hidden until something is.
      this.tab.set('contacts');
      await this.load();
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(''); }
  }

  /** Every captured response row as a CSV — the raw counterpart to the
   * server-formatted .xlsx "Results" download above. */
  downloadCampaignCsv(): void {
    const list = this.responses();
    if (!list.length) return;
    const campName = this.campaign()?.name || this.id;
    const vars = this.outVars();
    const headers = [this.idLabel(), 'Name', 'Phone', 'Status', 'Captured', 'Call ID', ...vars.map((v: any) => v.label)];
    const rows = list.map((r: any) => [
      r.primary_id ?? '',
      r.name ?? '',
      r.phone ?? '',
      r.status ?? '',
      r.captured_at ?? '',
      r.call_id ?? '',
      ...vars.map((v: any) => {
        const val = r.outputs?.[v.key];
        return val === undefined || val === null || val === '' ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
      }),
    ]);
    const csv = '﻿' + [headers, ...rows]
      .map((row) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campaign-${campName.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Every transcript and recording as one zip, from the server — unlike the
   * CSV above this can't be built client-side, so it's a real network
   * request. Fetched (not a bare `<a href download>`) specifically so a slow
   * or near-empty export doesn't show the browser's own tab-loading spinner
   * next to the page title; the button's own busy state covers that instead.
   */
  async downloadCampaignZip(): Promise<void> {
    this.busy.set('exporting');
    this.error.set('');
    try {
      const res = await fetch(this.api.campaignExportUrl(this.id));
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const campName = this.campaign()?.name || this.id;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campaign-${campName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      this.error.set(e.message || 'Could not export transcripts and audio');
    } finally {
      this.busy.set('');
    }
  }

  async dial(): Promise<void> {
    this.busy.set('dialling'); this.error.set('');
    try {
      const r = await this.api.dialCampaign(this.id);
      this.dialResult.set(r);
      this.confirmDial.set(false);
      await this.load();
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(''); }
  }
}
