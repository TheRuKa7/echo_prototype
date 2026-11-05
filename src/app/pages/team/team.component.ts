import { Component, inject } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { AccessComponent, AccessSource } from '../../components/shared-screens/shared-screens';

/** Team and access: the org, its sub-orgs and teams, people, roles and user types (the screen Clarix shares). */
@Component({
  selector: 'app-team',
  standalone: true,
  imports: [AccessComponent],
  template: `<div class="page"><app-access [source]="source" [page]="true"></app-access></div>`,
})
export class TeamComponent {
  private api = inject(ApiService);
  readonly source: AccessSource = {
    load: (as) => this.api.access(as), create: (k, b, as) => this.api.accessSend('POST', k, b, as),
    update: (k, id, b, as) => this.api.accessSend('PUT', `${k}/${encodeURIComponent(id)}`, b, as), remove: (k, id, as) => this.api.accessSend('DELETE', `${k}/${encodeURIComponent(id)}`, {}, as),
  };
}
