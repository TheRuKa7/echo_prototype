import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { GuideComponent } from '../../components/guide/guide.component';

/**
 * New campaign in one modal, three short steps: pick the agent, drop the list,
 * start. The list is checked before anything is created, so the user sees
 * "20 rows become 7 calls" first, and nothing is left half made if they cancel.
 */
@Component({
  selector: 'app-new-campaign',
  standalone: true,
  imports: [FormsModule, IconComponent, GuideComponent],
  template: `
    <div class="modal-backdrop" (click)="close()">
      <div class="modal nc" role="dialog" aria-label="New campaign" (click)="$event.stopPropagation()">
        <div class="modal-head nc-head">
          <div class="modal-title">New campaign</div>
          <ol class="nc-steps" aria-label="Steps">
            @for (s of STEPS; track s.n) {
              <li [class.on]="step() === s.n" [class.done]="step() > s.n"><span>{{ step() > s.n ? '✓' : s.n }}</span>{{ s.label }}</li>
            }
          </ol>
          <button class="btn-icon" (click)="close()" aria-label="Close"><app-icon name="close" [size]="16"></app-icon></button>
        </div>

        <div class="modal-body nc-body">
          @if (error()) { <div class="note bad">{{ error() }}</div> }

          @if (step() === 1) {
            @if (agents().length > 6) {
              <label class="nc-search"><app-icon name="search" [size]="14"></app-icon><input class="input" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Find an agent" aria-label="Find an agent" /></label>
            }
            <div class="nc-agents" role="radiogroup" aria-label="Agent">
              @for (a of shownAgents(); track a.key) {
                <div [class]="'nc-agent' + (agent() === a.key ? ' on' : '') + (!a.ozonetel_campaign ? ' off' : '')" role="radio" tabindex="0"
                  [attr.aria-checked]="agent() === a.key" (click)="pick(a)" (keydown.enter)="pick(a)">
                  <span class="nc-agent-icon"><app-icon name="bot" [size]="16"></app-icon></span>
                  <span class="nc-agent-main">
                    <b>{{ a.label }}</b>
                    <span class="row-sub">{{ a.ozonetel_campaign ? a.input_columns?.length + ' columns · line ' + a.ozonetel_campaign : 'No calling line yet: set it in the agent first' }}</span>
                  </span>
                  @if (agent() === a.key) { <app-icon name="check" [size]="16" class="nc-tick"></app-icon> }
                </div>
              }
            </div>
            <input class="input" style="margin-top: 12px" [ngModel]="note()" (ngModelChange)="note.set($event)" placeholder="Add a note for your team (optional)" aria-label="Note" />
          }

          @if (step() === 2) {
            <label [class]="'nc-drop' + (dragging() ? ' drag' : '') + (file() ? ' has' : '')"
              (dragover)="$event.preventDefault(); dragging.set(true)" (dragleave)="dragging.set(false)" (drop)="onDrop($event)">
              <input type="file" accept=".xlsx,.xlsm" hidden (change)="onFile($any($event.target).files?.[0])" />
              @if (!file()) {
                <app-icon name="upload" [size]="26"></app-icon>
                <b>Drop your sheet here</b>
                <span class="row-sub">or click to choose an .xlsx file</span>
              } @else {
                <app-icon name="table" [size]="26"></app-icon>
                <b>{{ file()!.name }}</b>
                <span class="row-sub">Click to choose another file</span>
              }
            </label>
            <div class="nc-template">
              No sheet yet? <a class="link" [href]="api.agentTemplateUrl(agent())" download>Download the template for {{ current()?.label }}</a>
            </div>

            @if (checking()) {
              <div class="nc-flow"><span class="row-sub">Reading your sheet…</span></div>
            } @else if (check(); as c) {
              <div class="nc-flow">
                <div class="nc-num"><b>{{ c.rows }}</b><span>rows</span></div>
                <app-icon name="chevronRight" [size]="20"></app-icon>
                <div class="nc-num ok"><b>{{ c.calls }}</b><span>calls</span></div>
                @if (c.calls < c.rows) { <span class="row-sub nc-why">Rows for the same contact share a call <app-guide topic="group_rows"></app-guide></span> }
              </div>
              @if (c.missing_columns?.length) { <div class="note bad">Missing columns: <span class="mono">{{ c.missing_columns.join(', ') }}</span>. Add them, or use the template.</div> }
              @if (c.bad) { <div class="note">{{ c.bad }} row{{ c.bad === 1 ? ' has a phone number' : 's have phone numbers' }} that cannot be dialled; {{ c.bad === 1 ? 'it' : 'they' }} will be skipped.</div> }
            }
          }

          @if (step() === 3) {
            <div class="nc-review">
              <div><span class="row-sub">Agent</span><b>{{ current()?.label }}</b></div>
              <div><span class="row-sub">List</span><b>{{ file()?.name }}</b></div>
              <div><span class="row-sub">Calls</span><b>{{ check()?.calls }}</b></div>
              <div><span class="row-sub">Line</span><b class="mono">{{ current()?.ozonetel_campaign }}</b></div>
            </div>
            <div class="note">These are real calls. They start right away and follow the agent's calling rules.</div>
          }
        </div>

        <div class="modal-foot">
          @if (step() > 1) { <button class="btn" (click)="step.set(step() - 1)" [disabled]="busy()">Back</button> }
          <span style="flex: 1"></span>
          @if (step() === 1) { <button class="btn btn-primary" (click)="step.set(2)" [disabled]="!canNext1()">Next</button> }
          @if (step() === 2) { <button class="btn btn-primary" (click)="step.set(3)" [disabled]="!check() || checking() || !check()?.calls">Next</button> }
          @if (step() === 3) {
            <button class="btn" (click)="start(false)" [disabled]="busy()" title="Create the campaign and upload later">Save without calling</button>
            <button class="btn btn-primary" (click)="start(true)" [disabled]="busy()"><app-icon name="phoneOut" [size]="14"></app-icon> {{ busy() ? 'Starting…' : 'Start ' + check()?.calls + ' calls' }}</button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nc { max-width: 560px; width: calc(100vw - 32px); }
    .nc-head { display: flex; align-items: center; gap: 12px; }
    .nc-steps { display: flex; gap: 14px; list-style: none; margin: 0 0 0 auto; padding: 0; font-size: 12px; color: var(--faint); }
    .nc-steps li { display: flex; align-items: center; gap: 6px; }
    .nc-steps li span { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line); font-size: 10.5px; }
    .nc-steps li.on { color: var(--ink); font-weight: 600; } .nc-steps li.on span { background: var(--red); border-color: var(--red); color: #fff; }
    .nc-steps li.done span { background: var(--green-wash, #dcfce7); border-color: transparent; color: var(--green-ink, #15803d); }
    .nc-body { min-height: 260px; }
    .nc-search { position: relative; display: block; margin-bottom: 10px; }
    .nc-search app-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--faint); }
    .nc-search input { padding-left: 30px; width: 100%; }
    .nc-agents { display: grid; gap: 6px; max-height: 300px; overflow-y: auto; }
    .nc-agent { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
    .nc-agent:hover { border-color: var(--ink-3); }
    .nc-agent.on { border-color: var(--red); box-shadow: 0 0 0 3px var(--red-wash); }
    .nc-agent.off { opacity: .55; cursor: not-allowed; }
    .nc-agent-icon { width: 30px; height: 30px; border-radius: 8px; background: var(--raised); display: inline-flex; align-items: center; justify-content: center; color: var(--ink-3); }
    .nc-agent-main { display: grid; min-width: 0; } .nc-agent-main b { font-size: 13.5px; color: var(--ink); }
    .nc-tick { margin-left: auto; color: var(--red); }
    .nc-drop { display: grid; justify-items: center; gap: 4px; padding: 28px 16px; border: 2px dashed var(--line); border-radius: 14px; cursor: pointer; color: var(--ink-3); text-align: center; transition: border-color .15s, background .15s; }
    .nc-drop:hover, .nc-drop.drag { border-color: var(--red); background: var(--red-wash); }
    .nc-drop.has { border-style: solid; }
    .nc-template { font-size: 12.5px; color: var(--muted); margin-top: 8px; }
    .nc-flow { display: flex; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .nc-num { display: grid; justify-items: center; padding: 8px 18px; border-radius: 12px; background: var(--raised); }
    .nc-num b { font-size: 24px; color: var(--ink); line-height: 1.1; } .nc-num span { font-size: 11.5px; color: var(--muted); }
    .nc-num.ok { background: var(--green-wash, #dcfce7); } .nc-num.ok b { color: var(--green-ink, #15803d); }
    .nc-why { display: inline-flex; align-items: center; }
    .nc-review { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .nc-review > div { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; min-width: 0; }
    .nc-review b { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media (max-width: 560px) { .nc-steps { display: none; } .nc-review { grid-template-columns: 1fr; } }
  `],
})
export class NewCampaignComponent implements OnInit {
  @Output() closed = new EventEmitter<void>();
  api = inject(ApiService);
  private router = inject(Router);

