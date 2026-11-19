import { ChangeDetectionStrategy, Component, HostListener, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../components/icon/icon.component';

const INPUT_TYPES = [
  { key: 'string', label: 'Text', glyph: 'T' },
  { key: 'number', label: 'Number', glyph: '#' },
  { key: 'phone', label: 'Phone', glyph: '☎' },
  { key: 'boolean', label: 'Yes/No', glyph: '◐' },
  { key: 'date', label: 'Date', glyph: 'D' },
];

const OUTPUT_TYPES = [
  { key: 'string', label: 'Text', glyph: 'T' },
  { key: 'enum', label: 'Selector', glyph: '⋮≡' },
  { key: 'boolean', label: 'Yes/No', glyph: '◐' },
  { key: 'number', label: 'Number', glyph: '#' },
  { key: 'date', label: 'Date', glyph: 'D' },
  { key: 'list', label: 'List', glyph: '≡' },
];

const SUB_TYPES = ['string', 'number', 'date', 'boolean', 'enum'];

@Component({
  selector: 'app-field-edit-modal',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (draft(); as d) {
      <div class="modal-backdrop" (click)="close.emit()">
        <div class="modal agent-modal fe-modal" role="dialog" aria-modal="true" [attr.aria-label]="modalTitle()" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <div class="fe-head-left">
              <span class="fe-head-glyph" aria-hidden="true">{{ typeInfo().glyph }}</span>
              <div class="modal-title">{{ modalTitle() }}</div>
              @if (!d.locked) {
                <select class="select fe-type-sel" [ngModel]="d.type || 'string'" (ngModelChange)="changeType($event)" aria-label="Field type">
                  @for (t of typeChoices(); track t.key) {
                    <option [value]="t.key">{{ t.label }}</option>
                  }
                </select>
              }
            </div>
            <button type="button" class="btn-icon" aria-label="Close" (click)="close.emit()"><app-icon name="close" [size]="16"></app-icon></button>
          </div>

          <div class="modal-body fe-body">
            @if (kind() === 'output') {
              <label class="field">
                <span class="field-label">Name @if (d.key && (d.label || d.key) !== d.key) { <small class="mono fe-key-hint">{{ d.key }}</small> }</span>
                <input class="input" [ngModel]="d.label || d.key || ''" (ngModelChange)="setOutputName($event)" [disabled]="!!d.locked" placeholder="e.g. Call Successful" aria-label="Field name" />
              </label>

              <label class="field">
                <span class="field-label">Description</span>
                <textarea class="input fe-desc" rows="4" [ngModel]="d.description || ''" (ngModelChange)="patch({ description: $event })" [disabled]="!!d.locked" placeholder="Describe what the agent should extract or evaluate after the call..." aria-label="Description"></textarea>
              </label>

              @if (d.type === 'enum') {
                <div class="field">
                  <span class="field-label">Choices</span>
                  <div class="fe-choices">
                    @for (opt of d.options || []; track $index; let i = $index) {
                      <div class="fe-choice-row">
                        <input class="input" [ngModel]="opt" (ngModelChange)="setChoice(i, $event)" [disabled]="!!d.locked" [attr.aria-label]="'Choice ' + (i + 1)" placeholder="Choice option" />
                        @if (!d.locked) {
                          <button type="button" class="btn-icon" (click)="removeChoice(i)" aria-label="Remove choice"><app-icon name="trash" [size]="14"></app-icon></button>
                        }
                      </div>
                    }
                  </div>
                  @if (!d.locked) {
                    <button type="button" class="btn btn-sm fe-add-btn" (click)="addChoice()"><app-icon name="plus" [size]="13"></app-icon> Add choice</button>
                  }
                </div>
              }

              @if (d.type === 'list') {
                <div class="field">
                  <div class="fe-sub-head">
                    <span class="field-label">Sub-fields ({{ (d.fields || []).length }})</span>
                    <button type="button" class="btn btn-sm" (click)="addSubField()"><app-icon name="plus" [size]="12"></app-icon> Add sub-field</button>
                  </div>
                  <div class="fe-sub-list">
                    @for (sf of d.fields || []; track $index; let j = $index) {
                      <div class="fe-sub-card">
                        <div class="fe-sub-row">
                          <input class="input mono" [ngModel]="sf.key" (ngModelChange)="patchSubField(j, { key: $event })" placeholder="field_key" aria-label="Sub-field key" />
                          <select class="select" [ngModel]="sf.type || 'string'" (ngModelChange)="patchSubField(j, { type: $event })" aria-label="Sub-field type">
                            @for (st of SUB_TYPES; track st) { <option [value]="st">{{ st }}</option> }
                          </select>
                          <button type="button" class="btn-icon" (click)="removeSubField(j)" aria-label="Remove sub-field"><app-icon name="trash" [size]="13"></app-icon></button>
                        </div>
                        @if (sf.type === 'enum') {
                          <input class="input mono" [value]="(sf.options || []).join(', ')" (input)="setSubOptions(j, $any($event.target).value)" placeholder="allowed values: a, b, c" aria-label="Sub-field allowed values" />
                        }
                      </div>
                    }
                  </div>
                </div>
              }

              <div class="fe-toggles">
                <label class="fe-toggle-row">
                  <span class="switch"><input type="checkbox" [checked]="d.required === false" [disabled]="!!d.locked" (change)="patch({ required: !$any($event.target).checked })" aria-label="Allow empty value" /><i></i></span>
                  <span>
                    <b>Allow empty value</b>
                    <small>The field can be left empty when no applicable value is found.</small>
                  </span>
                </label>

                <label class="fe-toggle-row">
                  <span class="switch"><input type="checkbox" [checked]="!!d.save_to_contact" [disabled]="!!d.locked" (change)="patch({ save_to_contact: $any($event.target).checked })" aria-label="Save to contact field" /><i></i></span>
                  <span>
                    <b>Save to contact field</b>
                    <small>Persist this extracted value onto the contact record across future campaigns.</small>
                  </span>
                </label>
              </div>
            } @else {
              <label class="field">
                <span class="field-label">Variable key</span>
                <input class="input mono" [ngModel]="d.key || ''" (ngModelChange)="patch({ key: $event })" placeholder="e.g. po_number" aria-label="Variable key" />
              </label>

              <label class="field">
                <span class="field-label">Sample value</span>
                <input class="input" [ngModel]="d.sample || ''" (ngModelChange)="patch({ sample: $event })" placeholder="Example value shown in previews" aria-label="Sample value" />
              </label>

              <div class="fe-toggles">
                <label class="fe-toggle-row">
                  <span class="switch"><input type="checkbox" [checked]="d.share_on_call !== false" (change)="patch({ share_on_call: $any($event.target).checked })" aria-label="Say on call" /><i></i></span>
                  <span>
                    <b>Say on call</b>
                    <small>Include this variable in the spoken prompt context given to the agent.</small>
                  </span>
                </label>

                <label class="fe-toggle-row">
                  <span class="switch"><input type="checkbox" [checked]="d.transform === 'phonetic'" (change)="patch({ transform: $any($event.target).checked ? 'phonetic' : '' })" aria-label="Phonetic transform" /><i></i></span>
                  <span>
                    <b>Phonetic pronunciation</b>
                    <small>Spell/format alphanumeric codes and Indian identifiers clearly for TTS.</small>
                  </span>
                </label>

                <label class="fe-toggle-row">
                  <span class="switch"><input type="checkbox" [checked]="!!d.allow_empty" (change)="patch({ allow_empty: $any($event.target).checked })" aria-label="Allow empty on dial" /><i></i></span>
                  <span>
                    <b>Allow empty on sheet upload</b>
                    <small>Do not skip the row if this column is blank when uploading a campaign sheet.</small>
                  </span>
                </label>
              </div>
            }
          </div>

          <div class="modal-foot">
            @if (canDelete() && !d.locked && d.key !== 'agent_goal') {
              <button type="button" class="btn btn-stop" (click)="remove.emit()">Delete</button>
            }
            <span style="flex:1"></span>
            <button type="button" class="btn" (click)="close.emit()">Cancel</button>
            <button type="button" class="btn btn-primary" (click)="submit()">Update</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .fe-modal { max-width: 520px; width: min(520px, 100%); }
    .fe-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
    .fe-head-glyph {
      display: inline-grid; place-items: center; min-width: 26px; height: 26px; padding: 0 5px;
      border-radius: 7px; border: 1px solid var(--ds-border); background: var(--ds-surface-sunken);
      font-family: var(--ds-mono); font-size: 12px; font-weight: 700; color: var(--ds-text);
    }
    .fe-type-sel { width: auto; min-height: 28px; padding: 2px 26px 2px 8px; font-size: 12px; }
    .fe-body { display: grid; gap: 14px; }
    .fe-key-hint { font-size: 11px; color: var(--ds-text-muted); font-weight: 500; margin-left: 6px; }
    .fe-desc { min-height: 92px; resize: vertical; line-height: 1.5; }
    .fe-choices { display: grid; gap: 8px; max-height: 230px; overflow-y: auto; padding-right: 2px; }
    .fe-choice-row { display: flex; align-items: center; gap: 6px; }
    .fe-choice-row .input { flex: 1 1 auto; }
    .fe-add-btn { justify-self: start; margin-top: 4px; }
    .fe-sub-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .fe-sub-list { display: grid; gap: 8px; }
    .fe-sub-card { display: grid; gap: 6px; padding: 8px 10px; border: 1px solid var(--ds-border); border-radius: 8px; background: var(--ds-surface-sunken); }
    .fe-sub-row { display: grid; grid-template-columns: minmax(0, 1fr) 110px 32px; gap: 6px; align-items: center; }
    .fe-toggles { display: grid; gap: 10px; padding-top: 4px; border-top: 1px solid var(--ds-border-subtle); }
    .fe-toggle-row { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
    .fe-toggle-row b { display: block; font-size: 13px; color: var(--ds-text); font-weight: 600; }
    .fe-toggle-row small { display: block; font-size: 12px; color: var(--ds-text-muted); line-height: 1.4; }
    @media (max-width: 560px) { .fe-sub-row { grid-template-columns: minmax(0, 1fr) 92px 32px; } }
  `],
})
export class FieldEditModalComponent {
  kind = input.required<'input' | 'output'>();
  field = input.required<any>();
  canDelete = input(true);

  save = output<any>();
  remove = output<void>();
  close = output<void>();

  readonly SUB_TYPES = SUB_TYPES;
  draft = signal<any>(null);
  private hadKeyOnOpen = true;

  typeChoices = computed(() => (this.kind() === 'output' ? OUTPUT_TYPES : INPUT_TYPES));
  typeInfo = computed(() => {
    const t = this.draft()?.type || 'string';
    return this.typeChoices().find((x) => x.key === t) || { key: t, label: 'Field', glyph: 'T' };
  });
  modalTitle = computed(() => (this.kind() === 'input' ? `Input · ${this.typeInfo().label}` : this.typeInfo().label));

  constructor() {
    effect(() => {
      const f = this.field();
      const copy = f ? structuredClone(f) : {};
      if (this.kind() === 'output' && copy.type === 'enum' && !Array.isArray(copy.options)) copy.options = [''];
      if (this.kind() === 'output' && copy.type === 'list' && !Array.isArray(copy.fields)) copy.fields = [{ key: '', type: 'string', options: [] }];
      this.hadKeyOnOpen = !!(copy.key && String(copy.key).trim());
      this.draft.set(copy);
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEsc(e: Event): void {
    e.stopImmediatePropagation?.();
    this.close.emit();
  }

  patch(part: Record<string, any>): void {
    this.draft.update((d) => (d ? { ...d, ...part } : d));
  }

  changeType(type: string): void {
    const next: any = { type };
    if (this.kind() === 'output' && type === 'enum' && !Array.isArray(this.draft()?.options)) next.options = [''];
    if (this.kind() === 'output' && type === 'list' && !Array.isArray(this.draft()?.fields)) next.fields = [{ key: '', type: 'string', options: [] }];
    this.patch(next);
  }

  setOutputName(name: string): void {
    const d = this.draft();
    if (!d) return;
    if (!this.hadKeyOnOpen) {
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      this.patch({ label: name, key: slug || name });
    } else {
      this.patch({ label: name });
    }
  }

  setChoice(i: number, val: string): void {
    const opts = [...(this.draft()?.options || [])];
    opts[i] = val;
    this.patch({ options: opts });
  }
  addChoice(): void {
    this.patch({ options: [...(this.draft()?.options || []), ''] });
  }
  removeChoice(i: number): void {
    this.patch({ options: (this.draft()?.options || []).filter((_: any, idx: number) => idx !== i) });
  }

  addSubField(): void {
    this.patch({ fields: [...(this.draft()?.fields || []), { key: '', type: 'string', options: [] }] });
  }
  patchSubField(i: number, part: Record<string, any>): void {
    const fields = (this.draft()?.fields || []).map((f: any, idx: number) => (idx === i ? { ...f, ...part } : f));
    this.patch({ fields });
  }
  removeSubField(i: number): void {
    this.patch({ fields: (this.draft()?.fields || []).filter((_: any, idx: number) => idx !== i) });
  }
  setSubOptions(i: number, raw: string): void {
    this.patchSubField(i, { options: raw.split(',').map((s) => s.trim()).filter(Boolean) });
  }

  submit(): void {
    const d = structuredClone(this.draft());
    if (!d) return;
    if (this.kind() === 'output' && d.type === 'enum') {
      d.options = (d.options || []).map((s: string) => String(s || '').trim()).filter(Boolean);
    }
    this.save.emit(d);
  }
}
