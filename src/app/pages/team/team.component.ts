import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService, Group, OrgRole, OrgUser } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';
import { ConfirmComponent } from '../../components/confirm/confirm.component';

const ROLES: OrgRole[] = ['org_admin', 'campaign_manager', 'user'];

function randomPassword(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
}

/**
 * Org-admin-only: who has access (Users) and who can see which campaigns
 * (Groups). Enforced for real by RolesGuard server-side — hiding the nav
 * link for non-admins (see ShellComponent) is UX only, so a direct API call
 * still 403s for anyone who isn't actually an org_admin.
 */
@Component({
  selector: 'app-team',
  standalone: true,
  imports: [FormsModule, IconComponent, ConfirmComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Team</h1>
        </div>
      </div>

      @if (error()) { <div class="note bad" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="note good" role="status">{{ notice() }}</div> }

      <div class="card">
        <div class="card-head">
          <span class="card-title"><app-icon name="user" [size]="14"></app-icon> Users</span>
          <span class="pill">{{ users().length }}</span>
        </div>
        <div class="health-rows">
          @for (u of users(); track u.user_id) {
            <div class="health-row team-row">
              <span class="team-email">{{ u.email }}</span>
              <span class="team-controls">
                @if (u.platform_admin) {
                  <span class="tag ok" title="Platform admin has full access">
                    Platform admin
                  </span>
                } @else if (isPlatformAdmin()) {
                  <label class="agent-admin-toggle" title="Full access to view and edit all Agents">
                    <input
                      type="checkbox"
                      [ngModel]="agentAdminDraft[u.user_id] ?? u.agent_admin"
                      (ngModelChange)="agentAdminDraft[u.user_id] = $event"
                    />
                    Agent admin
                  </label>
                }
                <select
                  class="select team-role-sel"
                  aria-label="Role"
                  [ngModel]="roleDraft[u.user_id] ?? u.role"
                  (ngModelChange)="roleDraft[u.user_id] = $event"
                >
                  @for (r of roles; track r) { <option [value]="r">{{ roleLabel(r) }}</option> }
                </select>
                @if (userChanged(u)) {
                  <button type="button" class="btn btn-sm btn-primary" (click)="applyUser(u)">Update</button>
                }
                <button type="button" class="btn btn-sm btn-stop" (click)="confirmDelete.set({ kind: 'user', user: u })" aria-label="Remove user" title="Remove user">
                  <app-icon name="trash" [size]="12"></app-icon>
                </button>
              </span>
            </div>
          }
          @if (!users().length) {
            <div class="empty-sub" style="padding: 12px 16px" role="status">No users yet.</div>
          }
        </div>

        <div class="health-row team-row" style="margin-top: 4px; justify-content: flex-start">
          <input class="input team-in" style="max-width: 220px" [(ngModel)]="inviteEmail" placeholder="email@company.com" aria-label="Email to invite" />
          <input class="input team-in" [type]="showInvitePass() ? 'text' : 'password'" style="max-width: 160px" [(ngModel)]="invitePassword" placeholder="temporary password" aria-label="Temporary password" />
          <button type="button" class="btn btn-sm" (click)="showInvitePass.set(!showInvitePass())" [attr.aria-pressed]="showInvitePass()">
            {{ showInvitePass() ? 'Hide' : 'Show' }}
          </button>
          <button type="button" class="btn btn-sm" (click)="invitePassword = generatedPassword(); showInvitePass.set(true)" title="Generate random password">
            Generate
          </button>
          <select class="select" style="width: auto" [(ngModel)]="inviteRole" aria-label="Role for the invite">
            @for (r of roles; track r) { <option [value]="r">{{ roleLabel(r) }}</option> }
          </select>
          <button type="button" class="btn btn-sm btn-primary" (click)="invite()" [disabled]="!canInvite() || busy()">
            <app-icon name="plus" [size]="12"></app-icon> Invite
          </button>
        </div>
        <div class="team-roles">
          <span><b>Org admin</b> manages team, agents &amp; campaigns</span>
          <span><b>Campaign manager</b> runs own &amp; group campaigns</span>
          <span><b>Member</b> views group campaigns</span>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <span class="card-title"><app-icon name="table" [size]="14"></app-icon> Groups</span>
          <span class="pill">{{ groups().length }}</span>
        </div>

        @for (g of groups(); track g.group_id) {
          <div class="group-block">
            <div class="health-row team-row">
              <input
                class="input team-in"
                style="max-width: 240px"
                aria-label="Group name"
                [ngModel]="groupDraft[g.group_id] ?? g.name"
                (ngModelChange)="groupDraft[g.group_id] = $event"
              />
              <span style="display: flex; gap: 8px">
                @if ((groupDraft[g.group_id] ?? g.name) !== g.name) {
                  <button type="button" class="btn btn-sm" (click)="renameGroup(g)">Save</button>
                }
                <button type="button" class="btn btn-sm btn-stop" (click)="confirmDelete.set({ kind: 'group', group: g })" aria-label="Delete group" title="Delete group">
                  <app-icon name="trash" [size]="12"></app-icon>
                </button>
              </span>
            </div>
            <div class="group-members">
              @for (uid of g.member_ids; track uid) {
                <span class="tag">
                  {{ emailFor(uid) }}
                  <button type="button" class="tag-remove" (click)="removeMember(g, uid)" title="Remove from group" aria-label="Remove from group">&times;</button>
                </span>
              }
              @if (!g.member_ids.length) {
                <span class="mono" style="font-size: 12px; color: var(--ds-text-muted)">No members yet.</span>
              }
            </div>
            <div class="health-row team-row" style="padding-top: 0; justify-content: flex-start">
              <select class="select" style="width: auto" [(ngModel)]="addMemberDraft[g.group_id]" aria-label="Add a member to the group">
                <option value="">Add a user…</option>
                @for (u of nonMembers(g); track u.user_id) {
                  <option [value]="u.user_id">{{ u.email }}</option>
                }
              </select>
              <button
                type="button"
                class="btn btn-sm"
                (click)="addMember(g)"
                [disabled]="!addMemberDraft[g.group_id]"
              >
                <app-icon name="plus" [size]="12"></app-icon> Add
              </button>
            </div>
          </div>
        }
        @if (!groups().length) {
          <div class="empty-sub" style="padding: 12px 16px" role="status">No groups yet.</div>
        }

        <div class="health-row team-row" style="margin-top: 4px; justify-content: flex-start">
          <input class="input team-in" style="max-width: 240px" [(ngModel)]="newGroupName" placeholder="New group name" aria-label="New group name" />
          <button type="button" class="btn btn-sm btn-primary" (click)="createGroup()" [disabled]="!newGroupName.trim() || busy()">
            <app-icon name="plus" [size]="12"></app-icon> Create group
          </button>
        </div>
      </div>
    </div>

    @if (confirmDelete(); as c) {
      <app-confirm
        [title]="c.kind === 'user' ? 'Remove ' + c.user.email + '?' : 'Delete group ' + c.group.name + '?'"
        [body]="c.kind === 'user' ? 'They will lose access to this workspace immediately.' : 'Group membership and scoped campaign visibility for this group will be removed.'"
        [confirmLabel]="c.kind === 'user' ? 'Remove user' : 'Delete group'"
        [danger]="true"
        (confirm)="confirmRemoval()"
        (cancel)="confirmDelete.set(null)">
      </app-confirm>
    }
  `,
  styles: [`
    .team-row { flex-wrap: wrap; gap: 8px 12px; }
    .team-email { min-width: 0; overflow-wrap: anywhere; }
    .team-controls { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; }
    .team-role-sel { width: auto; }
    .team-roles { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 4px 16px 14px; font-size: var(--ds-fs-sm); color: var(--ds-text-muted); }
    .group-block { border-top: 1px solid var(--ds-border); padding: 10px 0; }
    .group-members { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 16px 8px; }
    .tag-remove { border: none; background: none; cursor: pointer; margin: -4px -6px -4px 2px; min-width: 24px; min-height: 24px; display: inline-grid; place-items: center; border-radius: var(--ds-r-sm); color: inherit; font-size: 14px; line-height: 1; }
    .tag-remove:hover { background: var(--ds-hover); }
    .agent-admin-toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ds-text-muted); white-space: nowrap; cursor: pointer; }
    @media (max-width: 640px) {
      .team-row { align-items: stretch; }
      .team-controls { width: 100%; justify-content: space-between; }
      .team-role-sel { flex: 1 1 140px; min-width: 0; }
      .team-in { max-width: none !important; width: 100%; }
    }
  `],
})
export class TeamComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  roles = ROLES;
  roleLabel(r: string): string {
    return ({ org_admin: 'Org admin', campaign_manager: 'Campaign manager', user: 'Member' } as Record<string, string>)[r] || r;
  }

  orgId = computed(() => this.auth.currentOrgId());
  orgName = computed(() => this.auth.currentMembership()?.org_name || 'your organization');
  /** The Agent admin toggle is platform-admin-only server-side (PlatformAdminGuard);
   * hidden here for an org_admin viewer so it isn't a dead control that just 403s. */
  isPlatformAdmin = computed(() => !!this.auth.me()?.platform_admin);

  users = signal<OrgUser[]>([]);
  groups = signal<Group[]>([]);
  error = signal('');
  notice = signal('');
  busy = signal(false);
  showInvitePass = signal(false);
  confirmDelete = signal<{ kind: 'user'; user: OrgUser } | { kind: 'group'; group: Group } | null>(null);

  async confirmRemoval(): Promise<void> {
    const c = this.confirmDelete();
    this.confirmDelete.set(null);
    if (!c) return;
    if (c.kind === 'user') await this.removeUser(c.user);
    else await this.deleteGroup(c.group);
  }

  inviteEmail = '';
  invitePassword = '';
  inviteRole: OrgRole = 'user';
  newGroupName = '';
  groupDraft: Record<string, string | undefined> = {};
  addMemberDraft: Record<string, string | undefined> = {};
  /** Edits sit here, uncommitted, until "Update" is pressed — role and
   * agent_admin are sensitive enough that a change shouldn't fire on every
   * click of a dropdown/checkbox. Cleared once applied. */
  roleDraft: Record<string, OrgRole | undefined> = {};
  agentAdminDraft: Record<string, boolean | undefined> = {};

  ngOnInit(): void {
    this.load();
  }

  private async load(): Promise<void> {
    const orgId = this.orgId();
    if (!orgId) return;
    this.error.set('');
    try {
      const [users, groups] = await Promise.all([this.api.orgUsers(orgId), this.api.orgGroups(orgId)]);
      this.users.set(users);
      this.groups.set(groups);
    } catch (e: any) {
      this.error.set(e.message || 'Could not load team — you may not have org_admin access here.');
    }
  }

  emailFor(userId: string): string {
    return this.users().find((u) => u.user_id === userId)?.email || userId;
  }

  nonMembers(g: Group): OrgUser[] {
    return this.users().filter((u) => !g.member_ids.includes(u.user_id));
  }

  generatedPassword(): string {
    return randomPassword();
  }

  canInvite(): boolean {
    return /\S+@\S+\.\S+/.test(this.inviteEmail) && this.invitePassword.length >= 8;
  }

  async invite(): Promise<void> {
    const orgId = this.orgId();
    if (!orgId || !this.canInvite()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.inviteOrgUser(orgId, this.inviteEmail.trim(), this.invitePassword, this.inviteRole);
      this.notice.set(`Invited ${this.inviteEmail.trim()} — password: ${this.invitePassword} (copy it now, it won't be shown again here)`);
      this.inviteEmail = '';
      this.invitePassword = '';
      this.showInvitePass.set(false);
      this.inviteRole = 'user';
      await this.load();
    } catch (e: any) {
      this.error.set(e.message || 'Invite failed');
    } finally {
      this.busy.set(false);
    }
  }

  /** Whether either draft differs from what's actually saved — gates the
   * per-row Update button. */
  userChanged(u: OrgUser): boolean {
    const role = this.roleDraft[u.user_id];
    const agentAdmin = this.agentAdminDraft[u.user_id];
    return (role !== undefined && role !== u.role) || (agentAdmin !== undefined && agentAdmin !== u.agent_admin);
  }

  async applyUser(u: OrgUser): Promise<void> {
    const orgId = this.orgId();
    if (!orgId) return;
    const role = this.roleDraft[u.user_id];
    const agentAdmin = this.agentAdminDraft[u.user_id];
    this.error.set('');
    try {
      if (role !== undefined && role !== u.role) {
        await this.api.updateOrgUserRole(orgId, u.user_id, role);
      }
      if (agentAdmin !== undefined && agentAdmin !== u.agent_admin) {
        await this.api.setUserAgentAdmin(u.user_id, agentAdmin);
      }
      delete this.roleDraft[u.user_id];
      delete this.agentAdminDraft[u.user_id];
      await this.load();
    } catch (e: any) {
      this.error.set(e.message || 'Could not update user');
    }
  }

  async removeUser(u: OrgUser): Promise<void> {
    const orgId = this.orgId();
    if (!orgId) return;
    try {
      await this.api.removeOrgUser(orgId, u.user_id);
      await this.load();
    } catch (e: any) {
      this.error.set(e.message || 'Could not remove user');
    }
  }

  async createGroup(): Promise<void> {
    const orgId = this.orgId();
    if (!orgId || !this.newGroupName.trim()) return;
    this.busy.set(true);
    try {
      await this.api.createOrgGroup(orgId, this.newGroupName.trim());
      this.newGroupName = '';
      await this.load();
    } catch (e: any) {
      this.error.set(e.message || 'Could not create group');
    } finally {
      this.busy.set(false);
    }
  }

  async renameGroup(g: Group): Promise<void> {
    const orgId = this.orgId();
    const name = (this.groupDraft[g.group_id] ?? g.name).trim();
    if (!orgId || !name) return;
    try {
      await this.api.renameOrgGroup(orgId, g.group_id, name);
      delete this.groupDraft[g.group_id];
      await this.load();
    } catch (e: any) {
      this.error.set(e.message || 'Could not rename group');
    }
  }

  async deleteGroup(g: Group): Promise<void> {
    const orgId = this.orgId();
    if (!orgId) return;
    try {
      await this.api.deleteOrgGroup(orgId, g.group_id);
      await this.load();
    } catch (e: any) {
      this.error.set(e.message || 'Could not delete group');
    }
  }

  async addMember(g: Group): Promise<void> {
    const orgId = this.orgId();
    const userId = this.addMemberDraft[g.group_id];
    if (!orgId || !userId) return;
    try {
      await this.api.addGroupMember(orgId, g.group_id, userId);
      delete this.addMemberDraft[g.group_id];
      await this.load();
    } catch (e: any) {
      this.error.set(e.message || 'Could not add member');
    }
  }

  async removeMember(g: Group, userId: string): Promise<void> {
    const orgId = this.orgId();
    if (!orgId) return;
    try {
      await this.api.removeGroupMember(orgId, g.group_id, userId);
      await this.load();
    } catch (e: any) {
      this.error.set(e.message || 'Could not remove member');
    }
  }
}
