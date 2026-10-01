import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { HealthService } from '../../services/health.service';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { fmtNum, fmtSecs } from '../../utils/format';
import { setNoReplyUnder } from '../../utils/status';

const NAV = [
  { to: '/overview', icon: 'overview', label: 'Overview' },
  { to: '/console', icon: 'mic', label: 'Call console' },
  // platform_admin OR agent_admin server-side (AgentAdminGuard); hidden here
  // for everyone else purely so the link isn't a dead end — see
  // ShellComponent.nav. Org Admin/Campaign Manager still pick an agent when
  // creating a campaign, via voxlix-backend's /webrtc/agents — a separate,
  // unrestricted listing endpoint, untouched by this.
  { to: '/agents', icon: 'bot', label: 'Agents', agentAdminOnly: true },
  { to: '/campaigns', icon: 'megaphone', label: 'Campaigns' },
  // org_admin-only server-side (RolesGuard); hidden here for everyone else
  // purely so the link isn't a dead end — see ShellComponent.nav.
  { to: '/team', icon: 'user', label: 'Team', orgAdminOnly: true },
  { to: '/settings', icon: 'settings', label: 'Settings' },
];

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent],
  template: `
    <div [class]="'shell' + (navOpen() ? ' nav-open' : '')">
      <!-- Phones and narrow windows: a top bar with a menu button instead of the side rail. -->
      <header class="topbar">
        <button class="btn-icon" (click)="navOpen.set(!navOpen())" [attr.aria-expanded]="navOpen()" aria-label="Menu"><app-icon [name]="navOpen() ? 'close' : 'menu'" [size]="18"></app-icon></button>
        <div class="brand">
          <div class="brand-mark"><app-icon name="echo" [size]="18"></app-icon></div>
          <div class="brand-name">Echo</div>
        </div>
        <span style="flex: 1"></span>
        <span class="row-sub">{{ currentOrgName() }}</span>
      </header>
      <aside class="rail" (click)="closeOnLink($event)">
        <div class="brand">
          <div class="brand-mark"><app-icon name="echo" [size]="20"></app-icon></div>
          <div><div class="brand-name">Echo</div><div class="brand-sub">BY COGNILIX</div></div>
        </div>
        <nav class="nav">
          @for (n of visibleNav(); track n.to) {
            <a [routerLink]="n.to" routerLinkActive="active" class="nav-link">
              <span class="nav-icon"><app-icon [name]="n.icon" [size]="15" [strokeWidth]="1.9"></app-icon></span>
              <span>{{ n.label }}</span>
              @if (n.to === '/console' && activeCalls() > 0) { <span class="nav-badge live">live</span> }
            </a>
          }
        </nav>
        <div class="rail-card">
          <div class="rail-card-title">Today</div>
          <div class="rail-stat"><span>Calls</span><span>{{ fmtNum(today()?.total_calls ?? 0) }}</span></div>
          <div class="rail-stat"><span>Talk time</span><span>{{ fmtSecs(today()?.funnel?.talk_seconds ?? 0) }}</span></div>
        </div>
        @if ((auth.me()?.memberships?.length || 0) > 1) {
          <label class="rail-org">
            <span class="rail-card-title">Workspace</span>
            <select class="select" (change)="switchOrg($any($event.target).value)" aria-label="Workspace">
              @for (m of auth.me()!.memberships; track m.org_id) { <option [value]="m.org_id" [selected]="m.org_id === auth.currentOrgId()">{{ m.org_name }}</option> }
            </select>
          </label>
        }
        <div class="rail-foot">
          @if (currentOrgName()) {
            <span class="mono" style="font-size: 10.5px; color: var(--faint)" [title]="auth.me()?.email || ''">{{ currentOrgName() }}</span>
          } @else {
            <span class="mono" style="font-size: 10.5px; color: var(--faint)">v{{ healthData()?.version || '—' }}</span>
          }
          <button class="btn btn-sm" (click)="signOut()"><app-icon name="signout" [size]="13"></app-icon> Sign out</button>
        </div>
      </aside>
      <div class="main">
        <!-- The header held only the dependency lamps and the backend URL chip.
             Both are operator diagnostics rather than something to read on every
             page, so they now live under Settings > System Health and the bar is
             gone rather than left empty. -->
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
})
export class ShellComponent implements OnInit {
  private healthService = inject(HealthService);
  private api = inject(ApiService);
  auth = inject(AuthService);
  private router = inject(Router);
  nav = NAV;
  fmtNum = fmtNum;
  fmtSecs = fmtSecs;
  healthData = this.healthService.health;
  today = this.healthService.todayMetrics;
  activeCalls = computed(() => this.today()?.active_calls || 0);
  currentOrgName = computed(() => this.auth.currentMembership()?.org_name || '');
  isOrgAdmin = computed(
    () => this.auth.me()?.platform_admin || this.auth.currentMembership()?.role === 'org_admin',
  );
  isPlatformAdmin = computed(() => !!this.auth.me()?.platform_admin);
  isAgentAdmin = computed(() => !!this.auth.me()?.platform_admin || !!this.auth.me()?.agent_admin);
  visibleNav = computed(() =>
    this.nav.filter(
      (n) => (!n.orgAdminOnly || this.isOrgAdmin()) && (!n.agentAdminOnly || this.isAgentAdmin()),
    ),
  );

  navOpen = signal(false);
  /** On phones the menu closes once a page is picked. */
  closeOnLink(e: Event): void { if ((e.target as HTMLElement).closest('a')) this.navOpen.set(false); }

  ngOnInit(): void {
    // A page refresh restores accessToken/currentOrgId from localStorage but
    // not `me` (never persisted — it's re-fetched, not stored, so a role
    // change server-side is picked up on the next load rather than cached).
    if (this.auth.isAuthenticated() && !this.auth.me()) {
      this.api
        .me()
        .then((me) => {
          this.auth.setMe(me);
          if (!this.auth.currentOrgId() && me.memberships.length) {
            this.auth.setCurrentOrg(me.memberships[0].org_id);
          }
        })
        .catch(() => undefined);
    }
    // The No reply cut-off is a workspace setting; status hovers quote it.
    const org = this.auth.currentOrgId();
    if (org) this.api.orgSettings(org).then((st) => setNoReplyUnder(st?.telephony?.no_reply_under_seconds)).catch(() => undefined);
  }

  /** Each workspace has its own agents, campaigns, telephony routes and team; reload so every page refetches. */
  switchOrg(orgId: string): void {
    if (!orgId || orgId === this.auth.currentOrgId()) return;
    this.auth.setCurrentOrg(orgId);
    this.router.navigateByUrl('/overview').then(() => window.location.reload());
  }

  signOut(): void {
    this.auth.signOut();
    this.router.navigate(['/login']);
  }
}
