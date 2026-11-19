import { Component, HostListener, computed, effect, input, output, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface GuardrailsConfig {
  input: string[];
  output: string[];
}

export interface AgentPiiConfig {
  inherit: boolean;
  categories: string[];
}

export interface AgentGuardrailsConfig {
  inherit: boolean;
  input: string[];
  output: string[];
}

export interface PiiGroup {
  title: string;
  items: { key: string; label: string }[];
}

export const PII_GROUPS: PiiGroup[] = [
  {
    title: 'Identity Information',
    items: [
      { key: 'person_name', label: 'Person Name' },
      { key: 'date_of_birth', label: 'Date Of Birth' },
      { key: 'customer_account_number', label: 'Customer Account Number' },
    ],
  },
  {
    title: 'Contact Information',
    items: [
      { key: 'address', label: 'Address' },
      { key: 'email', label: 'Email' },
      { key: 'phone_number', label: 'Phone Number' },
    ],
  },
  {
    title: 'Government Identifiers',
    items: [
      { key: 'ssn', label: 'SSN' },
      { key: 'passport', label: 'Passport' },
      { key: 'driver_license', label: 'Driver License' },
    ],
  },
  {
    title: 'Financial Information',
    items: [
      { key: 'credit_card', label: 'Credit Card' },
      { key: 'bank_account', label: 'Bank Account' },
    ],
  },
  {
    title: 'Security Credentials',
    items: [
      { key: 'password', label: 'Password' },
      { key: 'pin', label: 'Pin' },
    ],
  },
  {
    title: 'Health Information',
    items: [
      { key: 'medical_id', label: 'Medical Id' },
    ],
  },
];

export const ALL_PII_KEYS: string[] = PII_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export const INPUT_GUARDRAILS: { key: string; label: string; tip: string }[] = [
  {
    key: 'jailbreaking',
    label: 'Platform Integrity (Jailbreaking)',
    tip: 'Blocks prompt injection, system-prompt extraction, and role-hijack attempts from callers.',
  },
];

export const OUTPUT_GUARDRAILS: { key: string; label: string; tip: string }[] = [
  { key: 'harassment', label: 'Harassment', tip: 'Prevents abusive, threatening, or harassing language in agent responses.' },
  { key: 'self_harm', label: 'Self-harm', tip: 'Blocks encouragement or instructions related to self-harm or suicide.' },
  { key: 'sexual_exploitation', label: 'Sexual Exploitation', tip: 'Restricts sexually explicit, abusive, or exploitative content.' },
  { key: 'violence', label: 'Violence', tip: 'Blocks depictions or encouragement of physical violence or weapons misuse.' },
  { key: 'defense_national_security', label: 'Defense & National Security', tip: 'Prevents guidance on restricted defense systems or critical infrastructure attacks.' },
  { key: 'illicit_harmful', label: 'Illicit & Harmful Activity', tip: 'Blocks instructions for illegal, fraudulent, or dangerous activities.' },
  { key: 'gambling', label: 'Gambling', tip: 'Restricts promoting or facilitating regulated wagering and gambling advice.' },
  { key: 'regulated_advice', label: 'Regulated Professional Advice', tip: 'Prevents unauthorized medical, legal, or licensed financial investment advice.' },
  { key: 'child_safety', label: 'Child Safety & Exploitation', tip: 'Zero-tolerance safeguard blocking any content endangering minors.' },
];

export const DEFAULT_PII_CATEGORIES: string[] = ['credit_card', 'bank_account', 'password', 'pin'];

export const DEFAULT_GUARDRAILS: GuardrailsConfig = {
  input: ['jailbreaking'],
  output: ['harassment', 'self_harm', 'sexual_exploitation', 'violence', 'child_safety'],
};

/**
 * Shared edit modals for granular Personal Info Redaction (PII) categories
 * and Input/Output Safety Guardrails (used in Settings -> Compliance and Agent Detail).
 */
@Component({
  selector: 'app-safety-privacy-modals',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (mode(); as m) {
      <div class="modal-backdrop" (click)="close.emit()">
        <div
          class="modal agent-modal sp-modal"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="m === 'pii' ? 'Personal Info Redaction (PII)' : 'Safety Guardrails'"
          (click)="$event.stopPropagation()"
        >
          <div class="modal-head">
            <div>
              <div class="modal-title sp-title">
                @if (m === 'guardrails') {
                  <app-icon name="shield" [size]="16"></app-icon>
                  <span>Safety Guardrails</span>
                } @else {
                  <app-icon name="lock" [size]="15"></app-icon>
                  <span>Personal Info Redaction (PII)</span>
                }
                @if (scopeLabel()) {
                  <span class="tag">{{ scopeLabel() }}</span>
                }
              </div>
              <div class="modal-sub">
                {{ m === 'pii'
                  ? 'Only redact the specific categories of sensitive data you choose, while preserving other call recordings, transcripts, and analytics.'
                  : 'Control which categories of risky or sensitive content are restricted in AI interactions.' }}
              </div>
            </div>
            <button type="button" class="btn-icon" aria-label="Close" (click)="close.emit()">
              <app-icon name="close" [size]="16"></app-icon>
            </button>
          </div>

          <div class="modal-body sp-body">
            @if (m === 'pii') {
              @for (grp of piiGroups; track grp.title) {
                <section class="sp-grp">
                  <div class="sp-grp-title">{{ grp.title }}</div>
                  <div class="sp-chk-grid">
                    @for (it of grp.items; track it.key) {
                      <label class="sp-chk">
                        <input
                          type="checkbox"
                          [checked]="hasPii(it.key)"
                          (change)="togglePii(it.key, $any($event.target).checked)"
                        />
                        <span>{{ it.label }}</span>
                      </label>
                    }
                  </div>
                </section>
              }
            } @else {
              <section class="sp-grp">
                <div class="sp-sec-h">Input Guardrails</div>
                <p class="sp-sec-sub">Apply safety checks to user inputs before processing.</p>
                <div class="sp-chk-col">
                  @for (it of inputGuardrails; track it.key) {
                    <label class="sp-chk">
                      <input
                        type="checkbox"
                        [checked]="hasGuard('input', it.key)"
                        (change)="toggleGuard('input', it.key, $any($event.target).checked)"
                      />
                      <span class="sp-tip" [attr.data-tip]="it.tip" [title]="it.tip" tabindex="0">{{ it.label }}</span>
                    </label>
                  }
                </div>
              </section>

              <hr class="sp-dash" />

              <section class="sp-grp">
                <div class="sp-sec-h">Output Guardrails</div>
                <p class="sp-sec-sub">Apply safety checks to system-generated responses.</p>
                <div class="sp-out-top">
                  @for (it of outputGuardrails.slice(0, 2); track it.key) {
                    <label class="sp-chk">
                      <input
                        type="checkbox"
                        [checked]="hasGuard('output', it.key)"
                        (change)="toggleGuard('output', it.key, $any($event.target).checked)"
                      />
                      <span class="sp-tip" [attr.data-tip]="it.tip" [title]="it.tip" tabindex="0">{{ it.label }}</span>
                    </label>
                  }
                </div>
                <div class="sp-chk-col">
                  @for (it of outputGuardrails.slice(2); track it.key) {
                    <label class="sp-chk">
                      <input
                        type="checkbox"
                        [checked]="hasGuard('output', it.key)"
                        (change)="toggleGuard('output', it.key, $any($event.target).checked)"
                      />
                      <span class="sp-tip" [attr.data-tip]="it.tip" [title]="it.tip" tabindex="0">{{ it.label }}</span>
                    </label>
                  }
                </div>
              </section>
            }
          </div>

          <div class="modal-foot sp-foot">
            <div class="sp-foot-left">
              <span class="row-sub mono">{{ activeCount() }} selected</span>
              <button type="button" class="btn btn-sm btn-ghost" (click)="selectAll()">Select all</button>
              <button type="button" class="btn btn-sm btn-ghost" (click)="clearAll()">Clear</button>
            </div>
            <div class="sp-foot-right">
              <button type="button" class="btn" (click)="close.emit()">Cancel</button>
              <button type="button" class="btn btn-primary" (click)="submit()">Save</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .sp-modal { width: min(500px, 100%); max-width: none; }
    .sp-title { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .sp-body { display: grid; gap: 14px; align-content: start; }
    .sp-grp { display: grid; gap: 8px; }
    .sp-grp-title { font-size: 12px; font-weight: 500; color: var(--ds-text-muted); }
    .sp-sec-h { font-size: 13.5px; font-weight: 600; color: var(--ds-text); }
    .sp-sec-sub { margin: -4px 0 2px; font-size: 12px; line-height: 1.45; color: var(--ds-text-muted); }
    .sp-chk-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px 14px; }
    .sp-chk-col { display: grid; gap: 9px; }
    .sp-out-top { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-bottom: 1px; }
    .sp-chk {
      display: inline-flex; align-items: flex-start; gap: 8px; cursor: pointer;
      font-size: 13px; line-height: 1.35; color: var(--ds-text); min-width: 0;
    }
    .sp-chk input {
      margin: 2px 0 0; width: 15px; height: 15px; flex-shrink: 0;
      accent-color: var(--ds-accent); cursor: pointer;
    }
    .sp-tip {
      position: relative;
      text-decoration: underline dotted var(--ds-border-strong);
      text-underline-offset: 3px;
      outline: none;
    }
    .sp-tip:hover::after,
    .sp-tip:focus-visible::after {
      content: attr(data-tip);
      position: absolute; left: 0; bottom: calc(100% + 6px); z-index: 40;
      width: max-content; max-width: min(260px, 72vw);
      padding: 6px 9px; border-radius: var(--ds-r-sm);
      background: var(--ds-tooltip-bg); color: var(--ds-tooltip-text);
      font-size: 11.5px; line-height: 1.35; text-decoration: none;
      box-shadow: var(--ds-shadow-md); pointer-events: none;
    }
    .sp-dash { border: 0; border-top: 1px dashed var(--ds-border-strong); margin: 2px 0; }
    .sp-foot { flex-wrap: wrap; gap: 8px; justify-content: space-between; }
    .sp-foot-left { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .sp-foot-right { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
    @media (max-width: 460px) {
      .sp-chk-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class SafetyPrivacyModalsComponent {
  readonly mode = input<'pii' | 'guardrails' | null>(null);
  readonly piiCategories = input<string[]>([]);
  readonly guardrails = input<GuardrailsConfig>({ input: [], output: [] });
  readonly scopeLabel = input('');

  readonly savePii = output<string[]>();
  readonly saveGuardrails = output<GuardrailsConfig>();
  readonly close = output<void>();

  readonly piiGroups = PII_GROUPS;
  readonly inputGuardrails = INPUT_GUARDRAILS;
  readonly outputGuardrails = OUTPUT_GUARDRAILS;

  piiDraft = signal<string[]>([]);
  guardDraft = signal<GuardrailsConfig>({ input: [], output: [] });

  activeCount = computed(() =>
    this.mode() === 'pii'
      ? this.piiDraft().length
      : (this.guardDraft().input.length + this.guardDraft().output.length),
  );

  constructor() {
    effect(() => {
      const m = this.mode();
      if (m === 'pii') {
        this.piiDraft.set([...new Set(this.piiCategories() || [])]);
      } else if (m === 'guardrails') {
        const g = this.guardrails();
        this.guardDraft.set({
          input: [...new Set(g?.input || [])],
          output: [...new Set(g?.output || [])],
        });
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.mode()) this.close.emit();
  }

  hasPii(key: string): boolean {
    return this.piiDraft().includes(key);
  }

  togglePii(key: string, on: boolean): void {
    this.piiDraft.update((list) =>
      on ? [...new Set([...list, key])] : list.filter((k) => k !== key),
    );
  }

  hasGuard(bucket: 'input' | 'output', key: string): boolean {
    return this.guardDraft()[bucket].includes(key);
  }

  toggleGuard(bucket: 'input' | 'output', key: string, on: boolean): void {
    this.guardDraft.update((g) => ({
      ...g,
      [bucket]: on ? [...new Set([...g[bucket], key])] : g[bucket].filter((k) => k !== key),
    }));
  }

  selectAll(): void {
    if (this.mode() === 'pii') {
      this.piiDraft.set([...ALL_PII_KEYS]);
    } else {
      this.guardDraft.set({
        input: INPUT_GUARDRAILS.map((i) => i.key),
        output: OUTPUT_GUARDRAILS.map((i) => i.key),
      });
    }
  }

  clearAll(): void {
    if (this.mode() === 'pii') {
      this.piiDraft.set([]);
    } else {
      this.guardDraft.set({ input: [], output: [] });
    }
  }

  submit(): void {
    if (this.mode() === 'pii') {
      this.savePii.emit([...this.piiDraft()]);
    } else if (this.mode() === 'guardrails') {
      const g = this.guardDraft();
      this.saveGuardrails.emit({ input: [...g.input], output: [...g.output] });
    }
  }
}
