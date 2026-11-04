import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CallPageComponent, CallPageSource } from '../../components/call-page/call-page.component';
import { ApiService } from '../../services/api.service';

/** /calls/:id — the one call page (same component as Clarix), fed by the Echo API. */
@Component({
  selector: 'app-call-page-route',
  standalone: true,
  imports: [CallPageComponent],
  template: `<div class="page"><app-call-page [source]="source"></app-call-page></div>`,
})
export class CallPageRouteComponent {
  private api = inject(ApiService);
  private router = inject(Router);
  readonly source: CallPageSource = {
    detail: (id) => this.api.callDetail(id),
    steps: (id) => this.api.callSteps(id),
    diagnostics: (id) => this.api.callDiagnostics(id),
    memory: (id) => this.api.callMemory(id),
    openSupplier: (phone) => this.router.navigate(['/suppliers', phone]),
    sendMessage: (id, m) => this.api.sendCallMessage(id, m),
    audio: (path) => this.api.recordingBlob(path),
    changeOutcome: (id, reason, note) => this.api.changeCallOutcome(id, reason, note),
    home: '/overview',
    base: '/calls',
  };
}
