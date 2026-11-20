// Deterministic goal models, field builders, presets, and live browser-side evaluator
// mirroring mock/goal-engine.mjs for Agent Detail editing & simulation.

export type GoalOperator =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in'
  | 'all_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_not_empty'
  | 'is_empty'
  | 'contains';

export interface GoalCondition {
  field: string;
  op: GoalOperator;
  value: string;
}

export interface ConditionGroup {
  logic: 'all' | 'any';
  conditions: GoalCondition[];
}

export type GoalOutcome = 'positive' | 'negative' | 'partial' | 'skipped';
export type CallRollupMode = 'all_positive' | 'any_positive' | 'majority';

export interface CallGoalRule {
  id: string;
  name: string;
  enabled: boolean;
  conditional: boolean;
  when: ConditionGroup;
  positive: ConditionGroup;
  negative: ConditionGroup;
}

export type CampaignGoalKind = 'target' | 'extrema';
export type CampaignAgg = 'sum' | 'count' | 'percent' | 'avg' | 'max' | 'min';
export type NumCompareOp = 'gte' | 'gt' | 'lte' | 'lt' | 'equals';

export interface CampaignGoalRule {
  id: string;
  name: string;
  kind: CampaignGoalKind;
  enabled: boolean;
  aggregation: CampaignAgg;
  field: string;
  unit: string;
  group_by: string;
  target: number;
  positive_op: NumCompareOp;
  positive_value: number;
  negative_op: NumCompareOp;
  negative_value: number;
  conditional: boolean;
  filter: ConditionGroup;
}

export interface GoalConfig {
  call_rollup: CallRollupMode;
  call_goals: CallGoalRule[];
  campaign_goals: CampaignGoalRule[];
}

