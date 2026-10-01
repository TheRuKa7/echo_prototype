import { Component, Input, signal } from '@angular/core';

/**
 * Info icon with a plain tooltip: self service help next to any label, so the
 * screen itself carries no explanatory subtitles. Shows on hover, focus or tap.
 * Placed on the page (fixed), so it is never cut off by a scrolling box.
 * For ideas that need a picture, use app-guide instead.
 */
@Component({
  selector: 'app-hint',
  standalone: true,
  template: `
    <span class="h-i" tabindex="0" role="img" [attr.aria-label]="text"
      (mouseenter)="show($event)" (mouseleave)="open.set(false)" (focus)="show($event)" (blur)="open.set(false)" (click)="show($event); $event.stopPropagation(); $event.preventDefault()">
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.6" r="0.7" class="d" /></svg>
    </span>
    @if (open()) { <span class="h-tip" role="tooltip" [style.top.px]="pos().top" [style.left.px]="pos().left">{{ text }}</span> }
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .h-i { display: inline-flex; margin-left: 4px; color: var(--faint); cursor: help; border-radius: 50%; }
    .h-i:hover, .h-i:focus-visible { color: var(--ink-2); outline: none; }
    .h-i svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
    .h-i .d { fill: currentColor; }
    .h-tip { position: fixed; z-index: 1300; max-width: 280px; padding: 8px 10px; border-radius: 8px; background: var(--ink, #1c1917); color: #fff; font-size: 12px; font-weight: 400; line-height: 1.45; text-transform: none; letter-spacing: 0; white-space: pre-line; box-shadow: 0 8px 24px rgba(0,0,0,.2); pointer-events: none; }
  `],
})
export class HintComponent {
  @Input() text = '';
  open = signal(false);
  pos = signal({ top: 0, left: 0 });
  show(e: Event): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 280;
    const below = r.bottom + 90 < window.innerHeight;
    this.pos.set({ top: below ? r.bottom + 6 : Math.max(8, r.top - 80), left: Math.max(8, Math.min(r.left - 12, window.innerWidth - W - 8)) });
    this.open.set(true);
  }
}
