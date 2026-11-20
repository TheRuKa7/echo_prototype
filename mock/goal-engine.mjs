// Shared deterministic goal evaluation engine for Echo backend & demo service worker.
// Evaluates both Call-level goals (conditional + multi-condition Positive/Negative -> Partial)
// and Campaign-level cumulative goals (SUM/COUNT/PERCENT/AVG/MAX/MIN + top contributors).

const isPresent = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const normStr = (v) => String(v ?? '').trim().toLowerCase();

const splitList = (expected) =>
  Array.isArray(expected)
    ? expected.map(normStr).filter(Boolean)
    : String(expected ?? '')
        .split(/[,;\n]/)
        .map(normStr)
        .filter(Boolean);

/** Parse "600@2026-11-23; 600@2026-11-27" into total quantity (1200). */
export function parseLotsQty(lotsStr) {
  if (!lotsStr) return 0;
  return String(lotsStr)
    .split(/[;,\n]/)
    .reduce((sum, part) => {
      const m = /^\s*([\d.]+)\s*@/.exec(part);
      return sum + (m ? Number(m[1]) || 0 : 0);
    }, 0);
}

/** Total committed units on one row entry: explicit committed_qty, dispatched_qty, ready_qty, plus lots@date. */
export function rowCommittedQty(row) {
  if (!row || typeof row !== 'object') return 0;
  return (
    (Number(row.committed_qty) || 0) +
    (Number(row.dispatched_qty) || 0) +
    (Number(row.ready_qty) || 0) +
    parseLotsQty(row.lots)
  );
}

/** Resolve scalar output/input fields or list sub-fields like "rows[].dispatch_status" / "rows[].committed_qty". */
export function resolveFieldValues(field, outputs = {}, inputs = {}) {
  const key = String(field || '').trim();
  if (!key) return { isList: false, values: [], scalar: undefined, sum: 0 };

  const listMatch = /^([a-zA-Z0-9_]+)\[\]\.([a-zA-Z0-9_]+)$/.exec(key);
  if (listMatch) {
    const [, listKey, subKey] = listMatch;
    const arr = Array.isArray(outputs?.[listKey]) ? outputs[listKey] : [];
    const values =
      subKey === 'committed_qty'
        ? arr.map((r) => rowCommittedQty(r))
        : arr.map((r) => r?.[subKey]).filter((v) => v !== undefined);
    const sum = values.reduce((acc, v) => acc + (Number(v) || 0), 0);
    return { isList: true, values, scalar: values[0], sum };
  }

  let scalar = outputs && key in outputs ? outputs[key] : undefined;
  if (scalar === undefined && inputs && key in inputs) scalar = inputs[key];
  if (Array.isArray(scalar)) {
    const sum = scalar.reduce((acc, v) => acc + (Number(v) || 0), 0);
    return { isList: true, values: scalar, scalar: scalar[0], sum };
  }
  const num = Number(scalar);
  return {
    isList: false,
    values: scalar !== undefined ? [scalar] : [],
    scalar,
    sum: Number.isFinite(num) ? num : 0,
  };
}

function compareScalar(actual, op, expected) {
  const actStr = normStr(actual);
  const expStr = normStr(expected);
  const expList = splitList(expected);
  const actNum = Number(actual);
  const expNum = Number(expected);

  switch (op) {
    case 'equals':
      return actStr !== '' && actStr === expStr;
    case 'not_equals':
      return actStr !== expStr;
    case 'in':
    case 'all_in':
      return actStr !== '' && expList.includes(actStr);
    case 'not_in':
      return actStr === '' ? false : !expList.includes(actStr);
    case 'contains':
      return actStr !== '' && expStr !== '' && actStr.includes(expStr);
    case 'is_not_empty':
      return isPresent(actual);
    case 'is_empty':
      return !isPresent(actual);
    case 'gt':
      return isPresent(actual) && isPresent(expected) && Number.isFinite(actNum) && Number.isFinite(expNum) && actNum > expNum;
    case 'gte':
      return isPresent(actual) && isPresent(expected) && Number.isFinite(actNum) && Number.isFinite(expNum) && actNum >= expNum;
    case 'lt':
      return isPresent(actual) && isPresent(expected) && Number.isFinite(actNum) && Number.isFinite(expNum) && actNum < expNum;
    case 'lte':
      return isPresent(actual) && isPresent(expected) && Number.isFinite(actNum) && Number.isFinite(expNum) && actNum <= expNum;
    default:
      return false;
  }
}