  readonly STEPS = [{ n: 1, label: 'Agent' }, { n: 2, label: 'List' }, { n: 3, label: 'Start' }];
  step = signal(1);
  agents = signal<any[]>([]);
  q = signal('');
  agent = signal('');
  note = signal('');
  file = signal<File | null>(null);
  check = signal<any>(null);
  checking = signal(false);
  dragging = signal(false);
  busy = signal(false);
  error = signal('');

  current = computed(() => this.agents().find((a) => a.key === this.agent()));
  shownAgents = computed(() => {
    const t = this.q().trim().toLowerCase();
    return t ? this.agents().filter((a) => a.label.toLowerCase().includes(t)) : this.agents();
  });
  canNext1 = computed(() => !!this.current()?.ozonetel_campaign);

  ngOnInit(): void {
    this.api.agents().then((list: any[]) => {
      this.agents.set(list);
      const first = list.find((a) => a.ozonetel_campaign);
      if (first) this.agent.set(first.key);
    }).catch((e) => this.error.set(e.message));
  }

  pick(a: any): void {
    if (!a.ozonetel_campaign) return;
    if (a.key !== this.agent()) { this.agent.set(a.key); this.file.set(null); this.check.set(null); }
  }
  onDrop(e: DragEvent): void { e.preventDefault(); this.dragging.set(false); this.onFile(e.dataTransfer?.files?.[0]); }
  async onFile(f?: File): Promise<void> {
    if (!f) return;
    this.error.set('');
    if (!/\.xlsx?$|\.xlsm$/i.test(f.name)) { this.error.set('Use an .xlsx sheet. The template is a good start.'); return; }
    this.file.set(f); this.check.set(null); this.checking.set(true);
    try { this.check.set(await this.api.checkAgentFile(this.agent(), f)); }
    catch (e: any) { this.error.set(e.message); }
    finally { this.checking.set(false); }
  }

  async start(dial: boolean): Promise<void> {
    const a = this.current(); const f = this.file();
    if (!a || !f) return;
    this.busy.set(true); this.error.set('');
    try {
      const keys = (a.providers || []).map((p: any) => p.key);
      const created = await this.api.createCampaign({ agent: a.key, provider: keys.includes('gemini') ? 'gemini' : keys[0] || 'gemini', direction: 'outbound', description: this.note().trim() });
      if (dial) await this.api.uploadContacts(created.campaign_id, f, { dryRun: false });
      this.closed.emit();
      this.router.navigate(['/campaigns', created.campaign_id]);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }
  close(): void { if (!this.busy()) this.closed.emit(); }
}
