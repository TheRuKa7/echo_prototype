import { Component, Input, Output, EventEmitter, HostListener, signal } from '@angular/core';
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-prompt-preview',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Full prompt" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <div>
            <div class="modal-title">Full prompt — {{ agentLabel }}</div>
            <div class="modal-sub">
              {{ preview.draft ? 'Draft' : 'Saved' }} · {{ preview.prompt.length.toLocaleString() }} chars (raw tokens)
            </div>
          </div>
          <button type="button" class="btn-icon" (click)="close.emit()" title="Close (Esc)" aria-label="Close">
            <app-icon name="close" [size]="15"></app-icon>
          </button>
        </div>
        <pre class="modal-body flush prompt-preview mono">{{ preview.prompt }}</pre>
        <div class="modal-foot">
          <button type="button" class="btn btn-sm" (click)="copy()">{{ copied() ? 'Copied' : 'Copy' }}</button>
          <button type="button" class="btn btn-primary btn-sm" (click)="close.emit()">Close</button>
        </div>
      </div>
    </div>
  `,
})
export class PromptPreviewComponent {
  @Input() preview: any;
  @Input() agentLabel = '';
  @Output() close = new EventEmitter<void>();
  copied = signal(false);

  @HostListener('window:keydown.Escape')
  onEsc(): void { this.close.emit(); }

  copy(): void {
    navigator.clipboard?.writeText(this.preview.prompt);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1800);
  }
}
