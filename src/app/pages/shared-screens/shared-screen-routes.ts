import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { CallingReportComponent, CallingReportSource } from '../../components/calling-report/calling-report.component';
import { CampaignPageComponent, CampaignsListComponent, CampaignsSource, FollowUpsListComponent, FollowUpsSource, NewCampaignComponent, NewCampaignSource } from '../../components/shared-screens/shared-screens';

/** Echo's wiring for the screens it shares with Clarix (same components, Echo API). */
function reportSource(api: ApiService, router: Router): CallingReportSource {
  return {
    report: (sc, f) => api.callingReport(sc, f),
    calls: (sc, box, skip, limit, f) => api.callingReportCalls(sc, box, skip, limit, f),
    exportXlsx: (sc, box, f) => api.callingReportExport(sc, box, f),
    values: (sc, box, f, col) => api.reportColumnValues(sc, box, f, col),
    openCall: (row) => router.navigate(['/calls', row.id]),
  };
}
const ALL = () => ({ period: 'all' as const, from: new Date(0).toISOString(), to: new Date().toISOString(), days: 0, agents: [], includeTests: false });
function campaignsSource(api: ApiService, router: Router): CampaignsSource {
  return {
    list: (p) => api.reportCampaigns(p), get: (id) => api.reportCampaign(id), stop: (id) => api.stopReportCampaign(id),
    results: (id) => api.callingReportExport({ ...ALL(), campaign: id } as any, 'uploaded'),
    open: (c) => router.navigate(['/campaigns', c.campaign_id]), newCampaign: () => router.navigate(['/campaigns/new']),
    report: reportSource(api, router), listPath: '/campaigns',
  };
}

@Component({ selector: 'app-echo-call-logs', standalone: true, imports: [CallingReportComponent],
  template: `<div class="page"><div class="page-head"><h1 class="page-title">Call logs</h1></div><app-calling-report mode="log" [source]="source"></app-calling-report></div>` })
export class EchoCallLogsPage { readonly source = reportSource(inject(ApiService), inject(Router)); }

@Component({ selector: 'app-echo-campaigns', standalone: true, imports: [CampaignsListComponent], template: `<div class="page"><app-campaigns-list [source]="source"></app-campaigns-list></div>` })
export class EchoCampaignsPage { readonly source = campaignsSource(inject(ApiService), inject(Router)); }

@Component({ selector: 'app-echo-campaign', standalone: true, imports: [CampaignPageComponent], template: `<div class="page"><app-campaign-page [source]="source"></app-campaign-page></div>` })
export class EchoCampaignPage { readonly source = campaignsSource(inject(ApiService), inject(Router)); }

@Component({ selector: 'app-echo-new-campaign', standalone: true, imports: [NewCampaignComponent], template: `<div class="page"><app-new-campaign [source]="source"></app-new-campaign></div>` })
export class EchoNewCampaignPage {
  private api = inject(ApiService); private router = inject(Router);
  readonly source: NewCampaignSource = {
    agents: () => this.api.newCampaignAgents(), template: (a) => this.api.newCampaignTemplate(a),
    check: (a, f) => this.api.newCampaignPost('check', a, f), start: (a, f) => this.api.newCampaignPost('start', a, f),
    tips: (a) => this.api.newCampaignTips(a), retryRules: () => this.api.retryRules(), saveRetryRule: (a, r) => this.api.saveRetryRule(a, r),
    opened: (id) => this.router.navigate(['/campaigns', id]), cancel: () => this.router.navigate(['/campaigns']),
  };
}

@Component({ selector: 'app-echo-follow-ups', standalone: true, imports: [FollowUpsListComponent], template: `<div class="page"><app-follow-ups-list [source]="source"></app-follow-ups-list></div>` })
export class EchoFollowUpsPage {
  private api = inject(ApiService); private router = inject(Router);
  readonly source: FollowUpsSource = {
    list: (show, kind) => this.api.followChecklist(show, kind), act: (id, a) => this.api.reportFollowUpAct(id, a), exportXlsx: (show, kind) => this.api.followChecklistExport(show, kind),
    openCall: (row) => this.router.navigate(['/calls', row.id]),
  };
}
