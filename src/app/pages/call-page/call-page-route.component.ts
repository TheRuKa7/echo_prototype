import { Component, inject } from '@angular/core';
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
  readonly source: CallPageSource = {
    detail: (id) => this.api.callDetail(id),
    steps: (id) => this.api.callSteps(id),
    sendMessage: (id, m) => this.api.sendCallMessage(id, m),
    audio: (path) => this.api.recordingBlob(path),
    changeOutcome: (id, reason, note) => this.api.changeCallOutcome(id, reason, note),
    home: '/overview',
    base: '/calls',
  };
}
