import { Component, HostListener, computed, effect, input, output, signal, untracked } from '@angular/core';
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
 * Sleek, low-cognitive-load editor for Call-level & Campaign-level Goals.
 * Shows clean goal summaries by default; per-rule editors, conditionals,
 * match logic, rollup, and simulators live behind progressive disclosure.
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
          aria-label="Goals configuration"
          (click)="$event.stopPropagation()"
        >
          <div class="modal-head">
            <div class="gm-head-copy">
              <div class="modal-title gm-title">
                <app-icon name="target" [size]="15"></app-icon>
                <span>Goals</span>
                @if (agentLabel()) {
                  <span class="tag">{{ agentLabel() }}</span>
                }
              </div>
              <div class="modal-sub">
                Positive, Negative, or Partial outcomes from extracted outputs.
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
                Call ({{ draft().call_goals.length }})
              </button>
              <button
                type="button"
                role="tab"
                [class.on]="tab() === 'campaign'"
                [attr.aria-selected]="tab() === 'campaign'"
                (click)="tab.set('campaign')"
              >
                Campaign ({{ draft().campaign_goals.length }})
              </button>
            </div>
            @if (tab() === 'call') {
              <button type="button" class="btn btn-sm gm-ml-auto" (click)="addCallGoal()">
                <app-icon name="plus" [size]="13"></app-icon> Add goal
              </button>
            } @else {
              <div class="gm-add-group gm-ml-auto">
                <button type="button" class="btn btn-sm" (click)="addCampaignGoal('target')">
                  <app-icon name="plus" [size]="13"></app-icon> Target
                </button>
                <button type="button" class="btn btn-sm" (click)="addCampaignGoal('extrema')">
                  <app-icon name="plus" [size]="13"></app-icon> Top contributor
                </button>
              </div>
            }
          </div>

          <div class="modal-body gm-body">
            @if (tab() === 'call') {
              <div class="gm-list">
                @for (g of draft().call_goals; track g.id; let gi = $index) {
                  <section class="gm-row-card" [class.off]="!g.enabled" [class.open]="expandedCallId() === g.id">
                    <div class="gm-row-head" (click)="toggleExpandCall(g.id)">
                      <label class="switch" (click)="$event.stopPropagation()" title="Enable goal">
                        <input
                          type="checkbox"
                          [checked]="g.enabled"
                          (change)="patchCallGoal(gi, { enabled: $any($event.target).checked })"
                          [attr.aria-label]="'Enable goal ' + g.name"
                        />
                        <i></i>
                      </label>
                      <div class="gm-row-copy">
                        <b>{{ g.name || 'Untitled goal' }}</b>
                        <small>
                          {{ g.positive.conditions.length }} positive · {{ g.negative.conditions.length }} negative · else Partial@if (g.conditional) { · Conditional}
                        </small>
                      </div>
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost"
                        (click)="$event.stopPropagation(); toggleExpandCall(g.id)"
                        [attr.aria-expanded]="expandedCallId() === g.id"
                      >
                        {{ expandedCallId() === g.id ? 'Done' : 'Edit' }}
                      </button>
                      <button
                        type="button"
                        class="btn-icon"
                        aria-label="Delete call goal"
                        (click)="$event.stopPropagation(); removeCallGoal(gi)"
                      >
                        <app-icon name="trash" [size]="13"></app-icon>
                      </button>
                    </div>

                    @if (expandedCallId() === g.id) {
                      <div class="gm-row-body">
                        <label class="field">
                          <span class="field-label">Goal name</span>
                          <input
                            class="input"
                            [ngModel]="g.name"
                            (ngModelChange)="patchCallGoal(gi, { name: $event })"
                            placeholder="e.g. PO acceptance & dispatch date"
                          />
                        </label>

                        <div class="gm-rule-block pos">
                          <div class="gm-rule-head">
                            <span class="gm-dot pos"></span>
                            <b>Positive when</b>
                            <button type="button" class="btn btn-sm btn-ghost gm-ml-auto" (click)="addCallCond(gi, 'positive')">+ Rule</button>
                          </div>
                          @for (c of g.positive.conditions; track $index; let ci = $index) {
                            <div class="gm-cond-row">
                              <select class="select" [ngModel]="c.field" (ngModelChange)="patchCallCond(gi, 'positive', ci, { field: $event })" aria-label="Positive field">
                                @for (grp of fieldGroups(); track grp.group) {
                                  <optgroup [label]="grp.group">
                                    @for (f of grp.items; track f.value) { <option [value]="f.value">{{ f.label }}</option> }
                                  </optgroup>
                                }
                              </select>
                              <select class="select" [ngModel]="c.op" (ngModelChange)="patchCallCond(gi, 'positive', ci, { op: $event })" aria-label="Positive operator">
                                @for (op of operators; track op.value) { <option [value]="op.value">{{ op.label }}</option> }
                              </select>
                              @if (opNeedsVal(c.op)) {
                                <input class="input" [ngModel]="c.value" (ngModelChange)="patchCallCond(gi, 'positive', ci, { value: $event })" [attr.list]="'gm-opts-' + sanitizeId(c.field)" placeholder="Value" aria-label="Positive value" />
                              } @else {
                                <span class="gm-no-val">—</span>
                              }
                              <button type="button" class="btn-icon" aria-label="Remove rule" (click)="removeCallCond(gi, 'positive', ci)"><app-icon name="close" [size]="12"></app-icon></button>
                            </div>
                          }
                        </div>

                        <div class="gm-rule-block neg">
                          <div class="gm-rule-head">
                            <span class="gm-dot neg"></span>
                            <b>Negative when</b>
                            <button type="button" class="btn btn-sm btn-ghost gm-ml-auto" (click)="addCallCond(gi, 'negative')">+ Rule</button>
                          </div>
                          @for (c of g.negative.conditions; track $index; let ci = $index) {
                            <div class="gm-cond-row">
                              <select class="select" [ngModel]="c.field" (ngModelChange)="patchCallCond(gi, 'negative', ci, { field: $event })" aria-label="Negative field">
                                @for (grp of fieldGroups(); track grp.group) {
                                  <optgroup [label]="grp.group">
                                    @for (f of grp.items; track f.value) { <option [value]="f.value">{{ f.label }}</option> }
                                  </optgroup>
                                }
                              </select>
                              <select class="select" [ngModel]="c.op" (ngModelChange)="patchCallCond(gi, 'negative', ci, { op: $event })" aria-label="Negative operator">
                                @for (op of operators; track op.value) { <option [value]="op.value">{{ op.label }}</option> }
                              </select>
                              @if (opNeedsVal(c.op)) {
                                <input class="input" [ngModel]="c.value" (ngModelChange)="patchCallCond(gi, 'negative', ci, { value: $event })" [attr.list]="'gm-opts-' + sanitizeId(c.field)" placeholder="Value" aria-label="Negative value" />
                              } @else {
                                <span class="gm-no-val">—</span>
                              }
                              <button type="button" class="btn-icon" aria-label="Remove rule" (click)="removeCallCond(gi, 'negative', ci)"><app-icon name="close" [size]="12"></app-icon></button>
                            </div>
                          }
                        </div>

                        <div class="gm-else-line">Otherwise → <b>Partial</b></div>

                        <details class="gm-adv">
                          <summary>Advanced settings</summary>
                          <div class="gm-adv-body">
                            <div class="gm-adv-row">
                              <label class="field">
                                <span class="field-label">Positive match</span>
                                <select class="select" [ngModel]="g.positive.logic" (ngModelChange)="setCallGroupLogic(gi, 'positive', $event)">
                                  <option value="all">Match ALL rules (AND)</option>
                                  <option value="any">Match ANY rule (OR)</option>
                                </select>
                              </label>
                              <label class="field">
                                <span class="field-label">Negative match</span>
                                <select class="select" [ngModel]="g.negative.logic" (ngModelChange)="setCallGroupLogic(gi, 'negative', $event)">
                                  <option value="any">Match ANY rule (OR)</option>
                                  <option value="all">Match ALL rules (AND)</option>
                                </select>
                              </label>
                            </div>

                            <label class="gm-chk">
                              <input type="checkbox" [checked]="g.conditional" (change)="toggleCallConditional(gi)" />
                              <span>Only evaluate this goal when a condition holds</span>
                            </label>

                            @if (g.conditional) {
                              <div class="gm-rule-block">
                                <div class="gm-rule-head">
                                  <b>Activate when</b>
                                  <select class="select gm-mini-sel" [ngModel]="g.when.logic" (ngModelChange)="setCallGroupLogic(gi, 'when', $event)">
                                    <option value="all">ALL</option>
                                    <option value="any">ANY</option>
                                  </select>
                                  <button type="button" class="btn btn-sm btn-ghost gm-ml-auto" (click)="addCallCond(gi, 'when')">+ Rule</button>
                                </div>
                                @for (c of g.when.conditions; track $index; let ci = $index) {
                                  <div class="gm-cond-row">
                                    <select class="select" [ngModel]="c.field" (ngModelChange)="patchCallCond(gi, 'when', ci, { field: $event })" aria-label="Activation field">
                                      @for (grp of fieldGroups(); track grp.group) {
                                        <optgroup [label]="grp.group">
                                          @for (f of grp.items; track f.value) { <option [value]="f.value">{{ f.label }}</option> }
                                        </optgroup>
                                      }
                                    </select>
                                    <select class="select" [ngModel]="c.op" (ngModelChange)="patchCallCond(gi, 'when', ci, { op: $event })" aria-label="Activation operator">
                                      @for (op of operators; track op.value) { <option [value]="op.value">{{ op.label }}</option> }
                                    </select>
                                    @if (opNeedsVal(c.op)) {
                                      <input class="input" [ngModel]="c.value" (ngModelChange)="patchCallCond(gi, 'when', ci, { value: $event })" [attr.list]="'gm-opts-' + sanitizeId(c.field)" placeholder="Value" aria-label="Activation value" />
                                    } @else {
                                      <span class="gm-no-val">—</span>
                                    }
                                    <button type="button" class="btn-icon" aria-label="Remove rule" (click)="removeCallCond(gi, 'when', ci)"><app-icon name="close" [size]="12"></app-icon></button>
                                  </div>
                                }
                              </div>
                            }

                            <div class="gm-order-row">
                              <button type="button" class="btn btn-sm" [disabled]="gi === 0" (click)="moveCallGoal(gi, -1)">Move up</button>
                              <button type="button" class="btn btn-sm" [disabled]="gi === draft().call_goals.length - 1" (click)="moveCallGoal(gi, 1)">Move down</button>
                            </div>
                          </div>
                        </details>
                      </div>
                    }
                  </section>
                } @empty {
                  <div class="empty-sub">No call goals yet. Click "+ Add goal" to create one.</div>
                }
              </div>

              @for (f of fieldOptions(); track f.value) {
                @if (f.options?.length) {
                  <datalist [id]="'gm-opts-' + sanitizeId(f.value)">
                    @for (opt of f.options; track opt) { <option [value]="opt"></option> }
                  </datalist>
                }
              }

              <details class="gm-adv">
                <summary>Advanced: Rollup &amp; Test Simulator</summary>
                <div class="gm-adv-body">
                  <div class="gm-adv-row">
                    <label class="field">
                      <span class="field-label">Multiple goals rollup</span>
                      <select class="select" [ngModel]="draft().call_rollup" (ngModelChange)="setRollup($event)">
                        <option value="all_positive">All active positive (else Partial)</option>
                        <option value="any_positive">Any active positive (no negative)</option>
                        <option value="majority">Majority positive</option>
                      </select>
                    </label>
                    <div class="field" style="align-self:end">
                      <button type="button" class="btn btn-sm" (click)="resetDefaults()">Reset to agent defaults</button>
                    </div>
                  </div>

                  <div class="gm-sim-head">
                    <b>Test sample call</b>
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
                            @for (opt of sf.options; track opt) { <option [value]="opt">{{ opt }}</option> }
                          </select>
                        } @else if (sf.type === 'boolean') {
                          <select class="select" [ngModel]="simValue(sf.key)" (ngModelChange)="setSimValue(sf.key, $event)">
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        } @else {
                          <input class="input mono" [type]="sf.type === 'number' ? 'number' : 'text'" [ngModel]="simValue(sf.key)" (ngModelChange)="setSimValue(sf.key, $event)" />
                        }
                      </label>
                    }
                  </div>

                  <div class="gm-sim-traces">
                    @for (item of simCallResult().goals; track item.id) {
                      <div class="gm-sim-row">
                        <span class="tag" [class.ok]="item.outcome === 'positive'" [class.bad]="item.outcome === 'negative'" [class.warn]="item.outcome === 'partial'">{{ item.outcome }}</span>
                        <b>{{ item.name }}</b>
                      </div>
                    }
                  </div>
                </div>
              </details>
            } @else {
              <div class="gm-list">
                @for (cg of draft().campaign_goals; track cg.id; let ci = $index) {
                  <section class="gm-row-card" [class.off]="!cg.enabled" [class.open]="expandedCampId() === cg.id">
                    <div class="gm-row-head" (click)="toggleExpandCamp(cg.id)">
                      <label class="switch" (click)="$event.stopPropagation()" title="Enable campaign goal">
                        <input
                          type="checkbox"
                          [checked]="cg.enabled"
                          (change)="patchCampaignGoal(ci, { enabled: $any($event.target).checked })"
                          [attr.aria-label]="'Enable campaign goal ' + cg.name"
                        />
                        <i></i>
                      </label>
                      <div class="gm-row-copy">
                        <b>{{ cg.name || 'Untitled campaign goal' }}</b>
                        <small>
                          {{ cg.aggregation.toUpperCase() }}({{ cg.field === '__call_goal_positive__' ? 'positive_calls' : cg.field }}) · Target {{ cg.target.toLocaleString('en-US') }} {{ cg.unit }}
                        </small>
                      </div>
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost"
                        (click)="$event.stopPropagation(); toggleExpandCamp(cg.id)"
                        [attr.aria-expanded]="expandedCampId() === cg.id"
                      >
                        {{ expandedCampId() === cg.id ? 'Done' : 'Edit' }}
                      </button>
                      <button
                        type="button"
                        class="btn-icon"
                        aria-label="Delete campaign goal"
                        (click)="$event.stopPropagation(); removeCampaignGoal(ci)"
                      >
                        <app-icon name="trash" [size]="13"></app-icon>
                      </button>
                    </div>

                    @if (expandedCampId() === cg.id) {
                      <div class="gm-row-body">
                        <div class="gm-cmp-grid">
                          <label class="field gm-span-2">
                            <span class="field-label">Goal name</span>
                            <input class="input" [ngModel]="cg.name" (ngModelChange)="patchCampaignGoal(ci, { name: $event })" placeholder="e.g. Packaging demand fulfilled" />
                          </label>
                          <label class="field">
                            <span class="field-label">Type</span>
                            <select class="select" [ngModel]="cg.kind" (ngModelChange)="patchCampaignGoal(ci, { kind: $event })">
                              <option value="target">Cumulative Target</option>
                              <option value="extrema">Top / Min Contributor</option>
                            </select>
                          </label>
                          <label class="field">
                            <span class="field-label">Aggregate</span>
                            <select class="select" [ngModel]="cg.aggregation" (ngModelChange)="patchCampaignGoal(ci, { aggregation: $event })">
                              @for (a of aggs; track a.value) { <option [value]="a.value">{{ a.label }}</option> }
                            </select>
                          </label>
                          <label class="field gm-span-2">
                            <span class="field-label">Output field</span>
                            <select class="select" [ngModel]="cg.field" (ngModelChange)="patchCampaignGoal(ci, { field: $event })">
                              <option value="__call_goal_positive__">Positive Call Goals (calls)</option>
                              @for (f of campaignFieldOptions(); track f.value) { <option [value]="f.value">{{ f.label }}</option> }
                            </select>
                          </label>
                          <label class="field">
                            <span class="field-label">Target</span>
                            <input class="input mono" type="number" [ngModel]="cg.target" (ngModelChange)="onTargetChange(ci, +$event || 0)" />
                          </label>
                          <label class="field">
                            <span class="field-label">Unit</span>
                            <input class="input" [ngModel]="cg.unit" (ngModelChange)="patchCampaignGoal(ci, { unit: $event })" placeholder="units" />
                          </label>
                        </div>

                        <details class="gm-adv">
                          <summary>Advanced settings</summary>
                          <div class="gm-adv-body">
                            <div class="gm-adv-row">
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
                            </div>

                            <label class="field">
                              <span class="field-label">Group contributor by</span>
                              <input class="input mono" [ngModel]="cg.group_by" (ngModelChange)="patchCampaignGoal(ci, { group_by: $event })" placeholder="caller_name" />
                            </label>

                            <label class="gm-chk">
                              <input type="checkbox" [checked]="cg.conditional" (change)="toggleCampaignFilter(ci)" />
                              <span>Filter included calls</span>
                            </label>

                            @if (cg.conditional) {
                              <div class="gm-rule-block">
                                <div class="gm-rule-head">
                                  <b>Include calls where</b>
                                  <select class="select gm-mini-sel" [ngModel]="cg.filter.logic" (ngModelChange)="setCampaignFilterLogic(ci, $event)">
                                    <option value="all">ALL</option>
                                    <option value="any">ANY</option>
                                  </select>
                                  <button type="button" class="btn btn-sm btn-ghost gm-ml-auto" (click)="addCampaignCond(ci)">+ Rule</button>
                                </div>
                                @for (fc of cg.filter.conditions; track $index; let fi = $index) {
                                  <div class="gm-cond-row">
                                    <select class="select" [ngModel]="fc.field" (ngModelChange)="patchCampaignCond(ci, fi, { field: $event })" aria-label="Filter field">
                                      @for (grp of fieldGroups(); track grp.group) {
                                        <optgroup [label]="grp.group">
                                          @for (f of grp.items; track f.value) { <option [value]="f.value">{{ f.label }}</option> }
                                        </optgroup>
                                      }
                                    </select>
                                    <select class="select" [ngModel]="fc.op" (ngModelChange)="patchCampaignCond(ci, fi, { op: $event })" aria-label="Filter operator">
                                      @for (op of operators; track op.value) { <option [value]="op.value">{{ op.label }}</option> }
                                    </select>
                                    @if (opNeedsVal(fc.op)) {
                                      <input class="input" [ngModel]="fc.value" (ngModelChange)="patchCampaignCond(ci, fi, { value: $event })" placeholder="Value" aria-label="Filter value" />
                                    } @else {
                                      <span class="gm-no-val">—</span>
                                    }
                                    <button type="button" class="btn-icon" aria-label="Remove filter rule" (click)="removeCampaignCond(ci, fi)"><app-icon name="close" [size]="12"></app-icon></button>
                                  </div>
                                }
                              </div>
                            }
                          </div>
                        </details>
                      </div>
                    }
                  </section>
                } @empty {
                  <div class="empty-sub">No campaign goals yet.</div>
                }
              </div>

              <details class="gm-adv">
                <summary>Advanced: Cumulative Dry-Run Preview</summary>
                <div class="gm-adv-body">
                  <div class="gm-sim-inputs">
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
                        <span class="tag" [class.ok]="res.outcome === 'positive'" [class.bad]="res.outcome === 'negative'" [class.warn]="res.outcome === 'partial'">{{ res.outcome.toUpperCase() }}</span>
                        <b>{{ res.name }}</b>
                        <span class="mono gm-ml-auto">
                          @if (res.kind === 'extrema' && res.leader) {
                            {{ res.leader.name }} ({{ res.leader.value.toLocaleString('en-US') }} {{ res.unit }})
                          } @else {
                            {{ res.current_value.toLocaleString('en-US') }} / {{ res.target.toLocaleString('en-US') }} {{ res.unit }}
                          }
                        </span>
                      </div>
                    }
                  </div>
                </div>
              </details>
            }
          </div>

          <div class="modal-foot gm-foot">
            <span class="row-sub">
              {{ enabledCallCount() }} call · {{ enabledCampaignCount() }} campaign active
            </span>
            <span class="gm-ml-auto"></span>
            <button type="button" class="btn" (click)="close.emit()">Cancel</button>
            <button type="button" class="btn btn-primary" (click)="save.emit(draft())">Save goals</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .gm-modal { width: min(680px, 100%); max-width: none; }
    .gm-head-copy { min-width: 0; }
    .gm-title { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .gm-tabs-bar { padding: 8px 18px 10px; border-bottom: 1px solid var(--ds-border-subtle); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .gm-ml-auto { margin-left: auto; }
    .gm-add-group { display: inline-flex; gap: 6px; }
    .gm-body { display: grid; gap: 10px; align-content: start; min-width: 0; }
    .gm-list { display: grid; gap: 8px; }
    .gm-row-card { border: 1px solid var(--ds-border); border-radius: 10px; background: var(--ds-surface); overflow: hidden; }
    .gm-row-card.open { border-color: var(--ds-border-strong); }
    .gm-row-card.off { opacity: .6; }
    .gm-row-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; }
    .gm-row-head:hover { background: var(--ds-hover); }
    .gm-row-copy { flex: 1; min-width: 0; display: grid; gap: 1px; }
    .gm-row-copy b { font-size: 13px; color: var(--ds-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gm-row-copy small { font-size: 11.5px; color: var(--ds-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gm-row-body { padding: 0 12px 12px; border-top: 1px solid var(--ds-border-subtle); display: grid; gap: 10px; padding-top: 10px; }
    .gm-rule-block { border: 1px solid var(--ds-border); border-radius: 8px; padding: 8px 10px; background: var(--ds-surface-sunken); display: grid; gap: 6px; }
    .gm-rule-block.pos { border-left: 3px solid var(--ds-success); }
    .gm-rule-block.neg { border-left: 3px solid var(--ds-danger); }
    .gm-rule-head { display: flex; align-items: center; gap: 7px; font-size: 12px; }
    .gm-dot { width: 7px; height: 7px; border-radius: 50%; }
    .gm-dot.pos { background: var(--ds-success); }
    .gm-dot.neg { background: var(--ds-danger); }
    .gm-cond-row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, .9fr) minmax(0, 1.1fr) 26px; gap: 6px; align-items: center; }
    .gm-cond-row .select, .gm-cond-row .input { min-height: 30px; font-size: 12px; padding: 3px 8px; min-width: 0; }
    .gm-no-val { text-align: center; color: var(--ds-text-muted); font-size: 12px; }
    .gm-else-line { font-size: 11.5px; color: var(--ds-text-muted); }
    .gm-adv { border: 1px solid var(--ds-border); border-radius: 9px; background: var(--ds-surface-sunken); padding: 7px 10px; }
    .gm-adv > summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--ds-text-muted); list-style: none; display: flex; align-items: center; justify-content: space-between; }
    .gm-adv > summary::after { content: '▸'; font-size: 11px; }
    .gm-adv[open] > summary::after { content: '▾'; }
    .gm-adv-body { display: grid; gap: 10px; padding-top: 10px; }
    .gm-adv-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .gm-mini-sel { min-height: 24px; padding: 2px 22px 2px 6px; font-size: 11px; width: auto; }
    .gm-chk { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; cursor: pointer; }
    .gm-chk input { accent-color: var(--ds-accent); }
    .gm-order-row { display: flex; gap: 6px; }
    .gm-cmp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .gm-span-2 { grid-column: span 2; }
    .gm-num-pair { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 5px; }
    .gm-sim-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
    .gm-sim-presets { display: inline-flex; gap: 4px; flex-wrap: wrap; }
    .gm-sim-inputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
    .gm-sim-traces { display: grid; gap: 5px; }
    .gm-sim-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; padding: 6px 8px; border-radius: 7px; background: var(--ds-surface); border: 1px solid var(--ds-border); }
    .gm-foot { flex-wrap: wrap; gap: 8px; }
    @media (max-width: 600px) {
      .gm-cond-row, .gm-adv-row, .gm-cmp-grid { grid-template-columns: 1fr; }
      .gm-span-2 { grid-column: auto; }
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
  expandedCallId = signal<string | null>(null);
  expandedCampId = signal<string | null>(null);
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
        untracked(() => {
          const cfg = this.goalConfig();
          const cloned: GoalConfig = cfg?.call_goals?.length || cfg?.campaign_goals?.length
            ? structuredClone(cfg)
            : defaultGoalConfigFromOutputs(this.outputs());
          this.draft.set(cloned);
          this.tab.set('call');
          this.expandedCallId.set(null);
          this.expandedCampId.set(null);
          this.loadSimPreset('positive');
        });
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

  toggleExpandCall(id: string): void {
    this.expandedCallId.update((cur) => (cur === id ? null : id));
  }

  toggleExpandCamp(id: string): void {
    this.expandedCampId.update((cur) => (cur === id ? null : id));
  }

  setRollup(mode: CallRollupMode): void {
    this.draft.update((d) => ({ ...d, call_rollup: mode }));
  }

  addCallGoal(): void {
    const firstField = this.fieldOptions()[0]?.value || '';
    const g = blankCallGoal(firstField);
    this.draft.update((d) => ({ ...d, call_goals: [...d.call_goals, g] }));
    this.expandedCallId.set(g.id);
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
    const id = this.draft().call_goals[i]?.id;
    this.draft.update((d) => ({ ...d, call_goals: d.call_goals.filter((_, idx) => idx !== i) }));
    if (id && this.expandedCallId() === id) this.expandedCallId.set(null);
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
    const g = blankCampaignGoal(kind, metricField);
    this.draft.update((d) => ({ ...d, campaign_goals: [...d.campaign_goals, g] }));
    this.expandedCampId.set(g.id);
  }

  patchCampaignGoal(i: number, c: Partial<CampaignGoalRule>): void {
    this.draft.update((d) => ({
      ...d,
      campaign_goals: d.campaign_goals.map((g, idx) => (idx === i ? { ...g, ...c } : g)),
    }));
  }

  onTargetChange(i: number, target: number): void {
    const cur = this.draft().campaign_goals[i];
    if (!cur) return;
    const syncPos = cur.positive_value === cur.target;
    this.patchCampaignGoal(i, {
      target,
      ...(syncPos ? { positive_value: target } : {}),
    });
  }

  removeCampaignGoal(i: number): void {
    const id = this.draft().campaign_goals[i]?.id;
    this.draft.update((d) => ({ ...d, campaign_goals: d.campaign_goals.filter((_, idx) => idx !== i) }));
    if (id && this.expandedCampId() === id) this.expandedCampId.set(null);
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
    this.expandedCallId.set(null);
    this.expandedCampId.set(null);
  }

  loadSimPreset(kind: 'positive' | 'partial' | 'negative'): void {
    const next: Record<string, any> = {};
    for (const sf of this.simEditableFields()) {
      if (sf.key === 'call_result') {
        next[sf.key] = kind === 'negative' ? 'refused' : 'completed';
      } else if (sf.key === 'escalate_to') {
        next[sf.key] = kind === 'positive' ? 'none' : kind === 'negative' ? 'buyer' : '';
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
