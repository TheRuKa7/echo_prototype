import { Component, HostListener, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../components/icon/icon.component';
import {
  CAMPAIGN_AGGS, CONDITION_OPERATORS, CallGoalRule, CallRollupMode,
  CampaignGoalKind, CampaignGoalRule, ConditionGroup, GoalCondition, GoalConfig,
  GoalFieldOption, NUM_COMPARE_OPS, blankCallGoal, blankCampaignGoal,
  blankCondition, buildGoalFieldOptions, defaultGoalConfigFromOutputs,
  evaluateCallGoals, evaluateCampaignGoals,
} from './goal-models';

interface DrySampleRow {
  caller_name: string;
  committed_qty: number;
  accepted_po_count: number;
  call_result: string;
  po_acceptance_intent: string;
}

/**
 * Dedicated modal editor for Deterministic Goals (Call-level + Campaign-level).
 * Supports conditional activation, multi-condition ALL/ANY rules, strict
 * Positive/Negative -> Partial fallback logic, cumulative campaign goals, and live simulation.
 */
@Component({
  selector: 'app-goals-modal',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    @if (open()) {
      <div class="modal-backdrop" (click)="close.emit()">
        <div
          class="modal agent-modal gm-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Deterministic goals configuration"
          (click)="$event.stopPropagation()"
        >
          <div class="modal-head">
            <div class="gm-head-copy">
              <div class="modal-title gm-title">
                <app-icon name="target" [size]="16"></app-icon>
                <span>Deterministic goals</span>
                @if (agentLabel()) {
                  <span class="tag">{{ agentLabel() }}</span>
                }
              </div>
              <div class="modal-sub">
                Evaluate calls and cumulative campaign progress strictly from extracted output variables.
              </div>
            </div>
            <button type="button" class="btn-icon" aria-label="Close" (click)="close.emit()">
              <app-icon name="close" [size]="16"></app-icon>
            </button>
          </div>

          <div class="gm-tabs-bar">
            <div class="seg" role="tablist" aria-label="Goal scope">
              <button
                type="button"
                role="tab"
                [class.on]="tab() === 'call'"
                [attr.aria-selected]="tab() === 'call'"
                (click)="tab.set('call')"
              >
                Call-level goals ({{ draft().call_goals.length }})
              </button>
              <button
                type="button"
                role="tab"
                [class.on]="tab() === 'campaign'"
                [attr.aria-selected]="tab() === 'campaign'"
                (click)="tab.set('campaign')"
              >
                Campaign-level goals ({{ draft().campaign_goals.length }})
              </button>
            </div>
          </div>

          <div class="modal-body gm-body">
            @if (tab() === 'call') {
              <div class="gm-top-strip">
                <label class="gm-inline-field">
                  <span class="field-label">Call rollup</span>
                  <select
                    class="select gm-sm-select"
                    [ngModel]="draft().call_rollup"
                    (ngModelChange)="setRollup($event)"
                    aria-label="Call rollup mode"
                  >
                    <option value="all_positive">All active positive (else Partial)</option>
                    <option value="any_positive">Any active positive (with no negative)</option>
                    <option value="majority">Majority positive</option>
                  </select>
                </label>
                <span class="gm-truth-note">
                  Positive &amp; not Negative = <b>Positive</b> · Negative &amp; not Positive = <b>Negative</b> · Neither/both = <b>Partial</b>
                </span>
                <button type="button" class="btn btn-sm btn-primary gm-ml-auto" (click)="addCallGoal()">
                  <app-icon name="plus" [size]="13"></app-icon> Add call goal
                </button>
              </div>

              <div class="gm-cards">
                @for (g of draft().call_goals; track g.id; let gi = $index) {
                  <section class="gm-card" [class.off]="!g.enabled">
                    <header class="gm-card-head">
                      <label class="switch" title="Enable or pause this call goal">
                        <input
                          type="checkbox"
                          [checked]="g.enabled"
                          (change)="patchCallGoal(gi, { enabled: $any($event.target).checked })"
                          [attr.aria-label]="'Enable goal ' + g.name"
                        />
                        <i></i>
                      </label>
                      <input
                        class="input gm-name-input"
                        [ngModel]="g.name"
                        (ngModelChange)="patchCallGoal(gi, { name: $event })"
                        placeholder="Call goal name"
                        [attr.aria-label]="'Call goal name ' + (gi + 1)"
                      />
                      <button
                        type="button"
                        class="btn btn-sm"
                        [class.on-chip]="g.conditional"
                        [attr.aria-pressed]="g.conditional"
                        (click)="toggleCallConditional(gi)"
                        title="Only evaluate this goal when an activation condition holds"
                      >
                        {{ g.conditional ? 'Conditional: On' : '+ Condition (When)' }}
                      </button>
                      <span class="gm-ops">
                        <button type="button" class="btn-icon" aria-label="Move up" [disabled]="gi === 0" (click)="moveCallGoal(gi, -1)">↑</button>
                        <button type="button" class="btn-icon" aria-label="Move down" [disabled]="gi === draft().call_goals.length - 1" (click)="moveCallGoal(gi, 1)">↓</button>
                        <button type="button" class="btn-icon" aria-label="Delete call goal" (click)="removeCallGoal(gi)">
                          <app-icon name="trash" [size]="13"></app-icon>
                        </button>
                      </span>
                    </header>

                    @if (g.conditional) {
                      <div class="gm-bucket gm-bucket-when">
                        <div class="gm-bucket-head">
                          <span class="tag info">ACTIVATE WHEN</span>
                          <select
                            class="select gm-logic-sel"
                            [ngModel]="g.when.logic"
                            (ngModelChange)="setCallGroupLogic(gi, 'when', $event)"
                            aria-label="Activation match logic"
                          >
                            <option value="all">Match ALL (AND)</option>
                            <option value="any">Match ANY (OR)</option>
                          </select>
                          <button type="button" class="btn btn-sm btn-ghost gm-ml-auto" (click)="addCallCond(gi, 'when')">
                            + Condition
                          </button>
                        </div>
                        @for (c of g.when.conditions; track $index; let ci = $index) {
                          <div class="gm-cond-row">
                            <select
                              class="select gm-fld-sel"
                              [ngModel]="c.field"
                              (ngModelChange)="patchCallCond(gi, 'when', ci, { field: $event })"
                              aria-label="Activation field"
                            >
                              @for (grp of fieldGroups(); track grp.group) {
                                <optgroup [label]="grp.group">
                                  @for (f of grp.items; track f.value) {
                                    <option [value]="f.value">{{ f.label }}</option>
                                  }
                                </optgroup>
                              }
                            </select>
                            <select
                              class="select gm-op-sel"
                              [ngModel]="c.op"
                              (ngModelChange)="patchCallCond(gi, 'when', ci, { op: $event })"
                              aria-label="Activation operator"
                            >
                              @for (op of operators; track op.value) {
                                <option [value]="op.value">{{ op.label }}</option>
                              }
                            </select>
                            @if (opNeedsVal(c.op)) {
                              <input
                                class="input gm-val-inp"
                                [ngModel]="c.value"
                                (ngModelChange)="patchCallCond(gi, 'when', ci, { value: $event })"
                                [attr.list]="'gm-opts-' + sanitizeId(c.field)"
                                placeholder="Value (comma for multiple)"
                                aria-label="Activation value"
                              />
                            } @else {
                              <span class="gm-no-val">—</span>
                            }
                            <button type="button" class="btn-icon" aria-label="Remove condition" (click)="removeCallCond(gi, 'when', ci)">
                              <app-icon name="close" [size]="12"></app-icon>
                            </button>
                          </div>
                        }
                      </div>
                    }

                    <div class="gm-two-buckets">
                      <div class="gm-bucket gm-bucket-pos">
                        <div class="gm-bucket-head">
                          <span class="tag ok">POSITIVE WHEN</span>
                          <select
                            class="select gm-logic-sel"
                            [ngModel]="g.positive.logic"
                            (ngModelChange)="setCallGroupLogic(gi, 'positive', $event)"
                            aria-label="Positive outcome match logic"
                          >
                            <option value="all">Match ALL (AND)</option>
                            <option value="any">Match ANY (OR)</option>
                          </select>
                          <button type="button" class="btn btn-sm btn-ghost gm-ml-auto" (click)="addCallCond(gi, 'positive')">
                            + Condition
                          </button>
                        </div>
                        @for (c of g.positive.conditions; track $index; let ci = $index) {
                          <div class="gm-cond-row">
                            <select
                              class="select gm-fld-sel"
                              [ngModel]="c.field"
                              (ngModelChange)="patchCallCond(gi, 'positive', ci, { field: $event })"
                              aria-label="Positive condition field"
                            >
                              @for (grp of fieldGroups(); track grp.group) {
                                <optgroup [label]="grp.group">
                                  @for (f of grp.items; track f.value) {
                                    <option [value]="f.value">{{ f.label }}</option>
                                  }
                                </optgroup>
                              }
                            </select>
                            <select
                              class="select gm-op-sel"
                              [ngModel]="c.op"
                              (ngModelChange)="patchCallCond(gi, 'positive', ci, { op: $event })"
                              aria-label="Positive condition operator"
                            >
                              @for (op of operators; track op.value) {
                                <option [value]="op.value">{{ op.label }}</option>
                              }
                            </select>
                            @if (opNeedsVal(c.op)) {
                              <input
                                class="input gm-val-inp"
                                [ngModel]="c.value"
                                (ngModelChange)="patchCallCond(gi, 'positive', ci, { value: $event })"
                                [attr.list]="'gm-opts-' + sanitizeId(c.field)"
                                placeholder="Value (e.g. completed)"
                                aria-label="Positive condition value"
                              />
                            } @else {
                              <span class="gm-no-val">—</span>
                            }
                            <button type="button" class="btn-icon" aria-label="Remove positive condition" (click)="removeCallCond(gi, 'positive', ci)">
                              <app-icon name="close" [size]="12"></app-icon>
                            </button>
                          </div>
                        } @empty {
                          <div class="gm-empty-cond">Add at least one condition for Positive outcome.</div>
                        }
                      </div>

                      <div class="gm-bucket gm-bucket-neg">
                        <div class="gm-bucket-head">
                          <span class="tag bad">NEGATIVE WHEN</span>
                          <select
                            class="select gm-logic-sel"
                            [ngModel]="g.negative.logic"
                            (ngModelChange)="setCallGroupLogic(gi, 'negative', $event)"
                            aria-label="Negative outcome match logic"
                          >
                            <option value="any">Match ANY (OR)</option>
                            <option value="all">Match ALL (AND)</option>
                          </select>
                          <button type="button" class="btn btn-sm btn-ghost gm-ml-auto" (click)="addCallCond(gi, 'negative')">
                            + Condition
                          </button>
                        </div>
                        @for (c of g.negative.conditions; track $index; let ci = $index) {
                          <div class="gm-cond-row">
                            <select
                              class="select gm-fld-sel"
                              [ngModel]="c.field"
                              (ngModelChange)="patchCallCond(gi, 'negative', ci, { field: $event })"
                              aria-label="Negative condition field"
                            >
                              @for (grp of fieldGroups(); track grp.group) {
                                <optgroup [label]="grp.group">
                                  @for (f of grp.items; track f.value) {
                                    <option [value]="f.value">{{ f.label }}</option>
                                  }
                                </optgroup>
                              }
                            </select>
                            <select
                              class="select gm-op-sel"
                              [ngModel]="c.op"
                              (ngModelChange)="patchCallCond(gi, 'negative', ci, { op: $event })"
                              aria-label="Negative condition operator"
                            >
                              @for (op of operators; track op.value) {
                                <option [value]="op.value">{{ op.label }}</option>
                              }
                            </select>
                            @if (opNeedsVal(c.op)) {
                              <input
                                class="input gm-val-inp"
                                [ngModel]="c.value"
                                (ngModelChange)="patchCallCond(gi, 'negative', ci, { value: $event })"
                                [attr.list]="'gm-opts-' + sanitizeId(c.field)"
                                placeholder="Value (e.g. refused)"
                                aria-label="Negative condition value"
                              />
                            } @else {
                              <span class="gm-no-val">—</span>
                            }
                            <button type="button" class="btn-icon" aria-label="Remove negative condition" (click)="removeCallCond(gi, 'negative', ci)">
                              <app-icon name="close" [size]="12"></app-icon>
                            </button>
                          </div>
                        } @empty {
                          <div class="gm-empty-cond">Optional negative condition (else falls back to Partial).</div>
                        }
                      </div>
                    </div>

                    <div class="gm-fallback-bar">
                      <span class="tag warn">Otherwise → Partial</span>
                      <small>If neither Positive nor Negative matches (or both match), this goal resolves to Partial.</small>
                    </div>
                  </section>
                } @empty {
                  <div class="empty-sub">No call-level goals configured. Click "+ Add call goal" above.</div>
                }
              </div>

              <!-- Datalists for enum output options -->
              @for (f of fieldOptions(); track f.value) {
                @if (f.options?.length) {
                  <datalist [id]="'gm-opts-' + sanitizeId(f.value)">
                    @for (opt of f.options; track opt) {
                      <option [value]="opt"></option>
                    }
                  </datalist>
                }
              }

              <!-- Live Call Simulator -->
              <section class="gm-sim-card">
                <div class="gm-sim-head">
                  <b>Simulate call goal evaluation</b>
                  <div class="gm-sim-presets">
                    <button type="button" class="btn btn-sm" (click)="loadSimPreset('positive')">Sample Positive</button>
                    <button type="button" class="btn btn-sm" (click)="loadSimPreset('partial')">Sample Partial</button>
                    <button type="button" class="btn btn-sm" (click)="loadSimPreset('negative')">Sample Negative</button>
                  </div>
                  <span class="tag gm-ml-auto" [class.ok]="simCallResult().overall === 'positive'" [class.bad]="simCallResult().overall === 'negative'" [class.warn]="simCallResult().overall === 'partial'">
                    Rollup: {{ simCallResult().overall ? simCallResult().overall!.toUpperCase() : 'NONE' }}
                  </span>
                </div>
                <div class="gm-sim-inputs">
                  @for (sf of simEditableFields(); track sf.key) {
                    <label class="field">
                      <span class="field-label mono">{{ sf.key }}</span>
                      @if (sf.options?.length) {
                        <select class="select" [ngModel]="simValue(sf.key)" (ngModelChange)="setSimValue(sf.key, $event)">
                          <option value="">(empty)</option>
                          @for (opt of sf.options; track opt) {
                            <option [value]="opt">{{ opt }}</option>
                          }
                        </select>
                      } @else if (sf.type === 'boolean') {
                        <select class="select" [ngModel]="simValue(sf.key)" (ngModelChange)="setSimValue(sf.key, $event)">
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      } @else {
                        <input
                          class="input mono"
                          [type]="sf.type === 'number' ? 'number' : 'text'"
                          [ngModel]="simValue(sf.key)"
                          (ngModelChange)="setSimValue(sf.key, $event)"
                        />
                      }
                    </label>
                  }
                </div>
                <div class="gm-sim-traces">
                  @for (item of simCallResult().goals; track item.id) {
                    <div class="gm-sim-row">
                      <span class="tag" [class.ok]="item.outcome === 'positive'" [class.bad]="item.outcome === 'negative'" [class.warn]="item.outcome === 'partial'">
                        {{ item.outcome }}
                      </span>
                      <b>{{ item.name }}</b>
                      <span class="gm-trace-list">
                        @if (item.reason) {
                          <span class="mono">{{ item.reason }}</span>
                        }
                        @for (t of item.traces; track $index) {
                          <span class="gm-trace-chip" [class.pass]="t.passed">{{ t.passed ? '✓' : '✕' }} {{ t.field }} ({{ t.actual }})</span>
                        }
                      </span>
                    </div>
                  }
                </div>
              </section>
            } @else {
              <!-- TAB 2: CAMPAIGN-LEVEL GOALS -->
              <div class="gm-top-strip">
                <span class="gm-truth-note">
                  Aggregated across answered calls in each campaign. Track demand targets (e.g. 100,000 units) or top suppliers (MAX/MIN).
                </span>
                <div class="gm-add-group gm-ml-auto">
                  <button type="button" class="btn btn-sm btn-primary" (click)="addCampaignGoal('target')">
                    <app-icon name="plus" [size]="13"></app-icon> Target goal
                  </button>
                  <button type="button" class="btn btn-sm" (click)="addCampaignGoal('extrema')">
                    <app-icon name="plus" [size]="13"></app-icon> Max/Min contributor
                  </button>
                </div>
              </div>

              <div class="gm-cards">
                @for (cg of draft().campaign_goals; track cg.id; let ci = $index) {
                  <section class="gm-card" [class.off]="!cg.enabled">
                    <header class="gm-card-head">
                      <label class="switch" title="Enable this campaign goal">
                        <input
                          type="checkbox"
                          [checked]="cg.enabled"
                          (change)="patchCampaignGoal(ci, { enabled: $any($event.target).checked })"
                          [attr.aria-label]="'Enable campaign goal ' + cg.name"
                        />
                        <i></i>
                      </label>
                      <input
                        class="input gm-name-input"
                        [ngModel]="cg.name"
                        (ngModelChange)="patchCampaignGoal(ci, { name: $event })"
                        placeholder="Campaign goal name"
                        [attr.aria-label]="'Campaign goal name ' + (ci + 1)"
                      />
                      <span class="tag">{{ cg.kind === 'extrema' ? 'Contributor MAX/MIN' : 'Cumulative target' }}</span>
                      <button
                        type="button"
                        class="btn btn-sm"
                        [class.on-chip]="cg.conditional"
                        [attr.aria-pressed]="cg.conditional"
                        (click)="toggleCampaignFilter(ci)"
                      >
                        {{ cg.conditional ? 'Call filter: On' : '+ Call filter' }}
                      </button>
                      <button type="button" class="btn-icon" aria-label="Delete campaign goal" (click)="removeCampaignGoal(ci)">
                        <app-icon name="trash" [size]="13"></app-icon>
                      </button>
                    </header>

                    <div class="gm-cmp-grid">
                      <label class="field">
                        <span class="field-label">Goal type</span>
                        <select class="select" [ngModel]="cg.kind" (ngModelChange)="patchCampaignGoal(ci, { kind: $event })">
                          <option value="target">Cumulative Target</option>
                          <option value="extrema">Max / Min Contributor</option>
                        </select>
                      </label>
                      <label class="field">
                        <span class="field-label">Aggregation</span>
                        <select class="select" [ngModel]="cg.aggregation" (ngModelChange)="patchCampaignGoal(ci, { aggregation: $event })">
                          @for (a of aggs; track a.value) {
                            <option [value]="a.value">{{ a.label }}</option>
                          }
                        </select>
                      </label>
                      <label class="field">
                        <span class="field-label">Metric field</span>
                        <select class="select" [ngModel]="cg.field" (ngModelChange)="patchCampaignGoal(ci, { field: $event })">
                          <option value="__call_goal_positive__">Positive Call Goals (calls)</option>
                          @for (f of campaignFieldOptions(); track f.value) {
                            <option [value]="f.value">{{ f.label }}</option>
                          }
                        </select>
                      </label>
                      <label class="field">
                        <span class="field-label">Unit label</span>
                        <input class="input" [ngModel]="cg.unit" (ngModelChange)="patchCampaignGoal(ci, { unit: $event })" placeholder="units / POs / %" />
                      </label>
                    </div>

                    @if (cg.conditional) {
                      <div class="gm-bucket gm-bucket-when">
                        <div class="gm-bucket-head">
                          <span class="tag info">ONLY INCLUDE CALLS WHERE</span>
                          <select
                            class="select gm-logic-sel"
                            [ngModel]="cg.filter.logic"
                            (ngModelChange)="setCampaignFilterLogic(ci, $event)"
                            aria-label="Campaign call filter logic"
                          >
                            <option value="all">Match ALL</option>
                            <option value="any">Match ANY</option>
                          </select>
                          <button type="button" class="btn btn-sm btn-ghost gm-ml-auto" (click)="addCampaignCond(ci)">+ Condition</button>
                        </div>
                        @for (fc of cg.filter.conditions; track $index; let fi = $index) {
                          <div class="gm-cond-row">
                            <select
                              class="select gm-fld-sel"
                              [ngModel]="fc.field"
                              (ngModelChange)="patchCampaignCond(ci, fi, { field: $event })"
                              aria-label="Filter field"
                            >
                              @for (grp of fieldGroups(); track grp.group) {
                                <optgroup [label]="grp.group">
                                  @for (f of grp.items; track f.value) {
                                    <option [value]="f.value">{{ f.label }}</option>
                                  }
                                </optgroup>
                              }
                            </select>
                            <select
                              class="select gm-op-sel"
                              [ngModel]="fc.op"
                              (ngModelChange)="patchCampaignCond(ci, fi, { op: $event })"
                              aria-label="Filter operator"
                            >
                              @for (op of operators; track op.value) {
                                <option [value]="op.value">{{ op.label }}</option>
                              }
                            </select>
                            @if (opNeedsVal(fc.op)) {
                              <input
                                class="input gm-val-inp"
                                [ngModel]="fc.value"
                                (ngModelChange)="patchCampaignCond(ci, fi, { value: $event })"
                                placeholder="Value"
                                aria-label="Filter value"
                              />
                            } @else {
                              <span class="gm-no-val">—</span>
                            }
                            <button type="button" class="btn-icon" aria-label="Remove filter condition" (click)="removeCampaignCond(ci, fi)">
                              <app-icon name="close" [size]="12"></app-icon>
                            </button>
                          </div>
                        }
                      </div>
                    }

                    <div class="gm-thresh-grid">
                      <label class="field">
                        <span class="field-label">Target value</span>
                        <input class="input mono" type="number" [ngModel]="cg.target" (ngModelChange)="patchCampaignGoal(ci, { target: +$event || 0 })" />
                      </label>
                      <div class="field">
                        <span class="field-label" style="color:var(--ds-success-fg)">Positive when</span>
                        <div class="gm-num-pair">
                          <select class="select" [ngModel]="cg.positive_op" (ngModelChange)="patchCampaignGoal(ci, { positive_op: $event })">
                            @for (op of numOps; track op.value) { <option [value]="op.value">{{ op.label }}</option> }
                          </select>
                          <input class="input mono" type="number" [ngModel]="cg.positive_value" (ngModelChange)="patchCampaignGoal(ci, { positive_value: +$event || 0 })" />
                        </div>
                      </div>
                      <div class="field">
                        <span class="field-label" style="color:var(--ds-danger-fg)">Negative when</span>
                        <div class="gm-num-pair">
                          <select class="select" [ngModel]="cg.negative_op" (ngModelChange)="patchCampaignGoal(ci, { negative_op: $event })">
                            @for (op of numOps; track op.value) { <option [value]="op.value">{{ op.label }}</option> }
                          </select>
                          <input class="input mono" type="number" [ngModel]="cg.negative_value" (ngModelChange)="patchCampaignGoal(ci, { negative_value: +$event || 0 })" />
                        </div>
                      </div>
                      <div class="field">
                        <span class="field-label">Group contributor by</span>
                        <input class="input mono" [ngModel]="cg.group_by" (ngModelChange)="patchCampaignGoal(ci, { group_by: $event })" placeholder="caller_name" />
                      </div>
                    </div>
                  </section>
                } @empty {
                  <div class="empty-sub">No campaign-level goals configured.</div>
                }
              </div>

              <!-- Live Campaign Dry-Run Simulator -->
              <section class="gm-sim-card">
                <div class="gm-sim-head">
                  <b>Campaign cumulative dry-run preview</b>
                  <span class="row-sub">Edit supplier quantities to preview cumulative Positive / Partial / Negative verdicts</span>
                </div>
                <div class="gm-sim-sup-grid">
                  @for (s of cmpSimRows(); track s.caller_name; let si = $index) {
                    <label class="field">
                      <span class="field-label">{{ s.caller_name }}</span>
                      <input
                        class="input mono"
                        type="number"
                        min="0"
                        [ngModel]="hasRowsSchema() ? s.committed_qty : s.accepted_po_count"
                        (ngModelChange)="setCmpSimQty(si, +$event || 0)"
                      />
                    </label>
                  }
                </div>
                <div class="gm-sim-traces">
                  @for (res of simCampaignResult(); track res.id) {
                    <div class="gm-sim-row">
                      <span class="tag" [class.ok]="res.outcome === 'positive'" [class.bad]="res.outcome === 'negative'" [class.warn]="res.outcome === 'partial'">
                        {{ res.outcome.toUpperCase() }}
                      </span>
                      <b>{{ res.name }}</b>
                      <span class="mono">
                        @if (res.kind === 'extrema' && res.leader) {
                          {{ res.leader.name }} ({{ res.leader.value.toLocaleString('en-US') }} {{ res.unit }})
                        } @else {
                          {{ res.current_value.toLocaleString('en-US') }}@if (res.target) { / {{ res.target.toLocaleString('en-US') }}} {{ res.unit }}
                        }
                      </span>
                    </div>
                  }
                </div>
              </section>
            }
          </div>

          <div class="modal-foot gm-foot">
            <button type="button" class="btn btn-sm" (click)="resetDefaults()">Reset defaults</button>
            <span class="gm-ml-auto row-sub">
              {{ enabledCallCount() }} call · {{ enabledCampaignCount() }} campaign active
            </span>
            <button type="button" class="btn" (click)="close.emit()">Cancel</button>
            <button type="button" class="btn btn-primary" (click)="save.emit(draft())">Save goals</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .gm-modal { width: min(880px, 100%); max-width: none; }
    .gm-head-copy { min-width: 0; }
    .gm-title { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .gm-tabs-bar { padding: 8px 18px 0; border-bottom: 1px solid var(--ds-border-subtle); display: flex; align-items: center; }
    .gm-body { display: grid; gap: 12px; align-content: start; min-width: 0; }
    .gm-top-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 10px; border: 1px solid var(--ds-border); border-radius: 10px; background: var(--ds-surface-sunken); }
    .gm-inline-field { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
    .gm-sm-select { min-height: 30px; padding: 3px 26px 3px 8px; font-size: 12px; width: auto; }
    .gm-truth-note { font-size: 11.5px; color: var(--ds-text-muted); }
    .gm-ml-auto { margin-left: auto; }
    .gm-add-group { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .gm-cards { display: grid; gap: 10px; }
    .gm-card { border: 1px solid var(--ds-border-strong); border-radius: 12px; padding: 12px; background: var(--ds-surface); display: grid; gap: 10px; }
    .gm-card.off { opacity: .65; }
    .gm-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .gm-name-input { flex: 1 1 200px; font-weight: 600; min-height: 32px; }
    .gm-ops { display: inline-flex; align-items: center; gap: 2px; }
    .on-chip { border-color: var(--ds-accent); color: var(--ds-accent-fg); background: var(--ds-accent-soft); }
    .gm-two-buckets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .gm-bucket { border: 1px solid var(--ds-border); border-radius: 9px; padding: 9px; background: var(--ds-surface-sunken); display: grid; gap: 7px; align-content: start; }
    .gm-bucket-pos { border-color: var(--ds-success-border); }
    .gm-bucket-neg { border-color: var(--ds-danger-border); }
    .gm-bucket-when { border-color: var(--ds-info-border); }
    .gm-bucket-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .gm-logic-sel { min-height: 26px; padding: 2px 22px 2px 7px; font-size: 11.5px; width: auto; }
    .gm-cond-row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, .95fr) minmax(0, 1.2fr) 28px; gap: 6px; align-items: center; }
    .gm-cond-row .select, .gm-cond-row .input { min-height: 30px; font-size: 12px; padding: 3px 8px; min-width: 0; }
    .gm-no-val { text-align: center; color: var(--ds-text-muted); font-size: 12px; }
    .gm-empty-cond { font-size: 11.5px; color: var(--ds-text-muted); }
    .gm-fallback-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
    .gm-fallback-bar small { font-size: 11.5px; color: var(--ds-text-muted); }
    .gm-cmp-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .gm-thresh-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 8px; border-radius: 9px; background: var(--ds-surface-sunken); border: 1px solid var(--ds-border); }
    .gm-num-pair { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 5px; }
    .gm-sim-card { border: 1px dashed var(--ds-border-strong); border-radius: 11px; padding: 10px 12px; background: var(--ds-surface-sunken); display: grid; gap: 8px; }
    .gm-sim-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; }
    .gm-sim-presets { display: inline-flex; gap: 4px; flex-wrap: wrap; }
    .gm-sim-inputs, .gm-sim-sup-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
    .gm-sim-traces { display: grid; gap: 5px; }
    .gm-sim-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; padding: 5px 8px; border-radius: 7px; background: var(--ds-surface); border: 1px solid var(--ds-border); }
    .gm-trace-list { display: inline-flex; gap: 5px; flex-wrap: wrap; margin-left: auto; }
    .gm-trace-chip { font-size: 11px; font-family: var(--ds-mono); padding: 1px 6px; border-radius: 999px; border: 1px solid var(--ds-border); color: var(--ds-text-muted); }
    .gm-trace-chip.pass { border-color: var(--ds-success-border); color: var(--ds-success-fg); background: var(--ds-success-bg); }
    .gm-foot { flex-wrap: wrap; gap: 8px; }
    @media (max-width: 780px) {
      .gm-two-buckets, .gm-cmp-grid, .gm-thresh-grid { grid-template-columns: 1fr; }
      .gm-cond-row { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 480px) {
      .gm-cond-row { grid-template-columns: 1fr; }
    }
  `],
})
export class GoalsModalComponent {
  readonly open = input<boolean>(false);
  readonly goalConfig = input<GoalConfig>({ call_rollup: 'all_positive', call_goals: [], campaign_goals: [] });
  readonly outputs = input<any[]>([]);
  readonly inputs = input<any[]>([]);
  readonly agentLabel = input<string>('');

  readonly save = output<GoalConfig>();
  readonly close = output<void>();

  readonly operators = CONDITION_OPERATORS;
  readonly numOps = NUM_COMPARE_OPS;
  readonly aggs = CAMPAIGN_AGGS;

  tab = signal<'call' | 'campaign'>('call');
  draft = signal<GoalConfig>({ call_rollup: 'all_positive', call_goals: [], campaign_goals: [] });
  simData = signal<Record<string, any>>({});
  cmpSimRows = signal<DrySampleRow[]>([
    { caller_name: 'Supplier A Packaging', committed_qty: 4200, accepted_po_count: 2, call_result: 'completed', po_acceptance_intent: 'ACCEPTED' },
    { caller_name: 'Supplier B Polymers', committed_qty: 15000, accepted_po_count: 1, call_result: 'completed', po_acceptance_intent: 'WILL_ACCEPT' },
    { caller_name: 'Supplier D Print Pack', committed_qty: 12250, accepted_po_count: 4, call_result: 'completed', po_acceptance_intent: 'ACCEPTED' },
    { caller_name: 'Supplier G Labels', committed_qty: 20000, accepted_po_count: 3, call_result: 'completed', po_acceptance_intent: 'ACCEPTED' },
  ]);

  hasRowsSchema = computed(() => this.outputs().some((v) => v?.key === 'rows' && v?.type === 'list'));
  fieldOptions = computed<GoalFieldOption[]>(() => buildGoalFieldOptions(this.outputs(), this.inputs()));

  fieldGroups = computed(() => {
    const order: GoalFieldOption['group'][] = ['Post-call output', 'Row sub-field', 'Pre-call input'];
    return order
      .map((group) => ({ group, items: this.fieldOptions().filter((f) => f.group === group) }))
      .filter((g) => g.items.length > 0);
  });

  campaignFieldOptions = computed(() =>
    this.fieldOptions().filter((f) => f.type === 'number' || f.value.includes('committed_qty')),
  );

  enabledCallCount = computed(() => this.draft().call_goals.filter((g) => g.enabled !== false).length);
  enabledCampaignCount = computed(() => this.draft().campaign_goals.filter((g) => g.enabled !== false).length);

  simEditableFields = computed(() => {
    const referenced = new Set<string>();
    for (const g of this.draft().call_goals) {
      for (const c of [...(g.when?.conditions || []), ...(g.positive?.conditions || []), ...(g.negative?.conditions || [])]) {
        if (c?.field) referenced.add(c.field);
      }
    }
    const all: { key: string; type: string; options?: string[]; prio: number }[] = [];
    for (const v of this.outputs()) {
      if (!v?.key || v.key === 'agent_goal') continue;
      if (v.type === 'list' && Array.isArray(v.fields)) {
        const qKey = `${v.key}[].committed_qty`;
        all.push({ key: qKey, type: 'number', prio: referenced.has(qKey) ? 0 : 2 });
        const stField = v.fields.find((f: any) => f.key === 'dispatch_status' || f.type === 'enum');
        if (stField) {
          const sKey = `${v.key}[].${stField.key}`;
          all.push({ key: sKey, type: 'enum', options: stField.options || [], prio: referenced.has(sKey) ? 0 : 2 });
        }
      } else if (v.type === 'enum' || v.type === 'boolean' || v.type === 'number') {
        all.push({ key: v.key, type: v.type, options: v.options || [], prio: referenced.has(v.key) ? 0 : 1 });
      }
    }
    all.sort((a, b) => a.prio - b.prio);
    return all.slice(0, 6);
  });

  simCallResult = computed(() => {
    const flat = this.simData();
    const outputs: Record<string, any> = {};
    const listMap: Record<string, Record<string, any>> = {};
    for (const [k, val] of Object.entries(flat)) {
      const m = /^([a-zA-Z0-9_]+)\[\]\.([a-zA-Z0-9_]+)$/.exec(k);
      if (m) {
        (listMap[m[1]] ||= {})[m[2]] = m[2] === 'committed_qty' ? Number(val) || 0 : val;
      } else {
        outputs[k] = val === 'true' ? true : val === 'false' ? false : val;
      }
    }
    for (const [lk, row] of Object.entries(listMap)) outputs[lk] = [row];
    return evaluateCallGoals(this.draft(), outputs, {});
  });

  simCampaignResult = computed(() => {
    const hasRows = this.hasRowsSchema();
    const records = this.cmpSimRows().map((r) => {
      const outputs: Record<string, any> = hasRows
        ? { call_result: r.call_result, rows: [{ dispatch_status: 'scheduled', committed_qty: r.committed_qty }] }
        : {
            call_result: r.call_result,
            po_acceptance_intent: r.po_acceptance_intent,
            eta_confirmation_received: true,
            accepted_po_count: r.accepted_po_count,
          };
      const ev = evaluateCallGoals(this.draft(), outputs, {});
      return { caller_name: r.caller_name, answered: true, outputs, inputs: {}, call_goal_outcome: ev.overall };
    });
    return evaluateCampaignGoals(this.draft(), records);
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        const cfg = this.goalConfig();
        const cloned: GoalConfig = cfg?.call_goals?.length || cfg?.campaign_goals?.length
          ? structuredClone(cfg)
          : defaultGoalConfigFromOutputs(this.outputs());
        this.draft.set(cloned);
        this.tab.set('call');
        this.loadSimPreset('positive');
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.open()) this.close.emit();
  }

  sanitizeId(s: string): string {
    return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  opNeedsVal(op: string): boolean {
    return op !== 'is_empty' && op !== 'is_not_empty';
  }

  setRollup(mode: CallRollupMode): void {
    this.draft.update((d) => ({ ...d, call_rollup: mode }));
  }

  addCallGoal(): void {
    const firstField = this.fieldOptions()[0]?.value || '';
    this.draft.update((d) => ({ ...d, call_goals: [...d.call_goals, blankCallGoal(firstField)] }));
  }

  patchCallGoal(i: number, c: Partial<CallGoalRule>): void {
    this.draft.update((d) => ({
      ...d,
      call_goals: d.call_goals.map((g, idx) => (idx === i ? { ...g, ...c } : g)),
    }));
  }

  moveCallGoal(i: number, dir: number): void {
    const to = i + dir;
    this.draft.update((d) => {
      if (to < 0 || to >= d.call_goals.length) return d;
      const list = [...d.call_goals];
      const [item] = list.splice(i, 1);
      list.splice(to, 0, item);
      return { ...d, call_goals: list };
    });
  }

  removeCallGoal(i: number): void {
    this.draft.update((d) => ({ ...d, call_goals: d.call_goals.filter((_, idx) => idx !== i) }));
  }

  toggleCallConditional(i: number): void {
    const cur = this.draft().call_goals[i];
    if (!cur) return;
    const next = !cur.conditional;
    const firstField = this.fieldOptions()[0]?.value || '';
    const when = cur.when?.conditions?.length ? cur.when : { logic: 'all' as const, conditions: [blankCondition(firstField)] };
    this.patchCallGoal(i, { conditional: next, when });
  }

  setCallGroupLogic(gi: number, bucket: 'when' | 'positive' | 'negative', logic: 'all' | 'any'): void {
    const g = this.draft().call_goals[gi];
    if (!g) return;
    this.patchCallGoal(gi, { [bucket]: { ...g[bucket], logic } });
  }

  addCallCond(gi: number, bucket: 'when' | 'positive' | 'negative'): void {
    const g = this.draft().call_goals[gi];
    if (!g) return;
    const firstField = this.fieldOptions()[0]?.value || '';
    this.patchCallGoal(gi, { [bucket]: { ...g[bucket], conditions: [...(g[bucket]?.conditions || []), blankCondition(firstField)] } });
  }

  patchCallCond(gi: number, bucket: 'when' | 'positive' | 'negative', ci: number, c: Partial<GoalCondition>): void {
    const g = this.draft().call_goals[gi];
    if (!g) return;
    const next = (g[bucket]?.conditions || []).map((row, idx) => (idx === ci ? { ...row, ...c } : row));
    this.patchCallGoal(gi, { [bucket]: { ...g[bucket], conditions: next } });
  }

  removeCallCond(gi: number, bucket: 'when' | 'positive' | 'negative', ci: number): void {
    const g = this.draft().call_goals[gi];
    if (!g) return;
    this.patchCallGoal(gi, { [bucket]: { ...g[bucket], conditions: (g[bucket]?.conditions || []).filter((_, idx) => idx !== ci) } });
  }

  addCampaignGoal(kind: CampaignGoalKind): void {
    const metricField = this.campaignFieldOptions()[0]?.value || '__call_goal_positive__';
    this.draft.update((d) => ({ ...d, campaign_goals: [...d.campaign_goals, blankCampaignGoal(kind, metricField)] }));
  }

  patchCampaignGoal(i: number, c: Partial<CampaignGoalRule>): void {
    this.draft.update((d) => ({
      ...d,
      campaign_goals: d.campaign_goals.map((g, idx) => (idx === i ? { ...g, ...c } : g)),
    }));
  }

  removeCampaignGoal(i: number): void {
    this.draft.update((d) => ({ ...d, campaign_goals: d.campaign_goals.filter((_, idx) => idx !== i) }));
  }

  toggleCampaignFilter(i: number): void {
    const cur = this.draft().campaign_goals[i];
    if (!cur) return;
    const firstField = this.fieldOptions()[0]?.value || '';
    const filter: ConditionGroup = cur.filter?.conditions?.length ? cur.filter : { logic: 'all', conditions: [blankCondition(firstField)] };
    this.patchCampaignGoal(i, { conditional: !cur.conditional, filter });
  }

  setCampaignFilterLogic(i: number, logic: 'all' | 'any'): void {
    const cur = this.draft().campaign_goals[i];
    if (!cur) return;
    this.patchCampaignGoal(i, { filter: { ...(cur.filter || { conditions: [] }), logic } });
  }

  addCampaignCond(i: number): void {
    const cur = this.draft().campaign_goals[i];
    if (!cur) return;
    const firstField = this.fieldOptions()[0]?.value || '';
    this.patchCampaignGoal(i, { filter: { ...(cur.filter || { logic: 'all' }), conditions: [...(cur.filter?.conditions || []), blankCondition(firstField)] } });
  }

  patchCampaignCond(i: number, fi: number, c: Partial<GoalCondition>): void {
    const cur = this.draft().campaign_goals[i];
    if (!cur) return;
    const next = (cur.filter?.conditions || []).map((r, idx) => (idx === fi ? { ...r, ...c } : r));
    this.patchCampaignGoal(i, { filter: { ...(cur.filter || { logic: 'all' }), conditions: next } });
  }

  removeCampaignCond(i: number, fi: number): void {
    const cur = this.draft().campaign_goals[i];
    if (!cur) return;
    const next = (cur.filter?.conditions || []).filter((_, idx) => idx !== fi);
    this.patchCampaignGoal(i, { filter: { ...(cur.filter || { logic: 'all' }), conditions: next } });
  }

  resetDefaults(): void {
    this.draft.set(defaultGoalConfigFromOutputs(this.outputs()));
  }

  loadSimPreset(kind: 'positive' | 'partial' | 'negative'): void {
    const next: Record<string, any> = {};
    for (const sf of this.simEditableFields()) {
      if (sf.key === 'call_result') {
        next[sf.key] = kind === 'negative' ? 'refused' : 'completed';
      } else if (sf.key === 'escalate_to') {
        next[sf.key] = kind === 'partial' ? 'buyer' : 'none';
      } else if (sf.key.endsWith('committed_qty')) {
        next[sf.key] = kind === 'positive' ? 1200 : kind === 'partial' ? 600 : 0;
      } else if (sf.key.endsWith('dispatch_status')) {
        next[sf.key] = kind === 'negative' ? 'qty_disputed' : kind === 'partial' ? 'tentative_no_commitment' : 'scheduled';
      } else if (sf.key === 'po_acceptance_intent') {
        next[sf.key] = kind === 'positive' ? 'ACCEPTED' : kind === 'negative' ? 'REJECTED' : 'PENDING_QUERY';
      } else if (sf.key === 'eta_confirmation_received' || sf.type === 'boolean') {
        next[sf.key] = kind === 'positive' ? 'true' : 'false';
      } else if (sf.type === 'number') {
        next[sf.key] = kind === 'positive' ? 2 : kind === 'partial' ? 1 : 0;
      } else if (sf.options?.length) {
        next[sf.key] = kind === 'positive' ? sf.options[0] : sf.options[sf.options.length - 1];
      } else {
        next[sf.key] = kind === 'positive' ? 'confirmed' : '';
      }
    }
    this.simData.set(next);
  }

  simValue(key: string): any {
    return this.simData()[key] ?? '';
  }

  setSimValue(key: string, val: any): void {
    this.simData.update((m) => ({ ...m, [key]: val }));
  }

  setCmpSimQty(idx: number, val: number): void {
    const isRows = this.hasRowsSchema();
    this.cmpSimRows.update((rows) =>
      rows.map((r, i) => (i === idx ? (isRows ? { ...r, committed_qty: val } : { ...r, accepted_po_count: val }) : r)),
    );
  }
}