export interface ConditionTrace {
  bucket: string;
  field: string;
  op: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface CallGoalEvalItem {
  id: string;
  name: string;
  outcome: GoalOutcome;
  reason?: string;
  traces: ConditionTrace[];
}

export interface CallGoalEvaluation {
  overall: 'positive' | 'negative' | 'partial' | null;
  rollup: CallRollupMode;
  counts: { positive: number; partial: number; negative: number; skipped: number };
  goals: CallGoalEvalItem[];
}

export interface ContributorStat {
  name: string;
  phone: string;
  value: number;
  calls: number;
  call_id: string | null;
}

export interface CampaignGoalEvaluation {
  id: string;
  name: string;
  kind: CampaignGoalKind;
  aggregation: CampaignAgg;
  field: string;
  unit: string;
  group_by: string;
  target: number;
  current_value: number;
  progress_pct: number | null;
  matched_calls: number;
  outcome: 'positive' | 'negative' | 'partial';
  leader: ContributorStat | null;
  top_contributors: ContributorStat[];
  thresholds: {
    positive_op: NumCompareOp;
    positive_value: number;
    negative_op: NumCompareOp;
    negative_value: number;
  };
}

export interface GoalFieldOption {
  value: string;
  label: string;
  group: 'Post-call output' | 'Row sub-field' | 'Pre-call input' | 'Computed metric';
  type: string;
  options?: string[];
}

export const CONDITION_OPERATORS: { value: GoalOperator; label: string; needsValue: boolean }[] = [
  { value: 'equals', label: 'equals (=)', needsValue: true },
  { value: 'not_equals', label: 'not equals (!=)', needsValue: true },
  { value: 'in', label: 'is one of', needsValue: true },
  { value: 'not_in', label: 'is none of', needsValue: true },
  { value: 'all_in', label: 'all rows in', needsValue: true },
  { value: 'gt', label: '>', needsValue: true },
  { value: 'gte', label: '>=', needsValue: true },
  { value: 'lt', label: '<', needsValue: true },
  { value: 'lte', label: '<=', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'is_not_empty', label: 'is not empty', needsValue: false },
  { value: 'is_empty', label: 'is empty', needsValue: false },
];

export const NUM_COMPARE_OPS: { value: NumCompareOp; label: string }[] = [
  { value: 'gte', label: '>=' },
  { value: 'gt', label: '>' },
  { value: 'lte', label: '<=' },
  { value: 'lt', label: '<' },
  { value: 'equals', label: '=' },
];

export const CAMPAIGN_AGGS: { value: CampaignAgg; label: string }[] = [
  { value: 'sum', label: 'SUM' },
  { value: 'max', label: 'MAX' },
  { value: 'min', label: 'MIN' },
  { value: 'avg', label: 'AVG' },
  { value: 'count', label: 'COUNT' },
  { value: 'percent', label: 'PERCENT (%)' },
];

export const blankCondition = (field = ''): GoalCondition => ({
  field,
  op: 'equals',
  value: '',
});

export const blankCallGoal = (defaultField = ''): CallGoalRule => ({
  id: 'cg_' + Math.random().toString(36).slice(2, 7),
  name: 'New call goal',
  enabled: true,
  conditional: false,
  when: { logic: 'all', conditions: [blankCondition(defaultField)] },
  positive: { logic: 'all', conditions: [blankCondition(defaultField)] },
  negative: { logic: 'any', conditions: [blankCondition(defaultField)] },
});

export const blankCampaignGoal = (
  kind: CampaignGoalKind = 'target',
  defaultField = '',
): CampaignGoalRule => ({
  id: 'cmp_' + Math.random().toString(36).slice(2, 7),
  name: kind === 'extrema' ? 'Max commitment received from' : 'Cumulative campaign target',
  kind,
  enabled: true,
  aggregation: kind === 'extrema' ? 'max' : 'sum',
  field: defaultField || '__call_goal_positive__',
  unit: 'units',
  group_by: 'caller_name',
  target: kind === 'extrema' ? 10000 : 100000,
  positive_op: 'gte',
  positive_value: kind === 'extrema' ? 10000 : 100000,
  negative_op: kind === 'extrema' ? 'lte' : 'lt',
  negative_value: kind === 'extrema' ? 0 : 25000,
  conditional: false,
  filter: { logic: 'all', conditions: [] },
});

export function buildGoalFieldOptions(outputs: any[] = [], inputs: any[] = []): GoalFieldOption[] {
  const out: GoalFieldOption[] = [];
  for (const v of outputs) {
    if (!v?.key || v.key === 'agent_goal') continue;
    out.push({
      value: v.key,
      label: v.label && v.label !== v.key ? `${v.key} (${v.label})` : v.key,
      group: 'Post-call output',
      type: v.type || 'string',
      options: v.options || [],
    });
    if (v.type === 'list' && Array.isArray(v.fields)) {
      out.push({
        value: `${v.key}[].committed_qty`,
        label: `${v.key}[].committed_qty (sum of lots + ready + dispatched)`,
        group: 'Row sub-field',
        type: 'number',
      });
      for (const sf of v.fields) {
        if (!sf?.key) continue;
        out.push({
          value: `${v.key}[].${sf.key}`,
          label: `${v.key}[].${sf.key}`,
          group: 'Row sub-field',
          type: sf.type || 'string',
          options: sf.options || [],
        });
      }
    }
  }
  for (const v of inputs) {
    if (!v?.key) continue;
    out.push({
      value: v.key,
      label: v.key,
      group: 'Pre-call input',
      type: v.type || 'string',
    });
  }
  return out;
}

export function defaultGoalConfigFromOutputs(outputs: any[] = []): GoalConfig {
  const keys = new Set(outputs.map((v) => v?.key));
  if (keys.has('rows') && keys.has('call_result')) {
    return {
      call_rollup: 'all_positive',
      call_goals: [
        {
          id: 'cg_po_dispatch',
          name: 'PO acceptance & dispatch schedule',
          enabled: true,
          conditional: false,
          when: { logic: 'all', conditions: [] },
          positive: {
            logic: 'all',
            conditions: [
              { field: 'call_result', op: 'equals', value: 'completed' },
              { field: 'rows[].dispatch_status', op: 'in', value: 'scheduled, dispatched, partly_scheduled, rescheduled' },
              { field: 'rows[].committed_qty', op: 'gt', value: '0' },
            ],
          },
          negative: {
            logic: 'any',
            conditions: [
              { field: 'call_result', op: 'in', value: 'refused, wrong_contact' },
              { field: 'rows[].dispatch_status', op: 'in', value: 'batch_rejected, qty_disputed, no_capacity' },
            ],
          },
        },
        {
          id: 'cg_no_escalation',
          name: 'Zero buyer or quality escalation',
          enabled: true,
          conditional: true,
          when: { logic: 'all', conditions: [{ field: 'call_result', op: 'equals', value: 'completed' }] },
          positive: { logic: 'all', conditions: [{ field: 'escalate_to', op: 'equals', value: 'none' }] },
          negative: { logic: 'any', conditions: [{ field: 'escalate_to', op: 'in', value: 'buyer, quality' }] },
        },
      ],
      campaign_goals: [
        {
          id: 'cmp_demand_100k',
          name: 'Packaging demand fulfilled (100k)',
          kind: 'target',
          enabled: true,
          aggregation: 'sum',
          field: 'rows[].committed_qty',
          unit: 'units',
          group_by: 'caller_name',
          target: 100000,
          positive_op: 'gte',
          positive_value: 100000,
          negative_op: 'lt',
          negative_value: 25000,
          conditional: true,
          filter: { logic: 'all', conditions: [{ field: 'call_result', op: 'equals', value: 'completed' }] },
        },
        {
          id: 'cmp_max_commitment',
          name: 'Max commitment received from',
          kind: 'extrema',
          enabled: true,
          aggregation: 'max',
          field: 'rows[].committed_qty',
          unit: 'units',
          group_by: 'caller_name',
          target: 10000,
          positive_op: 'gte',
          positive_value: 10000,
          negative_op: 'lte',
          negative_value: 0,
          conditional: true,
          filter: { logic: 'all', conditions: [{ field: 'call_result', op: 'equals', value: 'completed' }] },
        },
      ],
    };
  }
  const first = outputs.find((v) => v?.key && v.key !== 'agent_goal')?.key || 'status';
  return {
    call_rollup: 'all_positive',
    call_goals: [
      {
        id: 'cg_primary',
        name: 'Primary call objective',
        enabled: true,
        conditional: false,
        when: { logic: 'all', conditions: [] },
        positive: { logic: 'all', conditions: [{ field: first, op: 'is_not_empty', value: '' }] },
        negative: { logic: 'any', conditions: [{ field: first, op: 'in', value: 'rejected, refused, false' }] },
      },
    ],
    campaign_goals: [
      {
        id: 'cmp_rate',
        name: 'Positive call conversion rate',
        kind: 'target',
        enabled: true,
        aggregation: 'percent',
        field: '__call_goal_positive__',
        unit: '%',
        group_by: 'caller_name',
        target: 70,
        positive_op: 'gte',
        positive_value: 70,
        negative_op: 'lt',
        negative_value: 30,
        conditional: false,
        filter: { logic: 'all', conditions: [] },
      },
    ],
  };
}

// ── Browser-side mirror evaluator (used for live dry-run simulation inside Goals Modal) ──

const isPresent = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';
const normStr = (v: unknown) => String(v ?? '').trim().toLowerCase();
const splitList = (expected: unknown): string[] =>
  Array.isArray(expected)
    ? expected.map(normStr).filter(Boolean)
    : String(expected ?? '')
        .split(/[,;\n]/)
        .map(normStr)
        .filter(Boolean);

export function parseLotsQty(lotsStr: unknown): number {
  if (!lotsStr) return 0;
  return String(lotsStr)
    .split(/[;,\n]/)
    .reduce((sum, part) => {
      const m = /^\s*([\d.]+)\s*@/.exec(part);
      return sum + (m ? Number(m[1]) || 0 : 0);
    }, 0);
}

export function rowCommittedQty(row: Record<string, any>): number {
  if (!row || typeof row !== 'object') return 0;
  return (
    (Number(row['committed_qty']) || 0) +
    (Number(row['dispatched_qty']) || 0) +
    (Number(row['ready_qty']) || 0) +
    parseLotsQty(row['lots'])
  );
}

function resolveFieldValues(field: string, outputs: Record<string, any> = {}, inputs: Record<string, any> = {}) {
  const key = String(field || '').trim();
  if (!key) return { isList: false, values: [] as any[], scalar: undefined as any, sum: 0 };

  const listMatch = /^([a-zA-Z0-9_]+)\[\]\.([a-zA-Z0-9_]+)$/.exec(key);
  if (listMatch) {
    const [, listKey, subKey] = listMatch;
    const arr = Array.isArray(outputs?.[listKey]) ? outputs[listKey] : [];
    const values =
      subKey === 'committed_qty'
        ? arr.map((r: any) => rowCommittedQty(r))
        : arr.map((r: any) => r?.[subKey]).filter((v: any) => v !== undefined);
    const sum = values.reduce((acc: number, v: any) => acc + (Number(v) || 0), 0);
    return { isList: true, values, scalar: values[0], sum };
  }

  let scalar = outputs && key in outputs ? outputs[key] : undefined;
  if (scalar === undefined && inputs && key in inputs) scalar = inputs[key];
  if (Array.isArray(scalar)) {
    const sum = scalar.reduce((acc: number, v: any) => acc + (Number(v) || 0), 0);
    return { isList: true, values: scalar, scalar: scalar[0], sum };
  }
  const num = Number(scalar);
  return { isList: false, values: scalar !== undefined ? [scalar] : [], scalar, sum: Number.isFinite(num) ? num : 0 };
}

function compareScalar(actual: unknown, op: string, expected: unknown): boolean {
  const actStr = normStr(actual);
  const expStr = normStr(expected);
  const expList = splitList(expected);
  const actNum = Number(actual);
  const expNum = Number(expected);

  switch (op) {
    case 'equals': return actStr !== '' && actStr === expStr;
    case 'not_equals': return actStr !== expStr;
    case 'in': return actStr !== '' && expList.includes(actStr);
    case 'not_in': return actStr === '' ? false : !expList.includes(actStr);
    case 'contains': return actStr !== '' && expStr !== '' && actStr.includes(expStr);
    case 'is_not_empty': return isPresent(actual);
    case 'is_empty': return !isPresent(actual);
    case 'gt': return isPresent(actual) && Number.isFinite(actNum) && Number.isFinite(expNum) && actNum > expNum;
    case 'gte': return isPresent(actual) && Number.isFinite(actNum) && Number.isFinite(expNum) && actNum >= expNum;
    case 'lt': return isPresent(actual) && Number.isFinite(actNum) && Number.isFinite(expNum) && actNum < expNum;
    case 'lte': return isPresent(actual) && Number.isFinite(actNum) && Number.isFinite(expNum) && actNum <= expNum;
    default: return false;
  }
}

function evalCondition(cond: GoalCondition, outputs: Record<string, any>, inputs: Record<string, any>, bucket: string): ConditionTrace {
  const op = cond.op || 'equals';
  const expected = cond.value ?? '';
  const resolved = resolveFieldValues(cond.field, outputs, inputs);
  let passed = false;

  if (resolved.isList) {
    const presentVals = resolved.values.filter(isPresent);
    if (op === 'is_empty') passed = presentVals.length === 0;
    else if (op === 'is_not_empty') passed = presentVals.length > 0;
    else if (op === 'all_in') {
      const expList = splitList(expected);
      passed = presentVals.length > 0 && presentVals.every((v) => expList.includes(normStr(v)));
    } else if (op === 'not_in' || op === 'not_equals') {
      passed = presentVals.length > 0 && presentVals.every((v) => compareScalar(v, op, expected));
    } else if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
      const expNum = Number(expected);
      passed = presentVals.length > 0 && Number.isFinite(expNum) && compareScalar(resolved.sum, op, expNum);
    } else {
      passed = presentVals.some((v) => compareScalar(v, op, expected));
    }
  } else {
    passed = compareScalar(resolved.scalar, op, expected);
  }

