import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { HealthService } from '../../services/health.service';
import { ApiService } from '../../services/api.service';
import { API_BASE } from '../../core/endpoints';
import {
  CallingRulesComponent, CallingRulesSource, DncListComponent, DncSource, SecurityView,
} from '../../components/shared-screens/shared-screens';
import { ConfirmComponent } from '../../components/confirm/confirm.component';
import { IconComponent } from '../../components/icon/icon.component';

type SettingsTab = 'telephony' | 'compliance' | 'dnc' | 'status';

/**
 * Settings: Telephony providers & flows, Compliance (PII + country calling rules),
 * Do-not-call numbers, and visual System Status & Health (last tab).
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, CallingRulesComponent, DncListComponent, ConfirmComponent, IconComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Settings</h1>
        </div>
        <div class="seg" role="tablist" aria-label="Settings sections">
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'telephony'" [class.on]="tab() === 'telephony'" (click)="setTab('telephony')">Telephony</button>
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'compliance'" [class.on]="tab() === 'compliance'" (click)="setTab('compliance')">Compliance</button>
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'dnc'" [class.on]="tab() === 'dnc'" (click)="setTab('dnc')">Do-not-call</button>
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'status'" [class.on]="tab() === 'status'" (click)="setTab('status')">Status &amp; health</button>
        </div>
      </div>

      @if (error()) { <div class="note bad" role="alert">{{ error() }}</div> }
      @if (notice()) { <div class="note good" role="status">{{ notice() }}</div> }

      <!-- ── TAB 1: TELEPHONY SETUP + INTEGRATED CALLING FLOWS ── -->
      @if (tab() === 'telephony') {
        <div class="st-stack">
          <div class="card">
            <div class="card-head" style="gap:10px; flex-wrap:wrap">
              <div class="card-title">
                Telephony providers
                @if (tel(); as tv) { <span class="pill" style="margin-left:6px">{{ tv.carriers.length }} connected · {{ tv.total }} channels</span> }
              </div>
              <button type="button" class="btn btn-sm btn-primary" style="margin-left:auto" (click)="openConnectModal()">
                <app-icon name="plus" [size]="13"></app-icon> Connect provider
              </button>
            </div>
            <div class="card-body st-tel-body">
              @if (tel(); as tv) {
                <div class="st-prov-grid">
                  @for (c of tv.carriers; track c.key) {
                    <div class="st-prov-card">
                      <div class="st-prov-top">
                        <b>{{ c.name }}</b>
                        <span class="st-dot-ok"><i aria-hidden="true"></i>Connected</span>
                      </div>
                      <div class="st-prov-meta">{{ c.channels }} concurrent lines · {{ c.numbers.length }} DID{{ c.numbers.length === 1 ? '' : 's' }}</div>
                      <div class="st-did-row">
                        @for (num of c.numbers.slice(0, 3); track num) { <span class="tag mono">{{ num }}</span> }
                      </div>
                      <div class="st-prov-acts">
                        <button type="button" class="btn btn-sm" (click)="syncProviderFlows(c.key)" [disabled]="syncing()">Sync flows</button>
                        <button type="button" class="btn btn-sm" (click)="openConnectModal(c.key)">Reconfigure</button>
                        <button type="button" class="btn btn-sm btn-ghost" style="color:var(--ds-danger-fg)" (click)="askDisconnectCarrier(c.key, c.name)">Disconnect</button>
                      </div>
                    </div>
                  } @empty {
                    <div class="note bad" role="alert">No telephony provider connected. Connect Ozonetel, Exotel, Twilio, Plivo, Tata Tele or SIP trunk.</div>
                  }
                </div>

                <!-- Quick-add major providers rail -->
                <div class="st-catalog-strip">
                  <span class="st-k">Add major provider:</span>
                  @for (cat of tv.catalog; track cat.key) {
                    @if (!isCarrierConnected(cat.key)) {
                      <button type="button" class="st-cat-chip" (click)="openConnectModal(cat.key)">
                        + {{ cat.name }} <small>{{ cat.region }}</small>
                      </button>
                    }
                  }
                </div>

                <!-- Caller ID rotation & Concurrency -->
                <div class="st-slots-bar">
                  <label class="st-tog">
                    <input type="checkbox" [checked]="rotateIds()" (change)="rotateIds.set($any($event.target).checked)" aria-label="Rotate caller IDs automatically" />
                    <span>Rotate caller IDs automatically ({{ tv.numbers.length }} DIDs)</span>
                  </label>
                  <div class="st-cap">
                    <span class="mono">{{ tv.assigned }}/{{ tv.total }} slots assigned</span>
                    <span class="st-meter" aria-hidden="true"><i [style.width.%]="tv.total ? (100 * tv.assigned) / tv.total : 0"></i></span>
                  </div>
                  <button type="button" class="btn btn-sm" (click)="saveTelSlots()" [disabled]="telBusy()">Save routing</button>
                </div>
              } @else {
                <div class="empty-sub" role="status">Loading telephony configuration…</div>
              }
            </div>
          </div>

          <!-- Integrated Calling Flows inside Telephony tab -->
          <div class="card">
            <div class="card-head" style="gap:8px; flex-wrap:wrap">
              <div class="card-title">Calling flows <span class="pill" style="margin-left:6px">{{ enabledCount() }} active · {{ flows().length }} synced</span></div>
              <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-left:auto">
                <input class="input st-search" [ngModel]="flowQ()" (ngModelChange)="flowQ.set($event)" placeholder="Filter flows or DID…" aria-label="Search flows" />
                <select class="select" style="min-height:30px; font-size:12px; padding:3px 26px 3px 8px" [ngModel]="flowProvider()" (ngModelChange)="flowProvider.set($event)" aria-label="Filter by provider">
                  <option value="">All providers</option>
                  @for (p of flowProviders(); track p) { <option [value]="p">{{ p }}</option> }
                </select>
                <div class="seg" role="group" aria-label="Show flows">
                  <button type="button" [class.on]="flowFilter() === 'on'" [attr.aria-pressed]="flowFilter() === 'on'" (click)="flowFilter.set('on')">Active ({{ enabledCount() }})</button>
                  <button type="button" [class.on]="flowFilter() === 'all'" [attr.aria-pressed]="flowFilter() === 'all'" (click)="flowFilter.set('all')">All ({{ flows().length }})</button>
                </div>
              </div>
            </div>
            <div class="health-rows st-flows-scroll">
              @for (f of shownFlows(); track f.name) {
                <div class="health-row st-flow-row">
                  <div style="min-width:0; display:flex; align-items:center; gap:8px; flex-wrap:wrap">
                    <b class="mono" style="font-size:12.5px">{{ f.name }}</b>
                    @if (f.did) { <span class="tag muted mono">{{ f.did }}</span> }
                    @if (f.type) { <span class="tag">{{ f.type }}</span> }
                    @if (f.provider_label || f.provider) { <span class="tag muted">{{ f.provider_label || f.provider }}</span> }
                    @if (f.used_by?.length) { <span class="row-sub">· {{ f.used_by.join(', ') }}</span> }
                  </div>
                  <label class="switch" [title]="f.enabled ? 'Enabled for agents' : 'Disabled'">
                    <input type="checkbox" [checked]="!!f.enabled" [disabled]="toggling() === f.name" (change)="toggleFlow(f, $any($event.target).checked)" [attr.aria-label]="'Toggle flow ' + f.name" />
                    <i></i>
                  </label>
                </div>
              } @empty {
                <div class="empty-sub" style="padding:14px 16px" role="status">{{ flowsLoading() ? 'Loading calling flows…' : 'No calling flows match.' }}</div>
              }
            </div>
          </div>
        </div>
      }

      <!-- ── TAB 2: COMPLIANCE (PII & PRIVACY + COMPACT CALLING RULES) ── -->
      @if (tab() === 'compliance') {
        <div class="st-stack">
          <div class="card">
            <div class="card-head" style="gap:8px">
              <div class="card-title">PII, Privacy &amp; Compliance</div>
              @if (sec(); as s) {
                <span class="tag ok">{{ s.residency.region }}</span>
                <div style="margin-left:auto; display:flex; gap:8px; align-items:center">
                  <button type="button" class="btn btn-sm" (click)="resetSec()" [disabled]="!secDirty()">Undo</button>
                  <button type="button" class="btn btn-sm btn-primary" (click)="saveSec()" [disabled]="!secDirty() || secBusy()">{{ secBusy() ? 'Saving…' : 'Save PII settings' }}</button>
                </div>
              }
            </div>
            <div class="card-body">
              @if (sec(); as s) {
                <div class="st-comp-grid">
                  <div class="st-comp-toggles">
                    <label class="st-comp-item">
                      <span class="switch"><input type="checkbox" [checked]="s.pii_redaction" (change)="patchSec({ pii_redaction: $any($event.target).checked })" aria-label="PII Redaction" /><i></i></span>
                      <span><b>PII Redaction</b><small>Mask bank, card, PAN &amp; Aadhaar digits in transcripts</small></span>
                    </label>
                    <label class="st-comp-item">
                      <span class="switch"><input type="checkbox" [checked]="s.mask_numbers_for_viewers" (change)="patchSec({ mask_numbers_for_viewers: $any($event.target).checked })" aria-label="Mask caller phone numbers" /><i></i></span>
                      <span><b>Mask caller phone numbers</b><small>Hide full phone numbers for read-only viewer roles</small></span>
                    </label>
                    <label class="st-comp-item">
                      <span class="switch"><input type="checkbox" [checked]="s.mfa_required" (change)="patchSec({ mfa_required: $any($event.target).checked })" aria-label="Require 2FA sign-in" /><i></i></span>
                      <span><b>Require 2FA sign-in</b><small>Enforce two-factor authentication across workspace</small></span>
                    </label>
                    <label class="st-comp-item">
                      <span class="switch"><input type="checkbox" [checked]="consentAnnouncement()" (change)="consentAnnouncement.set($any($event.target).checked)" aria-label="Recording consent notice" /><i></i></span>
                      <span><b>Recording consent notice</b><small>Play recorded-call disclosure at call start</small></span>
                    </label>
                  </div>

                  <div class="st-ret-row">
                    <label class="field"><span class="field-label">Recordings (days)</span>
                      <input class="input" type="number" min="7" max="3650" [ngModel]="s.retention.recordings_days" (ngModelChange)="patchRet({ recordings_days: +$event || 90 })" aria-label="Recordings retention in days" /></label>
                    <label class="field"><span class="field-label">Transcripts (days)</span>
                      <input class="input" type="number" min="7" max="3650" [ngModel]="s.retention.transcripts_days" (ngModelChange)="patchRet({ transcripts_days: +$event || 365 })" aria-label="Transcripts retention in days" /></label>
                    <label class="field"><span class="field-label">Contacts (days)</span>
                      <input class="input" type="number" min="30" max="3650" [ngModel]="s.retention.contacts_days" (ngModelChange)="patchRet({ contacts_days: +$event || 730 })" aria-label="Contacts retention in days" /></label>
                    <label class="field"><span class="field-label">Audio link expiry (h)</span>
                      <input class="input" type="number" min="1" max="168" [ngModel]="s.recording_link_hours" (ngModelChange)="patchSec({ recording_link_hours: +$event || 24 })" aria-label="Audio link expiry in hours" /></label>
                  </div>

                  <details class="st-del-box">
                    <summary>DPDP / GDPR right-to-erasure (delete contact records)</summary>
                    <div class="st-del-inner">
                      <input class="input" style="max-width:190px" [ngModel]="delPhone()" (ngModelChange)="delPhone.set($event); delPreview.set(null)" placeholder="10-digit phone" aria-label="Contact phone number to delete" />
                      <button type="button" class="btn btn-sm" (click)="previewDelete()" [disabled]="!delPhone().trim()">Lookup records</button>
                      @if (delPreview(); as p) {
                        <span class="mono" style="font-size:12px">{{ p.calls }} calls · {{ p.recordings }} recordings</span>
                        <input class="input" style="flex:1 1 160px" [ngModel]="delReason()" (ngModelChange)="delReason.set($event)" placeholder="Deletion ticket / reason" aria-label="Deletion ticket or reason" />
                        <button type="button" class="btn btn-sm btn-stop" (click)="askConfirmDelete()" [disabled]="!delReason().trim()">Delete permanently</button>
                      }
                      @if (delMsg()) { <span class="tag ok" role="status">{{ delMsg() }}</span> }
                    </div>
                  </details>
                </div>
              } @else {
                <div class="empty-sub" role="status">Loading compliance &amp; PII configuration…</div>
              }
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div class="card-title">Country calling rules &amp; registers</div></div>
            <div class="card-body">
              <app-calling-rules [source]="rulesSource"></app-calling-rules>
            </div>
          </div>
        </div>
      }

      <!-- ── TAB 3: DO-NOT-CALL (SIMPLIFIED NUMBER LIST WITH ADD/REMOVE ICONS) ── -->
      @if (tab() === 'dnc') {
        <app-dnc-list [source]="dncSource"></app-dnc-list>
      }

      <!-- ── TAB 4 (LAST): VISUAL-ONLY STATUS & HEALTH ── -->
      @if (tab() === 'status') {
        <div class="card">
          <div class="card-head" style="gap:8px">
            <div class="card-title">System status &amp; health</div>
            <span class="pill" style="margin-left:auto">{{ org() }}</span>
            <button type="button" class="btn btn-sm" (click)="health.poll()" title="Refresh status" aria-label="Refresh status">
              <app-icon name="refresh" [size]="13"></app-icon>
            </button>
          </div>
          <div class="card-body">
            <div class="st-vis-grid">
              <div class="st-vis-card" [class.ok]="!!h()" [class.bad]="!h()" [title]="apiBase + ' · v' + (h()?.version || 'demo')">
                <div class="st-vis-top">
                  <span class="st-ring" aria-hidden="true"><i></i></span>
                  <b>API</b>
                  <span class="mono st-vis-num">{{ h() ? h()!.ms + 'ms' : 'Down' }}</span>
                </div>
                <div class="st-bars" aria-hidden="true">
                  @for (i of [1,2,3,4,5]; track i) { <i [class.on]="!!h() && i <= apiScore()"></i> }
                </div>
              </div>

              <div class="st-vis-card" [class.ok]="h()?.ozonetel?.configured !== false" [class.bad]="h()?.ozonetel?.configured === false">
                <div class="st-vis-top">
                  <span class="st-ring" aria-hidden="true"><i></i></span>
                  <b>Telephony</b>
                  <span class="mono st-vis-num">{{ tel()?.carriers?.length ?? 1 }} live</span>
                </div>
                <div class="st-bars" aria-hidden="true">
                  @for (i of [1,2,3,4,5]; track i) { <i [class.on]="h()?.ozonetel?.configured !== false && i <= 5"></i> }
                </div>
              </div>

              <div class="st-vis-card ok">
                <div class="st-vis-top">
                  <span class="st-ring" aria-hidden="true"><i></i></span>
                  <b>Storage</b>
                  <span class="mono st-vis-num">{{ h()?.storage || 'mongo' }}</span>
                </div>
                <div class="st-bars" aria-hidden="true">
                  @for (i of [1,2,3,4,5]; track i) { <i class="on"></i> }
                </div>
              </div>

              <div class="st-vis-card ok">
                <div class="st-vis-top">
                  <span class="st-ring" aria-hidden="true"><i></i></span>
                  <b>Workspace</b>
                  <span class="mono st-vis-num">{{ isAgentAdmin() ? 'Admin' : 'Member' }}</span>
                </div>
                <div class="st-bars" aria-hidden="true">
                  @for (i of [1,2,3,4,5]; track i) { <i class="on"></i> }
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    </div>

    <!-- Telephony Provider Setup Modal -->
    @if (connectModalOpen()) {
      <div class="modal-backdrop" (click)="closeConnectModal()">
        <div class="modal agent-modal" style="max-width:560px" role="dialog" aria-modal="true" aria-label="Connect telephony provider" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <div>
              <div class="modal-title">Connect telephony provider</div>
              <div class="modal-sub">Verify credentials, inspect DIDs, and sync calling flows.</div>
            </div>
            <button type="button" class="btn-icon" aria-label="Close" (click)="closeConnectModal()"><app-icon name="close" [size]="16"></app-icon></button>
          </div>
          <div class="modal-body" style="display:grid; gap:14px">
            <div class="field">
              <span class="field-label">Select provider</span>
              <div class="st-mod-provs">
                @for (cat of tel()?.catalog ?? []; track cat.key) {
                  <button type="button" class="st-mod-prov" [class.on]="pickCarrier() === cat.key" [attr.aria-pressed]="pickCarrier() === cat.key" (click)="selectCarrier(cat.key)">
                    <b>{{ cat.name }}</b>
                    <small>{{ cat.region }}</small>
                  </button>
                }
              </div>
            </div>

            @if (pickedCarrierObj(); as c) {
              <div class="set-box" style="gap:10px">
                <div class="set-title">{{ c.name }} credentials</div>
                @for (f of c.fields; track f.key) {
                  <label class="field">
                    <span class="field-label">{{ f.label }}</span>
                    <input
                      class="input mono"
                      [type]="f.type === 'secret' ? 'password' : 'text'"
                      [ngModel]="carrierFields()[f.key] || ''"
                      (ngModelChange)="setCarrierField(f.key, $event)"
                      [placeholder]="f.label"
                    />
                  </label>
                }
              </div>

              @if (testRes(); as tr) {
                <div class="st-test-box" [class.ok]="tr.ok" [class.bad]="!tr.ok" role="status">
                  @for (step of tr.steps; track step.label) {
                    <div class="st-test-step" [class.bad]="!step.ok">
                      <span aria-hidden="true">{{ step.ok ? '✓' : '✕' }}</span>
                      <b>{{ step.label }}</b>
                      <small>{{ step.detail }}</small>
                    </div>
                  }
                </div>
              }
            }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" (click)="testProvider()" [disabled]="telBusy() || !pickCarrier()">
              {{ telBusy() ? 'Testing…' : 'Test connection' }}
            </button>
            <span style="flex:1"></span>
            <button type="button" class="btn" (click)="closeConnectModal()">Cancel</button>
            <button type="button" class="btn btn-primary" (click)="submitConnectProvider()" [disabled]="telBusy() || !testRes()?.ok">
              Connect &amp; sync flows
            </button>
          </div>
        </div>
      </div>
    }

    @if (confirmBox(); as cb) {
      <app-confirm
        [title]="cb.title"
        [body]="cb.body"
        [confirmLabel]="cb.confirmLabel"
        [danger]="cb.danger"
        [busy]="confirmBusy()"
        (confirm)="runConfirmBox()"
        (cancel)="confirmBox.set(null)">
      </app-confirm>
    }
  `,
  styles: [`
    .st-search { width: 190px; min-height: 30px; padding: 4px 8px; font-size: 12px; }
    .st-stack { display: grid; gap: 14px; }
    .st-tel-body { display: grid; gap: 12px; }
    .st-prov-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
    .st-prov-card { border: 1px solid var(--ds-border); border-radius: 10px; padding: 10px 12px; background: var(--ds-surface); display: grid; gap: 6px; }
    .st-prov-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .st-dot-ok { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; color: var(--ds-success-fg); }
    .st-dot-ok i { width: 7px; height: 7px; border-radius: 50%; background: var(--ds-success); }
    .st-prov-meta { font-size: 12px; color: var(--ds-text-muted); }
    .st-did-row { display: flex; flex-wrap: wrap; gap: 4px; }
    .st-prov-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
    .st-catalog-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding-top: 4px; }
    .st-k { font-size: 12px; font-weight: 600; color: var(--ds-text-muted); }
    .st-cat-chip { display: inline-flex; align-items: center; gap: 5px; border: 1px dashed var(--ds-border-strong); background: var(--ds-surface-sunken); border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 12px; font-weight: 550; cursor: pointer; color: var(--ds-text); }
    .st-cat-chip:hover { border-color: var(--ds-accent); color: var(--ds-accent-fg); border-style: solid; }
    .st-cat-chip small { font-size: 10.5px; color: var(--ds-text-muted); }
    .st-slots-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 8px 12px; border: 1px solid var(--ds-border); border-radius: 10px; background: var(--ds-surface-sunken); }
    .st-tog { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 550; cursor: pointer; }
    .st-tog input { accent-color: var(--ds-accent); }
    .st-cap { display: flex; align-items: center; gap: 8px; margin-left: auto; font-size: 12px; color: var(--ds-text-muted); }
    .st-meter { width: 96px; height: 7px; border-radius: 999px; background: var(--ds-border); overflow: hidden; display: block; }
    .st-meter i { display: block; height: 100%; background: var(--ds-accent); }
    .st-flows-scroll { max-height: 360px; overflow-y: auto; }
    .st-flow-row { padding: 7px 14px; min-height: 0; }
    .st-mod-provs { display: grid; grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 6px; }
    .st-mod-prov { display: grid; gap: 1px; padding: 8px 10px; border: 1px solid var(--ds-border); border-radius: 8px; background: var(--ds-surface); text-align: left; cursor: pointer; font: inherit; color: var(--ds-text); }
    .st-mod-prov small { font-size: 11px; color: var(--ds-text-muted); }
    .st-mod-prov.on { border: 1.5px solid var(--ds-accent); background: var(--ds-accent-soft); }
    .st-test-box { border: 1px solid var(--ds-border); border-radius: 8px; padding: 8px 10px; display: grid; gap: 4px; background: var(--ds-surface-sunken); }
    .st-test-box.ok { border-color: var(--ds-success-border); background: var(--ds-success-bg); }
    .st-test-box.bad { border-color: var(--ds-danger-border); background: var(--ds-danger-bg); }
    .st-test-step { display: flex; align-items: baseline; gap: 6px; font-size: 12px; }
    .st-test-step small { color: var(--ds-text-muted); }
    .st-test-step.bad { color: var(--ds-danger-fg); }
    /* Compliance & PII */
    .st-comp-grid { display: grid; gap: 12px; }
    .st-comp-toggles { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
    .st-comp-item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border: 1px solid var(--ds-border); border-radius: 9px; background: var(--ds-surface-sunken); cursor: pointer; }
    .st-comp-item b { display: block; font-size: 12.5px; }
    .st-comp-item small { display: block; font-size: 11.5px; color: var(--ds-text-muted); }
    .st-ret-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .st-ret-row .input { min-height: 32px; font-size: 12.5px; }
    .st-del-box summary { font-size: 12px; font-weight: 600; color: var(--ds-text-muted); cursor: pointer; }
    .st-del-inner { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 8px; }
    /* Visual-only status & health */
    .st-vis-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
    .st-vis-card { border: 1px solid var(--ds-border); border-radius: 10px; padding: 12px 14px; background: var(--ds-surface-sunken); display: grid; gap: 10px; }
    .st-vis-card.ok { border-color: var(--ds-success-border); background: var(--ds-success-bg); }
    .st-vis-card.bad { border-color: var(--ds-danger-border); background: var(--ds-danger-bg); }
    .st-vis-top { display: flex; align-items: center; gap: 8px; }
    .st-vis-top b { font-size: 13px; }
    .st-vis-num { margin-left: auto; font-size: 13px; font-weight: 700; }
    .st-ring { width: 14px; height: 14px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--ds-success) 20%, transparent); }
    .st-ring i { width: 8px; height: 8px; border-radius: 50%; background: var(--ds-success); }
    .st-vis-card.bad .st-ring { background: color-mix(in srgb, var(--ds-danger) 20%, transparent); }
    .st-vis-card.bad .st-ring i { background: var(--ds-danger); }
    .st-bars { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; height: 8px; }
    .st-bars i { display: block; border-radius: 3px; background: var(--ds-border); }
    .st-bars i.on { background: var(--ds-success); }
    @media (max-width: 720px) { .st-ret-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } .st-search { width: 100%; } }
  `],
})
export class SettingsComponent implements OnInit {
  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (!this.confirmBox() && this.connectModalOpen()) this.closeConnectModal();
  }
  auth = inject(AuthService);
  health = inject(HealthService);
  private api = inject(ApiService);
  private router = inject(Router);
  apiBase = API_BASE;
  h = this.health.health;

  tab = signal<SettingsTab>('telephony');
  error = signal('');
  notice = signal('');
  org = computed(() => this.auth.currentMembership()?.org_name ? `${this.auth.currentMembership()?.org_name} (${this.auth.currentMembership()?.role})` : 'Moglix');
  isAgentAdmin = computed(() => !!this.auth.me()?.platform_admin || !!this.auth.me()?.agent_admin);
  apiScore = computed(() => { const ms = this.h()?.ms ?? 999; return ms < 50 ? 5 : ms < 150 ? 4 : ms < 300 ? 3 : 2; });

  // Telephony state
  tel = signal<any>(null);
  rotateIds = signal(true);
  telBusy = signal(false);
  connectModalOpen = signal(false);
  pickCarrier = signal('ozonetel');
  carrierFields = signal<Record<string, string>>({});
  testRes = signal<{ ok: boolean; steps: { label: string; ok: boolean; detail: string }[] } | null>(null);
  pickedCarrierObj = computed(() => (this.tel()?.catalog || []).find((c: any) => c.key === this.pickCarrier()) ?? null);

  // Flows inside Telephony tab
  flows = signal<any[]>([]);
  flowsLoading = signal(false);
  syncing = signal(false);
  flowQ = signal('');
  flowProvider = signal('');
  flowFilter = signal<'on' | 'all'>('on');
  toggling = signal<string | null>(null);
  enabledCount = computed(() => this.flows().filter((f) => f.enabled).length);
  flowProviders = computed(() => [...new Set(this.flows().map((f) => f.provider_label || f.provider).filter(Boolean))].sort());
  shownFlows = computed(() => {
    const q = this.flowQ().trim().toLowerCase();
    const prov = this.flowProvider();
    return this.flows()
      .filter((f) => this.flowFilter() === 'all' || f.enabled)
      .filter((f) => !prov || (f.provider_label || f.provider) === prov)
      .filter((f) => !q || `${f.name} ${f.did || ''} ${f.type || ''}`.toLowerCase().includes(q))
      .slice(0, 80);
  });

  // Compliance / PII state
  private savedSec = signal<SecurityView | null>(null);
  private savedConsent = signal(true);
  sec = signal<SecurityView | null>(null);
  secBusy = signal(false);
  consentAnnouncement = signal(true);
  secDirty = computed(() => JSON.stringify(this.sec()) !== JSON.stringify(this.savedSec()) || this.consentAnnouncement() !== this.savedConsent());
  delPhone = signal('');
  delReason = signal('');
  delPreview = signal<any>(null);
  delMsg = signal('');
  confirmBox = signal<{ title: string; body: string; confirmLabel: string; danger: boolean; run: () => Promise<void> } | null>(null);
  confirmBusy = signal(false);

  readonly rulesSource: CallingRulesSource = {
    list: () => this.api.callingRules(),
    save: (code, rule) => this.api.saveCallingRule(code, rule),
    reset: (code) => this.api.resetCallingRule(code),
    preview: (rule, country, hour) => this.api.retryPreview(rule, country, hour),
  };
  readonly dncSource: DncSource = {
    load: (q) => this.api.dncLoad(q),
    add: (e) => this.api.dncAdd(e),
    remove: (phone, reason) => this.api.dncRemove(phone, reason),
    setAuto: (on) => this.api.dncAuto(on),
    openCall: (id) => this.router.navigate(['/calls', id]),
  };

  ngOnInit(): void {
    this.loadTelephony();
    this.loadFlows();
    this.loadSecurity();
  }

  setTab(t: SettingsTab): void {
    this.tab.set(t);
    this.error.set('');
    this.notice.set('');
    if (t === 'telephony' && !this.flows().length) this.loadFlows();
    if (t === 'compliance' && !this.sec()) this.loadSecurity();
  }

  async loadTelephony(): Promise<void> {
    try {
      const tv = await this.api.telephony();
      this.tel.set(tv);
      this.rotateIds.set(tv.rotate !== false);
    } catch { /* keep prior */ }
  }

  isCarrierConnected(key: string): boolean {
    return (this.tel()?.carriers || []).some((c: any) => c.key === key && c.status === 'connected');
  }

  openConnectModal(key?: string): void {
    const first = key || this.tel()?.catalog?.[0]?.key || 'ozonetel';
    this.selectCarrier(first);
    this.connectModalOpen.set(true);
  }
  closeConnectModal(): void { this.connectModalOpen.set(false); }
  selectCarrier(key: string): void {
    this.pickCarrier.set(key);
    this.carrierFields.set({});
    this.testRes.set(null);
  }
  setCarrierField(k: string, val: string): void {
    this.carrierFields.update((m) => ({ ...m, [k]: val }));
    this.testRes.set(null);
  }
  async testProvider(): Promise<void> {
    this.telBusy.set(true);
    try { this.testRes.set(await this.api.telTest({ carrier: this.pickCarrier(), fields: this.carrierFields() })); }
    catch { this.error.set('Could not test provider.'); }
    finally { this.telBusy.set(false); }
  }
  async submitConnectProvider(): Promise<void> {
    this.telBusy.set(true);
    this.error.set('');
    try {
      const tv = await this.api.telConnect({ carrier: this.pickCarrier(), fields: this.carrierFields() });
      this.tel.set(tv);
      this.connectModalOpen.set(false);
      await this.syncProviderFlows(this.pickCarrier());
      this.notice.set(`${this.pickedCarrierObj()?.name || this.pickCarrier()} connected.`);
    } catch (e: any) {
      this.error.set(e.message || 'Could not connect provider.');
    } finally {
      this.telBusy.set(false);
    }
  }
  askDisconnectCarrier(key: string, name?: string): void {
    this.confirmBox.set({
      title: `Disconnect ${name || key}?`,
      body: 'Campaigns assigned to this provider will pause until another trunk is active.',
      confirmLabel: 'Disconnect',
      danger: true,
      run: async () => {
        try {
          this.tel.set(await this.api.telDisconnect(key));
          this.notice.set('Provider disconnected.');
        } catch (e: any) { this.error.set(e.message || 'Could not disconnect.'); }
      },
    });
  }
  async runConfirmBox(): Promise<void> {
    const b = this.confirmBox(); if (!b) return;
    this.confirmBusy.set(true);
    try { await b.run(); this.confirmBox.set(null); }
    finally { this.confirmBusy.set(false); }
  }
  async saveTelSlots(): Promise<void> {
    this.telBusy.set(true);
    try {
      this.tel.set(await this.api.telSlots({ rotate: this.rotateIds() }));
      this.notice.set('Caller ID rotation saved.');
    } catch { this.error.set('Could not save routing.'); }
    finally { this.telBusy.set(false); }
  }
  async syncProviderFlows(provider: string): Promise<void> {
    const orgId = this.auth.currentOrgId();
    if (!orgId) return;
    this.syncing.set(true);
    try {
      await this.api.fetchFlows(orgId, provider).catch(() => null);
      await this.loadFlows();
    } finally {
      this.syncing.set(false);
    }
  }

  async loadFlows(): Promise<void> {
    const orgId = this.auth.currentOrgId();
    if (!orgId) return;
    this.flowsLoading.set(true);
    try {
      const res = await this.api.telephonyFlows(orgId);
      this.flows.set(res.flows || []);
    } catch {
      this.flows.set([]);
    } finally {
      this.flowsLoading.set(false);
    }
  }

  async toggleFlow(f: any, enabled: boolean): Promise<void> {
    const orgId = this.auth.currentOrgId();
    if (!orgId) return;
    this.toggling.set(f.name);
    this.error.set('');
    try {
      const updated = await this.api.setFlowEnabled(orgId, f.name, enabled);
      this.flows.update((list) => list.map((x) => (x.name === f.name ? updated : x)));
    } catch (e: any) {
      this.error.set(e.message || 'Could not update flow');
    } finally {
      this.toggling.set(null);
    }
  }

  async loadSecurity(): Promise<void> {
    try {
      const v = await this.api.security();
      this.savedSec.set(structuredClone(v));
      this.sec.set(structuredClone(v));
      const storedConsent = localStorage.getItem('echo_consent_announcement');
      const consent = storedConsent === null ? true : storedConsent === 'true';
      this.savedConsent.set(consent);
      this.consentAnnouncement.set(consent);
    } catch { /* ignore */ }
  }
  patchSec(part: Partial<SecurityView>): void {
    this.sec.update((s) => (s ? { ...s, ...part } : s));
  }
  patchRet(part: Partial<SecurityView['retention']>): void {
    this.sec.update((s) => (s ? { ...s, retention: { ...s.retention, ...part } } : s));
  }
  resetSec(): void {
    if (this.savedSec()) this.sec.set(structuredClone(this.savedSec()!));
    this.consentAnnouncement.set(this.savedConsent());
  }
  async saveSec(): Promise<void> {
    if (!this.sec()) return;
    this.secBusy.set(true);
    try {
      const v = await this.api.saveSecurity(this.sec());
      this.savedSec.set(structuredClone(v));
      this.sec.set(structuredClone(v));
      localStorage.setItem('echo_consent_announcement', String(this.consentAnnouncement()));
      this.savedConsent.set(this.consentAnnouncement());
      this.notice.set('Compliance & PII settings saved.');
    } catch { this.error.set('Could not save compliance settings.'); }
    finally { this.secBusy.set(false); }
  }
  async previewDelete(): Promise<void> {
    this.delMsg.set('');
    try {
      const r = await this.api.deleteContact({ phone: this.delPhone() });
      this.delPreview.set(r.preview);
    } catch (e: any) { this.error.set(e.message || 'Lookup failed'); }
  }
  askConfirmDelete(): void {
    const p = this.delPreview();
    this.confirmBox.set({
      title: `Delete records for ${this.delPhone()}?`,
      body: `This permanently deletes ${p?.calls ?? 0} call records and ${p?.recordings ?? 0} recordings for reason "${this.delReason()}". This action cannot be undone.`,
      confirmLabel: 'Delete permanently',
      danger: true,
      run: () => this.confirmDelete(),
    });
  }
  async confirmDelete(): Promise<void> {
    try {
      const r = await this.api.deleteContact({ phone: this.delPhone(), confirm: true, reason: this.delReason() });
      this.delMsg.set(r.note || 'Deleted.');
      this.delPreview.set(null);
      this.delPhone.set('');
      this.delReason.set('');
    } catch (e: any) { this.error.set(e.message || 'Delete failed'); }
  }
}
