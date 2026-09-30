import { Component, Input, computed, signal } from '@angular/core';

/**
 * One row per item of a list answer, across every call of the campaign (ECHO-202).
 * For the PI pilot that is one row per purchase order line: status, firm lots,
 * ready stock, logistics and quality fields. Filter chips count lines by status.
 */
const WATCH = new Set(['quality_hold', 'batch_rejected', 'quality_issue_no_date', 'qty_disputed', 'no_capacity', 'artwork_hold']);

@Component({
  selector: 'app-lines-table',
  standalone: true,
  template: `
    @if (!rows().length) {
      <div class="empty"><div class="empty-title">No lines yet</div><div class="empty-sub">Lines appear here as each supplier call finishes.</div></div>
    } @else {
      <div class="stat-strip" style="padding: 10px 14px 0" aria-label="Filter lines by status">
        <button type="button" [class]="'stat-pill' + (!filter() ? ' on' : '')" (click)="filter.set('')"><b>{{ rows().length }}</b> All lines</button>
        @for (b of byStatus(); track b.key) {
          <button type="button" [class]="'stat-pill' + (filter() === b.key ? ' on' : '')" (click)="filter.set(filter() === b.key ? '' : b.key)"><b>{{ b.count }}</b> {{ label(b.key) }}</button>
        }
      </div>
      <div class="scroll-x">
        <table class="table lt">
          <thead><tr><th>Supplier</th>@for (c of cols(); track c) { <th>{{ head(c) }}</th> }</tr></thead>
          <tbody>
            @for (r of shown(); track $index) {
              <tr [class.lt-watch]="watch(r.line_status)">
                <td><div>{{ r.name }}</div><div class="row-sub mono">{{ r.primary_id }}</div></td>
                @for (c of cols(); track c) {
                  <td [class.mono]="!['item', 'supplier_says', 'delay_reason', 'defect_location', 'tentative_window'].includes(c)">
                    @if (c === 'line_status') { <span [class]="'tag ' + tone(r[c])">{{ label(r[c]) }}</span> } @else { {{ show(r[c]) }} }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    .lt td { font-size: 12.5px; vertical-align: top; white-space: nowrap; }
    .lt td:first-child, .lt td:nth-child(3) { white-space: normal; min-width: 140px; }
    .lt th { white-space: nowrap; }
    .lt-watch td:first-child { box-shadow: inset 3px 0 0 var(--red); }
  `],
})
export class LinesTableComponent {
  @Input() set data(d: any) { this.rows.set(d?.rows || []); this.fields.set(d?.fields || []); }
  @Input() listVar: any = null;
  rows = signal<any[]>([]);
  fields = signal<string[]>([]);
  filter = signal('');

  /** Only columns that hold a value somewhere, so the table stays readable. */
  cols = computed(() => {
    const order = ['po_number', 'item', 'pending_qty', 'line_status', ...this.fields()];
    return [...new Set(order)].filter((k) => this.rows().some((r) => r[k] !== '' && r[k] !== null && r[k] !== undefined && r[k] !== 0));
  });
  byStatus = computed(() => {
    const m = new Map<string, number>();
    for (const r of this.rows()) m.set(r.line_status || 'unknown', (m.get(r.line_status || 'unknown') || 0) + 1);
    return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  });
  shown = computed(() => {
    const f = this.filter();
    const list = f ? this.rows().filter((r) => r.line_status === f) : this.rows();
    // Lines that need a buyer first
    return [...list].sort((a, b) => Number(this.watch(b.line_status)) - Number(this.watch(a.line_status)));
  });

  watch(s: string): boolean { return WATCH.has(s); }
  tone(s: string): string {
    if (['scheduled', 'dispatched'].includes(s)) return 'ok';
    if (this.watch(s)) return 'bad';
    if (s === 'not_discussed') return 'muted';
    return 'warn';
  }
  label(s: string): string { return String(s || '—').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
  head(c: string): string { return ({ po_number: 'PO line', pending_qty: 'Pending', line_status: 'Status', lr_or_invoice: 'LR or invoice', date_change_count: 'Date changes' } as any)[c] || this.label(c); }
  show(v: any): string { return v === null || v === undefined || v === '' ? '—' : String(v); }
}