function formatActual(resolved) {
  if (!resolved.isList) {
    return isPresent(resolved.scalar) ? String(resolved.scalar) : '—';
  }
  const vals = resolved.values.filter(isPresent);
  if (!vals.length) return '0 items';
  const nums = vals.every((v) => typeof v === 'number');
  if (nums) return `${resolved.sum.toLocaleString('en-US')} total (${vals.length} rows)`;
  const uniq = [...new Set(vals.map((v) => String(v)))];
  return uniq.slice(0, 3).join(', ') + (uniq.length > 3 ? ` +${uniq.length - 3}` : '');
}

export function evalCondition(cond, outputs = {}, inputs = {}, bucket = '') {
  const op = cond?.op || 'equals';
  const expected = cond?.value ?? '';
  const resolved = resolveFieldValues(cond?.field, outputs, inputs);
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
      passed = presentVals.length > 0 && isPresent(expected) && Number.isFinite(expNum) && compareScalar(resolved.sum, op, expNum);
    } else {
      passed = presentVals.some((v) => compareScalar(v, op, expected));
    }
  } else {
    passed = compareScalar(resolved.scalar, op, expected);
  }

  return {
    bucket,
    field: String(cond?.field || ''),
    op,
    expected: String(expected),
    actual: formatActual(resolved),
    passed,
  };
}

export function evalGroup(group, outputs = {}, inputs = {}, bucket = '') {
  const list = Array.isArray(group?.conditions) ? group.conditions.filter((c) => c?.field) : [];
  if (!list.length) return { passed: false, traces: [] };
  const traces = list.map((c) => evalCondition(c, outputs, inputs, bucket));
  const passed = group?.logic === 'any' ? traces.some((t) => t.passed) : traces.every((t) => t.passed);
  return { passed, traces };
}

/**
 * Evaluate all enabled Call-level goals against one call's extracted outputs + sheet inputs.
 * Truth table per active goal:
 *   Positive && !Negative => 'positive'
 *   Negative && !Positive => 'negative'
 *   Otherwise (neither or both) => 'partial'
 */
export function evaluateCallGoals(goalConfig, outputs = {}, inputs = {}) {
  const rules = (goalConfig?.call_goals || []).filter((g) => g && g.enabled !== false);
  const rollup = goalConfig?.call_rollup || 'all_positive';
  const goals = [];

  for (const g of rules) {
    if (g.conditional && g.when?.conditions?.some((c) => c?.field)) {
      const whenRes = evalGroup(g.when, outputs, inputs, 'when');
      if (!whenRes.passed) {
        goals.push({
          id: g.id,
          name: g.name || 'Unnamed goal',
          outcome: 'skipped',
          reason: 'Activation condition not met',
          traces: whenRes.traces,
        });
        continue;
      }
    }
    const pos = evalGroup(g.positive, outputs, inputs, 'positive');
    const neg = evalGroup(g.negative, outputs, inputs, 'negative');
    const outcome =
      pos.passed && !neg.passed
        ? 'positive'
        : neg.passed && !pos.passed
          ? 'negative'
          : 'partial';
    goals.push({
      id: g.id,
      name: g.name || 'Unnamed goal',
      outcome,
      traces: [...pos.traces, ...neg.traces],
    });
  }

  const active = goals.filter((g) => g.outcome !== 'skipped');
  const counts = {
    positive: active.filter((g) => g.outcome === 'positive').length,
    partial: active.filter((g) => g.outcome === 'partial').length,
    negative: active.filter((g) => g.outcome === 'negative').length,
    skipped: goals.filter((g) => g.outcome === 'skipped').length,
  };

  let overall = null;
  if (active.length) {
    if (rollup === 'any_positive') {
      overall =
        counts.positive > 0 && counts.negative === 0
          ? 'positive'
          : counts.negative > 0 && counts.positive === 0
            ? 'negative'
            : 'partial';
    } else if (rollup === 'majority') {
      overall =
        counts.positive > active.length / 2
          ? 'positive'
          : counts.negative > active.length / 2
            ? 'negative'
            : 'partial';
    } else {
      overall =
        counts.positive === active.length
          ? 'positive'
          : counts.negative > 0 && counts.positive === 0
            ? 'negative'
            : 'partial';
    }
  }

  return { overall, rollup, counts, goals };
}

