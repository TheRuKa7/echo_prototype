import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="gate">
      <form class="gate-card" (ngSubmit)="submit()">
        <div style="margin-left: -18px; margin-top: -8px">
          <div class="brand">
            <div class="brand-mark"><app-icon name="wave" [size]="16"></app-icon></div>
            <div>
              <div class="brand-name">Exchange</div>
              <div class="brand-sub">VOICE AGENT CONSOLE</div>
            </div>
          </div>
        </div>
        <div class="field" style="margin-top: 10px">
          <label class="field-label" for="email">Email</label>
          <input
            id="email"
            class="input"
            type="email"
            autofocus
            [(ngModel)]="email"
            name="email"
            placeholder="you@moglix.com"
          />
        </div>
        <div class="field" style="margin-top: 10px">
          <label class="field-label" for="password">Password</label>
          <input
            id="password"
            class="input"
            type="password"
            [(ngModel)]="password"
            name="password"
            placeholder="••••••••"
          />
        </div>
        @if (error()) { <div class="note bad" style="margin-top: 12px">{{ error() }}</div> }
        <button
          class="btn btn-primary"
          style="width: 100%; margin-top: 16px"
          [disabled]="!email.trim() || !password || busy()"
        >
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  `,
})
export class LoginComponent {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);
  email = '';
  password = '';
  error = signal('');
  busy = signal(false);

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const { access_token } = await this.api.login(this.email.trim(), this.password);
      this.auth.setAccessToken(access_token);
      const me = await this.api.me();
      this.auth.setMe(me);
      if (me.memberships.length) {
        // First membership, not necessarily Moglix — with only one org today
        // this is unambiguous; Settings has the switcher for when it isn't.
        this.auth.setCurrentOrg(me.memberships[0].org_id);
      } else if (!me.platform_admin) {
        throw new Error('Your account has no organization access yet — ask an admin to add you.');
      }
      this.router.navigate(['/overview']);
    } catch (e: any) {
      this.auth.signOut();
      this.error.set(e.message || 'Login failed');
    } finally {
      this.busy.set(false);
    }
  }
}