  const actual = !resolved.isList
    ? (isPresent(resolved.scalar) ? String(resolved.scalar) : '—')
    : (resolved.values.filter(isPresent).length
        ? resolved.values.filter(isPresent).every((v) => typeof v === 'number')
          ? `${resolved.sum.toLocaleString('en-US')} total`
          : [...new Set(resolved.values.filter(isPresent).map(String))].slice(0, 3).join(', ')
        : '0 items');

  return { bucket, field: cond.field, op, expected: String(expected), actual, passed };
}

function evalGroup(group: ConditionGroup | undefined, outputs: Record<string, any>, inputs: Record<string, any>, bucket: string) {
  const list = (group?.conditions || []).filter((c) => c?.field);
  if (!list.length) return { passed: false, traces: [] as ConditionTrace[] };
  const traces = list.map((c) => evalCondition(c, outputs, inputs, bucket));
  const passed = group?.logic === 'any' ? traces.some((t) => t.passed) : traces.every((t) => t.passed);
  return { passed, traces };
}

export function evaluateCallGoals(goalConfig: GoalConfig, outputs: Record<string, any> = {}, inputs: Record<string, any> = {}): CallGoalEvaluation {
  const rules = (goalConfig?.call_goals || []).filter((g) => g.enabled !== false);
  const rollup: CallRollupMode = goalConfig?.call_rollup || 'all_positive';
  const goals: CallGoalEvalItem[] = [];

  for (const g of rules) {
    if (g.conditional && g.when?.conditions?.some((c) => c.field)) {
      const whenRes = evalGroup(g.when, outputs, inputs, 'when');
      if (!whenRes.passed) {
        goals.push({ id: g.id, name: g.name, outcome: 'skipped', reason: 'Activation condition not met', traces: whenRes.traces });
        continue;
      }
    }
    const pos = evalGroup(g.positive, outputs, inputs, 'positive');
    const neg = evalGroup(g.negative, outputs, inputs, 'negative');
    const outcome: GoalOutcome = pos.passed && !neg.passed ? 'positive' : neg.passed && !pos.passed ? 'negative' : 'partial';
    goals.push({ id: g.id, name: g.name, outcome, traces: [...pos.traces, ...neg.traces] });
  }

  const active = goals.filter((g) => g.outcome !== 'skipped');
  const counts = {
    positive: active.filter((g) => g.outcome === 'positive').length,
    partial: active.filter((g) => g.outcome === 'partial').length,
    negative: active.filter((g) => g.outcome === 'negative').length,
    skipped: goals.filter((g) => g.outcome === 'skipped').length,
  };

  let overall: 'positive' | 'negative' | 'partial' | null = null;
  if (active.length) {
    if (rollup === 'any_positive') {
      overall = counts.positive > 0 && counts.negative === 0 ? 'positive' : counts.negative > 0 && counts.positive === 0 ? 'negative' : 'partial';
    } else if (rollup === 'majority') {
      overall = counts.positive > active.length / 2 ? 'positive' : counts.negative > active.length / 2 ? 'negative' : 'partial';
    } else {
      overall = counts.positive === active.length ? 'positive' : counts.negative > 0 && counts.positive === 0 ? 'negative' : 'partial';
    }
  }

  return { overall, rollup, counts, goals };
}

