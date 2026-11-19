import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';

interface Stage { id: 'stt' | 'llm' | 'tts'; label: string; hint: string; providers: string[]; }

const STAGES: Stage[] = [
  { id: 'stt', label: 'STT', hint: 'speech to text', providers: ['Google Cloud STT', 'OpenAI', 'Soniox'] },
  { id: 'llm', label: 'LLM', hint: 'generates the reply', providers: ['Gemini', 'OpenAI', 'DeepSeek'] },
  { id: 'tts', label: 'TTS', hint: 'text to speech', providers: ['ElevenLabs', 'OpenAI', 'Sarvam'] },
];

@Component({
  selector: 'app-playground',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Agent playground <span class="tag">Beta</span></h1>
        </div>
      </div>

    <div class="pg-bar">
      <label class="pg-agent"><span class="field-label">Agent</span>
        <select class="select" [ngModel]="agentKey()" (ngModelChange)="agentKey.set($event)" aria-label="Agent">
          @for (a of agents(); track a.key) { <option [value]="a.key">{{ a.label || a.key }}</option> }
        </select>
      </label>
      <button type="button" class="btn btn-primary" (click)="toggleCall()">
        <app-icon [name]="live() ? 'hangup' : 'phone'" [size]="16"></app-icon> {{ live() ? 'End test call' : 'Start test call' }}
      </button>
      <span class="pill" [class.live]="live()">{{ live() ? 'In call' : ranOnce() ? 'Call ended' : 'Ready' }}</span>
    </div>

    <section class="card pg-card" aria-label="Pipeline canvas">
      <h2 class="pg-h">Pipeline <small>provider per stage</small></h2>
      <div class="pg-stages">
        @for (s of stages; track s.id; let i = $index) {
          <div class="pg-stage">
            <div class="pg-stage-h"><b>{{ s.label }}</b><small>{{ s.hint }}</small></div>
            <div class="pg-opts" role="radiogroup" [attr.aria-label]="s.label + ' provider'">
              @for (p of s.providers; track p) {
                <button type="button" role="radio" class="pg-opt" [class.on]="pick()[s.id] === p" [attr.aria-checked]="pick()[s.id] === p" (click)="choose(s.id, p)">{{ p }}</button>
              }
            </div>
          </div>
          @if (i < stages.length - 1) { <span class="pg-arrow" aria-hidden="true"><app-icon name="chevronRight" [size]="14"></app-icon></span> }
        }
      </div>
    </section>

    <div class="pg-two">
      <section class="card pg-card" aria-label="Call details">
        <h2 class="pg-h">Call details <small>test variables for this call</small></h2>
        @for (v of vars(); track v.key) {
          <label class="pg-var"><span class="field-label">{{ niceKey(v.key) }}</span><input class="input" [ngModel]="values()[v.key] || ''" (ngModelChange)="setValue(v.key, $event)" [attr.aria-label]="niceKey(v.key)" /></label>
        } @empty { <p class="hint">This agent takes no call data.</p> }
      </section>

      <section class="card pg-card" aria-label="Transcript" aria-live="polite">
        <h2 class="pg-h">Transcript <small>{{ turns().length }} turns</small></h2>
        @for (t of turns(); track $index) { <p class="pg-turn" [class.agent]="t.who === 'Agent'"><b>{{ t.who }}</b> {{ t.text }}</p> }
        @empty { <p class="hint">Start a test call to view live transcript turns.</p> }
      </section>
    </div>
    </div>
  `,
  styles: [`
    .page-title .tag { vertical-align: middle; margin-left: 8px; }
    .pg-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin: 4px 0; }
    .pg-agent { display: grid; gap: 4px; min-width: min(320px, 100%); }
    .pg-card { padding: 14px 16px; }
    .pg-h { margin: 0 0 12px; font-size: 15px; } .pg-h small { font-weight: 400; color: var(--ds-text-muted, var(--muted)); margin-left: 8px; font-size: 12px; }
    .pg-stages { display: flex; flex-wrap: wrap; gap: 12px; align-items: stretch; }
    .pg-stage { flex: 1 1 200px; border: 1px solid var(--ds-border, var(--line)); border-radius: 12px; padding: 12px; display: grid; gap: 10px; align-content: start; }
    .pg-stage-h { display: grid; } .pg-stage-h small { color: var(--ds-text-muted, var(--muted)); }
    .pg-opts { display: grid; gap: 6px; }
    .pg-opt { text-align: left; min-height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--ds-border, var(--line)); background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .pg-opt.on { border-color: var(--ds-accent); background: var(--ds-accent-soft); color: var(--ds-accent-fg); font-weight: 600; }
    .pg-arrow { align-self: center; color: var(--ds-text-muted, var(--muted)); display: inline-flex; }
    .pg-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .pg-var { display: grid; gap: 4px; margin-bottom: 10px; }
    .pg-turn { margin: 0 0 8px; } .pg-turn b { margin-right: 6px; } .pg-turn.agent b { color: var(--ds-accent-fg); }
    @media (max-width: 720px) {
      .pg-stages { flex-direction: column; }
      .pg-stage { flex: none; width: 100%; }
      .pg-arrow { transform: rotate(90deg); align-self: center; margin: -4px 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pg-arrow { transition: none; }
    }
  `],
})
export class PlaygroundComponent implements OnInit {
  private api = inject(ApiService);
  stages = STAGES;
  agents = signal<any[]>([]);
  agentKey = signal('');
  pick = signal<Record<Stage['id'], string>>({ stt: 'Google Cloud STT', llm: 'Gemini', tts: 'ElevenLabs' });
  values = signal<Record<string, string>>({});
  live = signal(false);
  ranOnce = signal(false);
  turns = signal<{ who: string; text: string }[]>([]);
  vars = computed(() => this.agents().find((a) => a.key === this.agentKey())?.input_variables || []);

  ngOnInit(): void {
    this.api.agents().then((a) => { this.agents.set(a); if (a[0]) this.agentKey.set(a[0].key); }).catch(() => this.agents.set([]));
  }
  choose(stage: Stage['id'], provider: string): void { this.pick.update((p) => ({ ...p, [stage]: provider })); }
  setValue(key: string, v: string): void { this.values.update((m) => ({ ...m, [key]: v })); }
  niceKey(k: string): string { return k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/\bPo\b/g, 'PO'); }
  toggleCall(): void {
    const on = !this.live();
    this.live.set(on);
    this.ranOnce.set(true);
    this.turns.set(on ? [{ who: 'Agent', text: 'Hello, this is a test call on ' + this.pick().stt + ', ' + this.pick().llm + ' and ' + this.pick().tts + '.' }] : this.turns());
  }
}
