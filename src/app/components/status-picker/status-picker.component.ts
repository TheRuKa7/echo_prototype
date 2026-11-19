import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { HintComponent } from '../hint/hint.component';
import { callStatuses, GROUPS, OutcomeView } from '../../utils/status';

/**
 * Pick which final call statuses get another dial. One clean list, grouped the
 * way calls are counted (Reached, Not reached, Failed). Each row is a status and
 * a plain "Try again" or "Final" switch; the detail (what it means, how it is
 * decided, what happens next) is in the row's info popover on hover, focus or tap.
 * Used by Settings, Calling defaults and by each agent's Advanced settings.
 */
@Component({
  selector: 'app-status-picker',
  standalone: true,
  imports: [HintComponent],
  template: `
    <div class="sp-top">
      <span class="sp-sum"><b>{{ selected.length }}</b>/{{ all().length }} retry on</span>
      <span class="sp-presets" role="group" aria-label="Quick choices">
        <button type="button" class="btn btn-sm btn-ghost" (click)="set(recommended())">Recommended</button>
        <button type="button" class="btn btn-sm btn-ghost" (click)="set(notReachedOnly())">Not reached</button>
        <button type="button" class="btn btn-sm btn-ghost" (click)="set([])">None</button>
      </span>
    </div>
    @for (g of groups(); track g.key) {
      <section class="sp-group" [attr.aria-label]="g.label">
        <div class="sp-gh"><i [class]="'sp-dot g-' + g.key" aria-hidden="true"></i>{{ g.label }}</div>
        <div class="sp-pills" role="group" [attr.aria-label]="g.label">
          @for (s of g.items; track s.key) {
            <span class="sp-pill-wrap">
              <button
                type="button"
                class="sp-btn"
                [class.on]="selected.includes(s.key)"
                [class.off]="!selected.includes(s.key)"
                [attr.aria-pressed]="selected.includes(s.key)"
                [title]="s.help"
                (click)="toggle(s.key, !selected.includes(s.key))"
              >
                <span class="sp-ind" aria-hidden="true">{{ selected.includes(s.key) ? '✓' : '✕' }}</span>
                <span>{{ s.label }}</span>
              </button>
              <app-hint [label]="'About ' + s.label" [heading]="s.label" [sections]="details(s)"></app-hint>
            </span>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: grid; gap: 8px; }
    .sp-top { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
    .sp-sum { font-size: 12px; color: var(--ds-text-2); margin-right: auto; }
    .sp-sum b { color: var(--ds-text); }
    .sp-presets { display: flex; flex-wrap: wrap; gap: 4px; }
    .sp-group { border: 1px solid var(--ds-border); border-radius: var(--ds-r-md); background: var(--ds-surface); padding: 8px 10px; display: grid; gap: 6px; }
    .sp-gh { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ds-text-muted); }
    .sp-dot { width: 7px; height: 7px; border-radius: 2px; display: inline-block; }
    .g-reached { background: var(--ds-success); } .g-not_reached { background: var(--ds-danger); } .g-failed { background: var(--ds-warning); }
    .sp-pills { display: flex; flex-wrap: wrap; gap: 6px; }
    .sp-pill-wrap { display: inline-flex; align-items: center; gap: 2px; }
    .sp-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all 0.14s ease; line-height: 1.3;
    }
    .sp-btn.on {
      border: 1px solid var(--ds-success, #16a34a);
      background: var(--ds-success-bg, #f0fdf4);
      color: var(--ds-success-fg, #146c34);
    }
    .sp-btn.off {
      border: 1px solid var(--ds-border-strong, #d6d3cf);
      background: var(--ds-surface-sunken, #f0eee9);
      color: var(--ds-text-muted, #5c5752);
    }
    .sp-btn:hover { border-color: var(--ds-text-muted); }
    .sp-ind { font-size: 10px; font-weight: 800; }
  `],
})
export class StatusPickerComponent {
  @Input() selected: string[] = [];
  @Input() tries = 3;
  @Input() gapMinutes = 60;
  @Output() selectedChange = new EventEmitter<string[]>();

  all = signal<OutcomeView[]>(callStatuses().filter((s) => ['reached', 'not_reached', 'failed'].includes(s.group)));
  groups = computed(() => GROUPS.filter((g) => ['reached', 'not_reached', 'failed'].includes(g.key))
    .map((g) => ({ ...g, items: this.all().filter((s) => s.group === g.key) })));
  recommended = computed(() => this.all().filter((s) => s.retry).map((s) => s.key));
  notReachedOnly = computed(() => this.all().filter((s) => s.retry && s.group !== 'reached').map((s) => s.key));

  /** Status, what it means, how it is decided, what happens next. */
  details(s: OutcomeView): { k: string; v: string }[] {
    const on = this.selected.includes(s.key);
    return [
      { k: 'What it means', v: s.help },
      { k: 'How it is decided', v: s.ozonetel },
      { k: 'What happens next', v: on ? `Dialled again after ${this.gapMinutes} min, up to ${this.tries} tries in all; then this status is final.` : 'Final: no more dials; the row goes to results with this status.' },
    ];
  }
  toggle(k: string, on: boolean): void { this.set(on ? [...new Set([...this.selected, k])] : this.selected.filter((x) => x !== k)); }
  set(keys: string[]): void { this.selected = keys; this.selectedChange.emit(keys); }
}
