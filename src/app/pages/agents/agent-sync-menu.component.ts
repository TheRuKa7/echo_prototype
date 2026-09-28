import { Component, EventEmitter, HostListener, Input, Output, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';

export interface SyncPlatformOption {
  platform_key: string;
  label: string;
}

/**
 * The three-dot "Sync" action on an Agents-list row.
 *
 * Driven entirely by inputs so the parent never has to track open/closed
 * itself. `syncedPlatform` alone only means "armed" — the actual state comes
 * from `syncStatus`:
 *  - 'synced' → a disabled-looking "Synced" badge, platform name on hover.
 *    No unsync/switch action exists — this is permanent, since it's an
 *    actually-working connection.
 *  - 'pending' → still being delivered/retried by the poller. Informational
 *    only, no menu — interrupting an in-flight retry isn't useful.
 *  - 'failed' (exhausted retries) → a red indicator explaining why, PLUS the
 *    three-dot menu stays available so it can be retried — a permanently
 *    failed agent must not be stuck with no way to ever reach the platform.
 *  - unset → the plain three-dot menu, same as an agent that's never been
 *    touched.
 * `platforms` empty (org has no third party configured) → renders nothing
 * at all, not even the three-dot button, regardless of the above.
 */
@Component({
  selector: 'app-agent-sync-menu',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (syncStatus === 'synced') {
      <span class="sync-badge synced" [title]="'Synced with ' + platformLabel()">
        <app-icon name="link" [size]="12"></app-icon>
        Synced
      </span>
    } @else if (platforms.length) {
      <div class="sync-menu-host" (click)="$event.stopPropagation()">
        @if (syncStatus === 'pending') {
          <span class="sync-badge pending" title="Still trying to reach the platform — retries automatically, no action needed">
            <app-icon name="activity" [size]="12"></app-icon>
            Syncing…
          </span>
        } @else {
          @if (syncStatus === 'failed') {
            <span
              class="sync-badge failed"
              [title]="'Sync to ' + platformLabel() + ' failed' + (lastError ? ': ' + lastError : '') + ' — pick a platform below to try again'"
            >
              <app-icon name="alert" [size]="12"></app-icon>
              Failed
            </span>
          }
          <button class="btn-icon" (click)="toggle()" title="More actions">
            <app-icon name="moreVertical" [size]="15"></app-icon>
          </button>
        }
        @if (open()) {
          <div class="sync-menu">
            @if (!expanded()) {
              <button class="sync-menu-item" [disabled]="busy()" (click)="expanded.set(true)">
                <app-icon name="link" [size]="12"></app-icon> Sync
              </button>
            } @else {
              <div class="sync-menu-heading">Sync with…</div>
              @for (p of platforms; track p.platform_key) {
                <button class="sync-menu-item" [disabled]="busy()" (click)="pick(p.platform_key)">
                  {{ p.label }}
                </button>
              }
            }
            @if (error()) { <div class="sync-menu-error">{{ error() }}</div> }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .sync-menu-host { position: relative; display: inline-flex; align-items: center; gap: 6px; }
    .btn-icon { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid var(--line); background: var(--raised); border-radius: 6px; cursor: pointer; color: var(--ink-3); }
    .btn-icon:hover { color: var(--ink); }
    .sync-menu { position: absolute; right: 0; top: 30px; z-index: 20; min-width: 170px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.12); padding: 4px; display: flex; flex-direction: column; }
    .sync-menu-heading { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--faint); padding: 6px 8px 2px; }
    .sync-menu-item { display: flex; align-items: center; gap: 6px; text-align: left; padding: 7px 8px; border: none; background: none; border-radius: 5px; font-size: 12.5px; color: var(--ink-2); cursor: pointer; }
    .sync-menu-item:hover:not(:disabled) { background: var(--raised); color: var(--ink); }
    .sync-menu-item:disabled { opacity: 0.5; cursor: default; }
    .sync-menu-error { font-size: 11px; color: var(--red, #c0392b); padding: 4px 8px 2px; max-width: 220px; }
    .sync-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: var(--muted); background: var(--raised); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; cursor: default; white-space: nowrap; }
    .sync-badge.failed { color: var(--red, #c0392b); background: rgba(192, 57, 43, 0.08); border-color: rgba(192, 57, 43, 0.25); }
    .sync-badge.pending svg { animation: sync-spin 1.1s linear infinite; }
    @keyframes sync-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `],
})
export class AgentSyncMenuComponent {
  private api = inject(ApiService);

  @Input() agentKey = '';
  @Input() syncedPlatform: string | null = null;
  /** null = never armed. 'pending'/'synced'/'failed' otherwise — see class doc. */
  @Input() syncStatus: string | null = null;
  @Input() lastError: string | null = null;
  @Input() platforms: SyncPlatformOption[] = [];
  /** Emits the platform_key just synced to, so the parent can patch its row. */
  @Output() synced = new EventEmitter<string>();

  open = signal(false);
  expanded = signal(false);
  busy = signal(false);
  error = signal('');

  /** Falls back to the raw key if the platform was since disabled/removed —
   * listForDropdown only returns enabled ones, so a still-synced platform
   * might no longer have a matching label. */
  platformLabel(): string {
    return this.platforms.find((p) => p.platform_key === this.syncedPlatform)?.label || this.syncedPlatform || '';
  }

  toggle(): void {
    this.open.update((v) => !v);
    this.expanded.set(false);
    this.error.set('');
  }

  @HostListener('document:click')
  closeOnOutsideClick(): void {
    this.open.set(false);
  }

  async pick(platformKey: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.syncAgent(this.agentKey, platformKey);
      this.open.set(false);
      this.synced.emit(platformKey);
    } catch (e: any) {
      this.error.set(e.message || 'Sync failed');
    } finally {
      this.busy.set(false);
    }
  }
}
