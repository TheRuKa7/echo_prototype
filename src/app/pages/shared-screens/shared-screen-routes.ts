import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { CallingReportComponent, CallingReportSource } from '../../components/calling-report/calling-report.component';
import { SupplierPageComponent, SupplierSource, CampaignPageComponent, CampaignsListComponent, CampaignsSource, FollowUpsListComponent, FollowUpsSource } from '../../components/shared-screens/shared-screens';
import { CampaignWizardSource } from '../../components/shared-screens/new-campaign-modal';

/** Echo's wiring for the screens it shares with Clarix (same components, Echo API). */
function reportSource(api: ApiService, router: Router): CallingReportSource {
  return {
    report: (sc, f) => api.callingReport(sc, f),
    calls: (sc, box, skip, limit, f) => api.callingReportCalls(sc, box, skip, limit, f),
    exportXlsx: (sc, box, f) => api.callingReportExport(sc, box, f),
    rerun: (sc, box, f) => api.rerunCalls(sc, box, f),
    values: (sc, box, f, col, q) => api.reportColumnValues(sc, box, f, col, q),
    openCall: (row) => router.navigate(['/calls', row.id]),
  };
}
const ALL = () => ({ period: 'all' as const, from: new Date(0).toISOString(), to: new Date().toISOString(), days: 0, agents: [], includeTests: false });
/** New campaign: one modal, upload and check, then schedule. */
function wizardSource(api: ApiService, router: Router): CampaignWizardSource {
  return {
    agents: () => api.newCampaignAgents(), template: (a) => api.newCampaignTemplate(a), check: (a, f) => api.newCampaignPost('check', a, f),
    countries: async () => ((await api.callingRules()).countries as { code: string; name: string; tz_label: string; law?: string }[]).map((c) => ({ code: c.code, name: c.name, tz_label: c.tz_label, law: c.law })),
    slots: (a, c, d) => api.newCampaignSlots(a, c, d), estimate: (b) => api.newCampaignEstimate(b), badRows: (cols, rows) => api.newCampaignBadRows(cols, rows),
    start: (a, f, o) => api.newCampaignPost('start', a, f, o), opened: (id) => { router.navigate(['/campaigns', id]); },
  };
}
function campaignsSource(api: ApiService, router: Router): CampaignsSource {
  return {
    list: (p) => api.reportCampaigns(p), get: (id) => api.reportCampaign(id), stop: (id) => api.stopReportCampaign(id), resume: (id) => api.resumeReportCampaign(id),
    results: (id) => api.callingReportExport({ ...ALL(), campaign: id } as any, 'uploaded'),
    open: (c) => router.navigate(['/campaigns', c.campaign_id]), newCampaign: () => router.navigate(['/campaigns/new']),
    wizard: wizardSource(api, router), report: reportSource(api, router), listPath: '/campaigns',
  };
}

@Component({ selector: 'app-echo-call-logs', standalone: true, imports: [CallingReportComponent],
  template: `<div class="page"><div class="page-head"><h1 class="page-title">Call logs</h1></div><app-calling-report mode="log" [source]="source"></app-calling-report></div>` })
export class EchoCallLogsPage { readonly source = reportSource(inject(ApiService), inject(Router)); }

@Component({ selector: 'app-echo-campaigns', standalone: true, imports: [CampaignsListComponent], template: `<div class="page"><app-campaigns-list [source]="source"></app-campaigns-list></div>` })
export class EchoCampaignsPage { readonly source = campaignsSource(inject(ApiService), inject(Router)); }

@Component({ selector: 'app-echo-campaign', standalone: true, imports: [CampaignPageComponent], template: `<div class="page"><app-campaign-page [source]="source"></app-campaign-page></div>` })
export class EchoCampaignPage { readonly source = campaignsSource(inject(ApiService), inject(Router)); }

@Component({ selector: 'app-echo-new-campaign', standalone: true, imports: [CampaignsListComponent], template: `<div class="page"><app-campaigns-list [source]="source" [startOpen]="true"></app-campaigns-list></div>` })
export class EchoNewCampaignPage { readonly source = campaignsSource(inject(ApiService), inject(Router)); }

@Component({ selector: 'app-echo-follow-ups', standalone: true, imports: [FollowUpsListComponent], template: `<div class="page"><app-follow-ups-list [source]="source"></app-follow-ups-list></div>` })
export class EchoFollowUpsPage {
  private api = inject(ApiService); private router = inject(Router);
  readonly source: FollowUpsSource = {
    list: (p) => this.api.actionNeeded(p), act: (id, a) => this.api.actionAct(id, a), exportXlsx: (p) => this.api.actionExport(p),
    bulk: (ids, a) => this.api.actionBulk(ids, a), openSupplier: (phone) => this.router.navigate(['/suppliers', phone]),
    openCall: (row) => this.router.navigate(['/calls', row.id]),
  };
}

@Component({ selector: 'app-echo-supplier', standalone: true, imports: [SupplierPageComponent], template: `<div class="page"><app-supplier-page [source]="source"></app-supplier-page></div>` })
export class EchoSupplierPage {
  private api = inject(ApiService); private router = inject(Router);
  /** Supplier 360: every call, PO, promise and open action for one number. */
  readonly source: SupplierSource = { load: (p) => this.api.supplier(p), openCall: (id) => this.router.navigate(['/calls', id]), openActions: () => this.router.navigate(['/follow-ups']), back: () => history.back() };
}
