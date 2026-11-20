import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { callStatuses, GROUPS, CAMPAIGN_STATUSES } from '../../utils/status';

interface Topic { id: string; title: string; icon: string; guides?: string[]; body: string[]; link?: { to: string; label: string } }

/**
 * Documentation inside Echo: how the product works, in plain words, built from
 * the same data the screens use (statuses and their rules come from utils/status,
 * animations from the guides), so it never drifts from the product.
 * A public docs site can replace or link from here later.
 */
@Component({
  selector: 'app-docs',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    <div class="page docs">
      <div class="page-head">
        <h1 class="page-title">Documentation</h1>
        <label class="docs-search"><app-icon name="search" [size]="14"></app-icon><input class="input" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Search the docs" aria-label="Search the docs" /></label>
      </div>
      <div class="docs-grid">
        <nav class="docs-toc" aria-label="Topics">
          @for (t of shown(); track t.id) { <a [href]="'/docs#' + t.id" (click)="go($event, t.id)"><app-icon [name]="t.icon" [size]="14"></app-icon> {{ t.title }}</a> }
          @if (showStatuses()) { <a href="/docs#statuses" (click)="go($event, 'statuses')"><app-icon name="activity" [size]="14"></app-icon> Call statuses</a> }
          @if (showKeys()) { <a href="/docs#keys" (click)="go($event, 'keys')"><app-icon name="key" [size]="14"></app-icon> Keyboard</a> }
        </nav>
        <div class="docs-body">
          @for (t of shown(); track t.id) {
            <section class="card docs-sec" [id]="t.id" tabindex="-1">
              <div class="card-head"><h2 class="card-title"><app-icon [name]="t.icon" [size]="14"></app-icon> {{ t.title }}</h2>
                @if (t.link) { <a class="btn btn-sm" [routerLink]="t.link.to">{{ t.link.label }}</a> }</div>
              <div class="card-body">
                @for (p of t.body; track $index) { <p class="docs-p">{{ p }}</p> }
              </div>
            </section>
          }

          @if (showStatuses()) {
            <section class="card docs-sec" id="statuses" tabindex="-1">
              <div class="card-head"><h2 class="card-title"><app-icon name="activity" [size]="14"></app-icon> Call statuses</h2></div>
              <div class="card-body">
                <p class="docs-p">Every call ends with one status based on carrier signalling and agent speech detection. Rules run top to bottom.</p>
                @for (g of groups; track g.key) {
                  <h3 class="docs-h">{{ g.label }} <span class="row-sub">· {{ g.help }}</span></h3>
                  <div class="scroll-x">
                    <table class="table docs-table">
                      <thead><tr><th>Status</th><th>What it means</th><th>How it is decided</th><th>Tried again by default</th></tr></thead>
                      <tbody>@for (s of byGroup(g.key); track s.key) { <tr><td><span [class]="'tag ' + s.cls">{{ s.label }}</span></td><td>{{ s.help }}</td><td class="docs-rule">{{ s.ozonetel }}</td><td>{{ s.retry ? 'Yes' : 'No' }}</td></tr> }</tbody>
                    </table>
                  </div>
                }
                <h3 class="docs-h">Campaign statuses</h3>
                <ul class="docs-list">@for (c of campaign; track c.key) { <li><span [class]="'tag ' + c.cls">{{ c.label }}</span> {{ c.hint }}</li> }</ul>
              </div>
            </section>
          }

          @if (showKeys()) {
            <section class="card docs-sec" id="keys" tabindex="-1">
              <div class="card-head"><h2 class="card-title"><app-icon name="key" [size]="14"></app-icon> Keyboard</h2></div>
              <div class="card-body">
                <dl class="docs-keys">
                  <dt><kbd>Tab</kbd></dt><dd>Move between controls; info icons open on focus</dd>
                  <dt><kbd>Esc</kbd></dt><dd>Close a popover, menu or modal</dd>
                  <dt><kbd>j</kbd> / <kbd>k</kbd></dt><dd>Next or previous call on a call page</dd>
                  <dt><kbd>Space</kbd></dt><dd>Play or pause a recording</dd>
                  <dt><kbd>Ctrl</kbd> + <kbd>S</kbd></dt><dd>Save an agent</dd>
                </dl>
              </div>
            </section>
          }

          @if (!shown().length && !showStatuses() && !showKeys() && q()) {
            <div class="empty"><div class="empty-title">Nothing matches "{{ q() }}"</div><div class="empty-sub">Try status, retry, whatsapp, telephony or compliance.</div></div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .docs { max-width: 1200px; }
    .docs-search { position: relative; width: min(320px, 100%); }
    .docs-search app-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--ds-text-placeholder); pointer-events: none; }
    .docs-search .input { padding-left: 32px; }
    .docs-grid { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 16px; align-items: start; }
    .docs-toc { position: sticky; top: 8px; display: grid; gap: 2px; z-index: 1; }
    .docs-toc a { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 10px; border-radius: var(--ds-r-sm); color: var(--ds-text-2); font-size: var(--ds-fs-base); text-decoration: none; }
    .docs-toc a:hover { background: var(--ds-hover); color: var(--ds-text); }
    .docs-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; }
    .docs-sec { scroll-margin-top: 12px; }
    .docs-sec h2.card-title { margin: 0; font-size: var(--ds-fs-sm); }
    .docs-p { margin: 0 0 8px; font-size: var(--ds-fs-md); line-height: 1.6; color: var(--ds-text-2); max-width: 72ch; }
    .docs-h { font-size: var(--ds-fs-md); font-weight: 650; margin: 16px 0 6px; color: var(--ds-text); }
    .docs-table th, .docs-table td { padding: 8px 10px; text-align: left; vertical-align: top; font-size: var(--ds-fs-base); }
    .docs-table th { white-space: nowrap; }
    .docs-rule { color: var(--ds-text-muted); min-width: 260px; }
    .docs-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: var(--ds-fs-base); color: var(--ds-text-2); }
    .docs-keys { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin: 0; font-size: var(--ds-fs-base); }
    .docs-keys dd { margin: 0; color: var(--ds-text-2); }
    kbd { font-family: var(--ds-mono); font-size: var(--ds-fs-xs); padding: 1px 6px; border: 1px solid var(--ds-border-strong); border-bottom-width: 2px; border-radius: var(--ds-r-xs); background: var(--ds-surface-sunken); color: var(--ds-text); }
    @media (max-width: 860px) { .docs-grid { grid-template-columns: minmax(0, 1fr); } .docs-toc { position: static; display: flex; flex-wrap: wrap; } }
    @media (max-width: 720px) { .docs-rule { min-width: 0; } .docs-table th, .docs-table td { white-space: normal; font-size: 12px; padding: 6px; } }
  `],
})
export class DocsComponent {
  q = signal('');
  readonly groups = GROUPS.filter((g) => g.key !== 'in_progress').concat(GROUPS.filter((g) => g.key === 'in_progress'));
  readonly campaign = CAMPAIGN_STATUSES;
  byGroup(g: string) { return callStatuses().filter((s) => s.group === g); }
  readonly topics: Topic[] = [
    { id: 'start', title: 'Getting started', icon: 'play', link: { to: '/campaigns', label: 'Open Campaigns' }, body: [
      '1. Connect a telephony provider and enable calling flows in Settings.',
      '2. Configure an agent on the workflow canvas: prompt, voice modal, knowledge files, and answers.',
      '3. Run a test call from Call console or Agent playground.',
      '4. Start a campaign by uploading an .xlsx or .csv sheet using the agent template.'] },
    { id: 'agents', title: 'Agents & workflow canvas', icon: 'bot', link: { to: '/agents', label: 'Open Agents' }, body: [
      'Each agent opens onto a full-width 2D node workflow with dedicated edit modals: Dial & Retries, Pre-call Functions & Variables, Knowledge Base (Files, Text snippets, and Web URLs with 30-day usage limits and live indexing status), Agent Prompt/Settings & Safety/PII overrides, Voice, Post-call Extraction fields, Deterministic Goals, and Post-call WhatsApp (Kaleyra) / System Sync.',
      'Click any canvas node or individual extraction/input row to open its clean modal editor without right-sidebar clutter.'] },
    { id: 'goals', title: 'Deterministic goals (Call & Campaign)', icon: 'target', link: { to: '/agents', label: 'Configure Goals' }, body: [
      'Call-level goals evaluate extracted post-call output variables deterministically with optional activation filters (When) and multi-condition ALL/ANY rules: matching Positive (without Negative) = Positive, matching Negative (without Positive) = Negative, and falling between or matching both resolves to Partial.',
      'Campaign-level goals aggregate extracted outputs cumulatively across answered campaign calls (SUM, COUNT, PERCENT, AVG, MAX, MIN), such as tracking total committed packaging demand toward a 100,000-unit target or identifying the maximum commitment supplier.'] },
    { id: 'tools', title: 'Tool integrations: Functions, Code, Webhook & MCP', icon: 'plug', link: { to: '/agents', label: 'Configure on Agent' }, body: [
      'Functions: Built-in actions (such as End Call with SIP headers) or Custom Functions that call external HTTP APIs (GET/POST/PUT/PATCH/DELETE) during a call with Form or JSON Schema inputs, Output variable mappings, Wait-for-completion audio options, or async execution.',
      'Code Tools: Sandboxed JavaScript snippets inside the agent with dv.<var> dynamic variable access, HTTP fetch(), Execution mode controls, and Store Fields as Variables.',
      'Webhook: Agent-level HTTPS webhook endpoint receiving real-time lifecycle events (Call started, Call ended, Call analyzed, Transcript updated, and Transfer events) with configurable timeout and Setup test.',
      'MCP: Model Context Protocol (MCP) server endpoints with masked URL storage, configurable millisecond timeout, HTTP headers, and query parameters for external tool discovery.'] },
    { id: 'campaigns', title: 'Campaigns', icon: 'megaphone', body: [
      'Upload a spreadsheet matching the agent template to validate phone numbers, required columns, and Do-not-call matches before dialling starts.',
      'Inspect the Overview funnel nodes, collapsible outcome breakdowns, compact call logs, audio recordings, and full transcripts per answered conversation.'] },
    { id: 'retries', title: 'Retries & callbacks', icon: 'repeat', body: [
      'Toggle retry triggers using compact state buttons and preview retry timestamps under each country calling window.',
      'Configure doubling or fixed wait intervals and trigger callbacks or follow-ups from extracted post-call fields.'] },
    { id: 'telephony', title: 'Telephony, compliance & DNC', icon: 'route', link: { to: '/settings', label: 'Open Settings' }, body: [
      'Settings organizes providers and synced calling flows under Telephony; granular Personal Info Redaction (14 PII categories across Identity, Contact, Government IDs, Financial, Security Credentials, and Health), Input/Output Safety Guardrails, DPDP/GDPR erasure, and country calling rules under Compliance; blocked numbers under Do-not-call; and live health under Status & health.',
      'Answered calls shorter than the No reply threshold count as No reply by default.'] },
    { id: 'whatsapp', title: 'WhatsApp via Kaleyra', icon: 'plug', body: [
      'Configure a post-call Kaleyra WhatsApp node per agent to send confirmation or callback templates automatically once a call finishes.'] },
  ];
  shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    return q ? this.topics.filter((t) => (t.title + ' ' + t.body.join(' ')).toLowerCase().includes(q)) : this.topics;
  });
  showStatuses = computed(() => {
    const q = this.q().trim().toLowerCase();
    if (!q) return true;
    const statusText = 'call statuses ' + this.groups.map((g) => g.label + ' ' + g.help).join(' ') + ' ' + callStatuses().map((s) => s.label + ' ' + s.help + ' ' + s.ozonetel).join(' ') + ' ' + this.campaign.map((c) => c.label + ' ' + c.hint).join(' ');
    return statusText.toLowerCase().includes(q);
  });
  showKeys = computed(() => {
    const q = this.q().trim().toLowerCase();
    return !q || 'keyboard shortcuts tab esc j k space ctrl+s save'.includes(q);
  });
  go(e: Event, id: string): void {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }
}