function compareNum(actual: number, op: NumCompareOp, expected: number): boolean {
  switch (op) {
    case 'gte': return actual >= expected;
    case 'gt': return actual > expected;
    case 'lte': return actual <= expected;
    case 'lt': return actual < expected;
    case 'equals': return actual === expected;
    default: return false;
  }
}

export function evaluateCampaignGoals(
  goalConfig: GoalConfig,
  callRecords: { call_id?: string | null; caller_name?: string; phone?: string; answered: boolean; outputs?: Record<string, any>; inputs?: Record<string, any>; call_goal_outcome?: string | null }[],
): CampaignGoalEvaluation[] {
  const rules = (goalConfig?.campaign_goals || []).filter((g) => g.enabled !== false);
  const answered = callRecords.filter((c) => c.answered);

  return rules.map((g) => {
    const hasFilter = g.conditional && g.filter?.conditions?.some((c) => c.field);
    const matching = answered.filter((c) => {
      if (g.field !== '__call_goal_positive__' && (!c.outputs || !Object.keys(c.outputs).length)) return false;
      if (!hasFilter) return true;
      return evalGroup(g.filter, c.outputs || {}, c.inputs || {}, 'when').passed;
    });

    const contribMap = new Map<string, ContributorStat>();
    let totalSum = 0;
    let nonZero = 0;

    for (const c of matching) {
      const val =
        g.field === '__call_goal_positive__'
          ? c.call_goal_outcome === 'positive' ? 1 : 0
          : (() => {
              const r = resolveFieldValues(g.field, c.outputs || {}, c.inputs || {});
              return r.isList ? r.sum : Number(r.scalar) || 0;
            })();
      totalSum += val;
      if (val > 0) nonZero += 1;

      const gk = g.group_by || 'caller_name';
      const name = String(
        (gk === 'caller_name' ? c.caller_name : c.inputs?.[gk] ?? c.outputs?.[gk]) || c.caller_name || c.phone || 'Unknown',
      );
      const prev = contribMap.get(name) || { name, phone: c.phone || '', value: 0, calls: 0, call_id: c.call_id || null };
      prev.value += val;
      prev.calls += 1;
      contribMap.set(name, prev);
    }

    const contribs = [...contribMap.values()];
    const agg = g.aggregation || 'sum';
    let current = 0;
    if (agg === 'sum') current = totalSum;
    else if (agg === 'count') current = nonZero;
    else if (agg === 'percent') current = matching.length ? Math.round((1000 * totalSum) / matching.length) / 10 : 0;
    else if (agg === 'avg') current = matching.length ? Math.round((10 * totalSum) / matching.length) / 10 : 0;
    else if (agg === 'max') current = contribs.length ? Math.max(...contribs.map((x) => x.value)) : 0;
    else if (agg === 'min') {
      const pos = contribs.filter((x) => x.value > 0);
      current = pos.length ? Math.min(...pos.map((x) => x.value)) : contribs.length ? Math.min(...contribs.map((x) => x.value)) : 0;
    }

    const sorted = [...contribs].sort((a, b) => (agg === 'min' ? a.value - b.value : b.value - a.value));
    const target = Number(g.target) || 0;
    const posHit = compareNum(current, g.positive_op || 'gte', g.positive_value ?? target);
    const negHit = compareNum(current, g.negative_op || 'lt', g.negative_value ?? 0);
    const outcome: 'positive' | 'negative' | 'partial' = !matching.length ? 'partial' : posHit && !negHit ? 'positive' : negHit && !posHit ? 'negative' : 'partial';

    return {
      id: g.id,
      name: g.name,
      kind: g.kind || 'target',
      aggregation: agg,
      field: g.field,
      unit: g.unit || '',
      group_by: g.group_by || 'caller_name',
      target,
      current_value: current,
      progress_pct: target > 0 ? Math.min(100, Math.round((1000 * current) / target) / 10) : null,
      matched_calls: matching.length,
      outcome,
      leader: sorted[0] || null,
      top_contributors: sorted.slice(0, 5),
      thresholds: {
        positive_op: g.positive_op || 'gte',
        positive_value: g.positive_value ?? target,
        negative_op: g.negative_op || 'lt',
        negative_value: g.negative_value ?? 0,
      },
    };
  });
}