function compareNum(actual, op, expected) {
  const a = Number(actual);
  const b = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  switch (op) {
    case 'gte':
      return a >= b;
    case 'gt':
      return a > b;
    case 'lte':
      return a <= b;
    case 'lt':
      return a < b;
    case 'equals':
      return a === b;
    default:
      return false;
  }
}

function callNumericValue(field, record) {
  if (field === '__call_goal_positive__') {
    return record?.call_goal_outcome === 'positive' ? 1 : 0;
  }
  const res = resolveFieldValues(field, record?.outputs || {}, record?.inputs || {});
  if (res.isList) return res.sum;
  const n = Number(res.scalar);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Evaluate cumulative Campaign-level goals across an array of call records:
 * callRecords: [{ call_id, caller_name, phone, answered, outputs, inputs, call_goal_outcome }]
 */
export function evaluateCampaignGoals(goalConfig, callRecords = []) {
  const rules = (goalConfig?.campaign_goals || []).filter((g) => g && g.enabled !== false);
  const answeredWithData = callRecords.filter((c) => c && c.answered);

  return rules.map((g) => {
    const hasFilter = g.conditional && g.filter?.conditions?.some((c) => c?.field);
    const matching = answeredWithData.filter((c) => {
      if (g.field !== '__call_goal_positive__' && (!c.outputs || !Object.keys(c.outputs).length)) {
        return false;
      }
      if (!hasFilter) return true;
      return evalGroup(g.filter, c.outputs || {}, c.inputs || {}, 'when').passed;
    });

    const contribMap = new Map();
    let totalSum = 0;
    let nonZeroCount = 0;

    for (const c of matching) {
      const val = callNumericValue(g.field, c);
      totalSum += val;
      if (val > 0) nonZeroCount += 1;

      const groupKey = g.group_by || 'caller_name';
      const rawName =
        (groupKey === 'caller_name' ? c.caller_name : c.inputs?.[groupKey] ?? c.outputs?.[groupKey]) ||
        c.caller_name ||
        c.phone ||
        'Unknown';
      const name = String(rawName);
      const prev = contribMap.get(name) || { name, phone: c.phone || '', value: 0, calls: 0, call_id: c.call_id || null };
      prev.value += val;
      prev.calls += 1;
      if (!prev.call_id && c.call_id) prev.call_id = c.call_id;
      contribMap.set(name, prev);
    }

    const contribs = [...contribMap.values()];
    const agg = g.aggregation || 'sum';
    let current = 0;
    if (agg === 'sum') current = totalSum;
    else if (agg === 'count') current = nonZeroCount;
    else if (agg === 'percent') {
      current = matching.length
        ? (g.field === '__call_goal_positive__' ? Math.round((1000 * totalSum) / matching.length) / 10 : Math.round((1000 * nonZeroCount) / matching.length) / 10)
        : 0;
    } else if (agg === 'avg') current = matching.length ? Math.round((10 * totalSum) / matching.length) / 10 : 0;
    else if (agg === 'max') current = contribs.length ? Math.max(...contribs.map((x) => x.value)) : 0;
    else if (agg === 'min') {
      const positiveContribs = contribs.filter((x) => x.value > 0);
      current = positiveContribs.length
        ? Math.min(...positiveContribs.map((x) => x.value))
        : contribs.length
          ? Math.min(...contribs.map((x) => x.value))
          : 0;
    }

    const sorted = [...contribs].sort((a, b) => (agg === 'min' ? a.value - b.value : b.value - a.value));
    const leader = sorted[0] || null;
    const target = Number(g.target) || 0;
    const progressPct = target > 0 ? Math.min(100, Math.round((1000 * current) / target) / 10) : null;

    const posHit = compareNum(current, g.positive_op || 'gte', g.positive_value ?? target);
    const negHit = compareNum(current, g.negative_op || 'lt', g.negative_value ?? 0);
    const outcome =
      !matching.length
        ? 'partial'
        : posHit && !negHit
          ? 'positive'
          : negHit && !posHit
            ? 'negative'
            : 'partial';

    return {
      id: g.id,
      name: g.name || 'Campaign goal',
      kind: g.kind || 'target',
      aggregation: agg,
      field: g.field || '',
      unit: g.unit || '',
      group_by: g.group_by || 'caller_name',
      target,
      current_value: current,
      progress_pct: progressPct,
      matched_calls: matching.length,
      outcome,
      leader,
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

/** Deterministic default goals tailored to each agent's extracted output variables. */
export function defaultGoalConfig(agent) {
  const outs = agent?.output_variables || [];
  const keys = new Set(outs.map((v) => v.key));

  // PI Packaging & grouped PO-row follow-up agents
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
          when: {
            logic: 'all',
            conditions: [{ field: 'call_result', op: 'equals', value: 'completed' }],
          },
          positive: {
            logic: 'all',
            conditions: [{ field: 'escalate_to', op: 'equals', value: 'none' }],
          },
          negative: {
            logic: 'any',
            conditions: [{ field: 'escalate_to', op: 'in', value: 'buyer, quality' }],
          },
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
          filter: {
            logic: 'all',
            conditions: [{ field: 'call_result', op: 'equals', value: 'completed' }],
          },
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
          filter: {
            logic: 'all',
            conditions: [{ field: 'call_result', op: 'equals', value: 'completed' }],
          },
        },
      ],
    };
  }

  // Post-PO Acceptance agents (Saniya, Sarah, etc.)
  if (keys.has('po_acceptance_intent')) {
    return {
      call_rollup: 'all_positive',
      call_goals: [
        {
          id: 'cg_po_acc',
          name: 'PO acceptance & dispatch date',
          enabled: true,
          conditional: false,
          when: { logic: 'all', conditions: [] },
          positive: {
            logic: 'all',
            conditions: [
              { field: 'po_acceptance_intent', op: 'in', value: 'ACCEPTED, WILL_ACCEPT' },
              { field: 'eta_confirmation_received', op: 'equals', value: 'true' },
            ],
          },
          negative: {
            logic: 'any',
            conditions: [
              { field: 'po_acceptance_intent', op: 'equals', value: 'REJECTED' },
              { field: 'status', op: 'equals', value: 'PO Rejected' },
            ],
          },
        },
        {
          id: 'cg_po_count',
          name: 'Accepted PO count confirmed',
          enabled: true,
          conditional: true,
          when: {
            logic: 'all',
            conditions: [{ field: 'po_acceptance_intent', op: 'in', value: 'ACCEPTED, WILL_ACCEPT' }],
          },
          positive: {
            logic: 'all',
            conditions: [{ field: 'accepted_po_count', op: 'gte', value: '1' }],
          },
          negative: {
            logic: 'any',
            conditions: [{ field: 'accepted_po_count', op: 'lte', value: '0' }],
          },
        },
      ],
      campaign_goals: [
        {
          id: 'cmp_po_total',
          name: 'Cumulative accepted POs target',
          kind: 'target',
          enabled: true,
          aggregation: 'sum',
          field: 'accepted_po_count',
          unit: 'POs',
          group_by: 'caller_name',
          target: 25,
          positive_op: 'gte',
          positive_value: 25,
          negative_op: 'lt',
          negative_value: 8,
          conditional: true,
          filter: {
            logic: 'all',
            conditions: [{ field: 'po_acceptance_intent', op: 'in', value: 'ACCEPTED, WILL_ACCEPT' }],
          },
        },
        {
          id: 'cmp_po_max',
          name: 'Max accepted POs received from',
          kind: 'extrema',
          enabled: true,
          aggregation: 'max',
          field: 'accepted_po_count',
          unit: 'POs',
          group_by: 'caller_name',
          target: 3,
          positive_op: 'gte',
          positive_value: 3,
          negative_op: 'lte',
          negative_value: 0,
          conditional: false,
          filter: { logic: 'all', conditions: [] },
        },
      ],
    };
  }

  // Generic RFX / other agents
  const primaryField = outs.find((v) => v.type === 'boolean' || v.type === 'enum')?.key || outs[0]?.key || 'status';
  const primaryType = outs.find((v) => v.key === primaryField)?.type;
  return {
    call_rollup: 'all_positive',
    call_goals: [
      {
        id: 'cg_primary',
        name: 'Primary call objective',
        enabled: true,
        conditional: false,
        when: { logic: 'all', conditions: [] },
        positive: {
          logic: 'all',
          conditions: [
            primaryType === 'boolean'
              ? { field: primaryField, op: 'equals', value: 'true' }
              : { field: primaryField, op: 'is_not_empty', value: '' },
          ],
        },
        negative: {
          logic: 'any',
          conditions: [{ field: primaryField, op: 'in', value: 'not_reached, rejected, false' }],
        },
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
