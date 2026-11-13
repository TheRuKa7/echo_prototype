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
    <div class="page-head">
      <h1>Agent playground <span class="tag">Beta</span></h1>
      <p class="sub">Arrange STT, LLM and TTS on the canvas, pick a provider for each stage, then run a live test call from your browser mic.</p>
    </div>

    <div class="pg-bar">
      <label class="pg-agent"><span class="field-label">Agent</span>
        <select class="select" [ngModel]="agentKey()" (ngModelChange)="agentKey.set($event)" aria-label="Agent">
          @for (a of agents(); track a.key) { <option [value]="a.key">{{ a.label || a.key }}</option> }
        </select>
      </label>
      <button type="button" class="btn primary" (click)="toggleCall()">
        <app-icon [name]="live() ? 'hangup' : 'phone'" [size]="16"></app-icon> {{ live() ? 'End test call' : 'Start test call' }}
      </button>
      <span class="pill" [class.live]="live()">{{ live() ? 'In call' : 'Call ended' }}</span>
    </div>

    <section class="card pg-card" aria-label="Pipeline canvas">
      <h2 class="pg-h">Pipeline canvas <small>pick a provider per stage</small></h2>
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
          @if (i < stages.length - 1) { <span class="pg-arrow" aria-hidden="true">→</span> }
        }
      </div>
    </section>

    <div class="pg-two">
      <section class="card pg-card" aria-label="Call details">
        <h2 class="pg-h">Call details <small>replaces the tokens in the prompt for this call only</small></h2>
        @for (v of vars(); track v.key) {
          <label class="pg-var"><span class="field-label">{{ v.key }}</span><input class="input" [ngModel]="values()[v.key] || ''" (ngModelChange)="setValue(v.key, $event)" [attr.aria-label]="v.key" /></label>
        } @empty { <p class="hint">This agent takes no call data.</p> }
      </section>

      <section class="card pg-card" aria-label="Transcript">
        <h2 class="pg-h">Transcript <small>{{ turns().length }} turns</small></h2>
        @for (t of turns(); track $index) { <p class="pg-turn" [class.agent]="t.who === 'Agent'"><b>{{ t.who }}</b> {{ t.text }}</p> }
        @empty { <p class="hint">Nothing said yet. Start a test call and the conversation appears here as it happens.</p> }
      </section>
    </div>
  `,
  styles: [`
    .tag { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line, #333); vertical-align: middle; margin-left: 8px; }
    .pg-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin: 16px 0; }
    .pg-agent { display: grid; gap: 4px; min-width: min(320px, 100%); }
    .pg-card { padding: 16px; margin-bottom: 16px; }
    .pg-h { margin: 0 0 12px; font-size: 15px; } .pg-h small { font-weight: 400; color: var(--muted, #888); margin-left: 8px; font-size: 12px; }
    .pg-stages { display: flex; flex-wrap: wrap; gap: 12px; align-items: stretch; }
    .pg-stage { flex: 1 1 200px; border: 1px solid var(--line, #333); border-radius: 12px; padding: 12px; display: grid; gap: 10px; align-content: start; }
    .pg-stage-h { display: grid; } .pg-stage-h small { color: var(--muted, #888); }
    .pg-opts { display: grid; gap: 6px; }
    .pg-opt { text-align: left; min-height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line, #333); background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .pg-opt.on { border-color: var(--accent, #1fa971); background: color-mix(in srgb, var(--accent, #1fa971) 14%, transparent); font-weight: 600; }
    .pg-arrow { align-self: center; color: var(--muted, #888); }
    .pg-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .pg-var { display: grid; gap: 4px; margin-bottom: 10px; }
    .pg-turn { margin: 0 0 8px; } .pg-turn b { margin-right: 6px; } .pg-turn.agent b { color: var(--accent, #1fa971); }
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
  turns = signal<{ who: string; text: string }[]>([]);
  vars = computed(() => this.agents().find((a) => a.key === this.agentKey())?.input_variables || []);

  ngOnInit(): void {
    this.api.agents().then((a) => { this.agents.set(a); if (a[0]) this.agentKey.set(a[0].key); }).catch(() => this.agents.set([]));
  }
  choose(stage: Stage['id'], provider: string): void { this.pick.update((p) => ({ ...p, [stage]: provider })); }
  setValue(key: string, v: string): void { this.values.update((m) => ({ ...m, [key]: v })); }
  toggleCall(): void {
    const on = !this.live();
    this.live.set(on);
    this.turns.set(on ? [{ who: 'Agent', text: 'Hello, this is a test call on ' + this.pick().stt + ', ' + this.pick().llm + ' and ' + this.pick().tts + '.' }] : this.turns());
  }
}
