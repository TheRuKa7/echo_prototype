export interface ToolKV {
  key: string;
  value: string;
}

export type FunctionFieldType =
  | 'string'
  | 'object'
  | 'number'
  | 'boolean'
  | 'array_string'
  | 'array_object'
  | 'array_number'
  | 'array_boolean';

export interface FunctionInputField {
  name: string;
  type: FunctionFieldType;
  description: string;
  required: boolean;
}

export interface OutputVarMapping {
  path: string;
  variable: string;
}

export interface ToolFunctionConfig {
  id: string;
  kind: 'builtin' | 'custom';
  builtin_type?: 'end_call' | 'transfer_call' | 'get_current_datetime';
  name: string;
  description: string;
  sip_headers?: ToolKV[];
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  timeout_s?: number;
  max_retries?: number;
  headers?: ToolKV[];
  query_params?: ToolKV[];
  input_mode?: 'form' | 'json';
  payload_args_only?: boolean;
  input_fields?: FunctionInputField[];
  input_json?: string;
  output_mappings?: OutputVarMapping[];
  execution_mode?: 'wait' | 'async';
  talk_while_waiting?: boolean;
  play_typing_sound?: boolean;
}

export interface CodeToolConfig {
  id: string;
  name: string;
  description: string;
  code: string;
  timeout_s: number;
  execution_mode: 'wait' | 'async';
  talk_while_waiting: boolean;
  play_typing_sound: boolean;
  store_fields: OutputVarMapping[];
}

export interface AgentWebhookConfig {
  url: string;
  timeout_s: number;
  events: string[];
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  timeout_ms: number;
  headers: ToolKV[];
  query_params: ToolKV[];
}

export const WEBHOOK_EVENTS: { key: string; label: string }[] = [
  { key: 'call_started', label: 'Call started' },
  { key: 'call_ended', label: 'Call ended' },
  { key: 'call_analyzed', label: 'Call analyzed' },
  { key: 'transcript_updated', label: 'Transcript updated' },
  { key: 'transfer_started', label: 'Transfer started' },
  { key: 'transfer_bridged', label: 'Transfer bridged' },
  { key: 'transfer_cancelled', label: 'Transfer cancelled' },
  { key: 'transfer_ended', label: 'Transfer ended' },
];

export const FUNCTION_PRIMITIVE_TYPES: { key: FunctionFieldType; label: string; glyph: string }[] = [
  { key: 'string', label: 'String', glyph: 'T' },
  { key: 'object', label: 'Object', glyph: '{}' },
  { key: 'number', label: 'Number', glyph: '#' },
  { key: 'boolean', label: 'Boolean', glyph: '◐' },
];

export const FUNCTION_ARRAY_TYPES: { key: FunctionFieldType; label: string; glyph: string }[] = [
  { key: 'array_string', label: 'String[]', glyph: '[T]' },
  { key: 'array_object', label: 'Object[]', glyph: '[{}]' },
  { key: 'array_number', label: 'Number[]', glyph: '[#]' },
  { key: 'array_boolean', label: 'Boolean[]', glyph: '[◐]' },
];

export const HTTP_METHODS: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[] = [
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE',
];

export const FUNCTION_JSON_EXAMPLES: { id: string; label: string; json: string }[] = [
  {
    id: 'ex1',
    label: 'example 1',
    json: JSON.stringify({
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Customer email address such as {{contact_email}}.',
        },
      },
      required: ['email'],
    }, null, 2),
  },
  {
    id: 'ex2',
    label: 'example 2',
    json: JSON.stringify({
      type: 'object',
      properties: {
        po_number: {
          type: 'string',
          description: 'Purchase order number on the call.',
        },
        confirmed_qty: {
          type: 'number',
          description: 'Confirmed ready dispatch quantity.',
        },
        dispatch_date: {
          type: 'string',
          description: 'Promised dispatch date (YYYY-MM-DD).',
        },
      },
      required: ['po_number', 'confirmed_qty'],
    }, null, 2),
  },
  {
    id: 'ex3',
    label: 'example 3',
    json: JSON.stringify({
      type: 'object',
      properties: {
        appointment_available_ts: {
          type: 'string',
          description: 'The timestamp of the appointment that is available for booking.',
        },
        doctor_name: {
          type: 'string',
          description: 'An optional field to specify the name of the doctor.',
        },
      },
      required: ['appointment_available_ts'],
    }, null, 2),
  },
];

export const STARTER_CODE_JS = `// Write JavaScript to run.
// Available globals:
//   dv.<name>    - read dynamic variables (e.g. dv.supplier_name)
//                  names with spaces: dv["user name"]
//   metadata     - metadata passed from the API
//   fetch(url)   - make HTTP requests
//   console.log()- log output (shown in Run results)
//
// Return a JSON object - use "Store Fields as Variables"
// to extract values into dynamic variables for later use.
//
// Example:
const res = await fetch("https://api.example.com/po/" + (dv.po_number || "PO-101"));
const data = await res.json();
console.log("Checked PO status for", dv.supplier_name);
return { result: data.status || "ready", dispatch_window: "48h" };`;

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function fieldsToJson(fields: FunctionInputField[] = []): string {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const f of fields) {
    const key = (f.name || '').trim();
    if (!key) continue;
    const isArr = f.type.startsWith('array_');
    const itemType = isArr ? f.type.replace('array_', '') : f.type;
    properties[key] = isArr
      ? { type: 'array', items: { type: itemType }, description: f.description || '' }
      : { type: itemType, description: f.description || '' };
    if (f.required) required.push(key);
  }
  return JSON.stringify({ type: 'object', properties, required }, null, 2);
}

export function jsonToFields(raw: string): FunctionInputField[] | null {
  try {
    const parsed = JSON.parse(raw || '{}');
    const props = parsed?.properties;
    if (!props || typeof props !== 'object') return [];
    const reqSet = new Set<string>(Array.isArray(parsed.required) ? parsed.required : []);
    return Object.entries(props).map(([name, cfg]: [string, any]) => {
      const base = cfg?.type === 'array' ? `array_${cfg?.items?.type || 'string'}` : (cfg?.type || 'string');
      const allowed: FunctionFieldType[] = ['string', 'object', 'number', 'boolean', 'array_string', 'array_object', 'array_number', 'array_boolean'];
      const type = (allowed.includes(base as FunctionFieldType) ? base : 'string') as FunctionFieldType;
      return {
        name,
        type,
        description: String(cfg?.description || ''),
        required: reqSet.has(name),
      };
    });
  } catch {
    return null;
  }
}

export function blankEndCallFn(): ToolFunctionConfig {
  return {
    id: uid('fn_end'),
    kind: 'builtin',
    builtin_type: 'end_call',
    name: 'end_call',
    description: 'End the call after the goodbye has been spoken, or on a clear voicemail/IVR before any person spoke.',
    sip_headers: [{ key: '', value: '' }],
    talk_while_waiting: false,
  };
}

export function blankCustomFn(): ToolFunctionConfig {
  const input_fields: FunctionInputField[] = [
    { name: 'field1', type: 'string', description: '', required: true },
  ];
  return {
    id: uid('fn_custom'),
    kind: 'custom',
    name: '',
    description: '',
    method: 'POST',
    url: '',
    timeout_s: 120,
    max_retries: 0,
    headers: [{ key: '', value: '' }],
    query_params: [{ key: '', value: '' }],
    input_mode: 'form',
    payload_args_only: false,
    input_fields,
    input_json: fieldsToJson(input_fields),
    output_mappings: [{ path: '', variable: '' }],
    execution_mode: 'wait',
    talk_while_waiting: true,
    play_typing_sound: false,
  };
}

export function blankCodeTool(): CodeToolConfig {
  return {
    id: uid('code'),
    name: '',
    description: '',
    code: STARTER_CODE_JS,
    timeout_s: 30,
    execution_mode: 'wait',
    talk_while_waiting: true,
    play_typing_sound: false,
    store_fields: [{ path: '', variable: '' }],
  };
}

export function blankWebhook(): AgentWebhookConfig {
  return {
    url: '',
    timeout_s: 5,
    events: ['call_started', 'call_ended', 'call_analyzed'],
  };
}

export function blankMcp(): McpServerConfig {
  return {
    id: uid('mcp'),
    name: '',
    url: '',
    timeout_ms: 10000,
    headers: [{ key: '', value: '' }],
    query_params: [{ key: '', value: '' }],
  };
}

export function defaultToolFunctions(): ToolFunctionConfig[] {
  const poFields: FunctionInputField[] = [
    { name: 'po_number', type: 'string', description: 'Purchase order reference such as {{po_number}}', required: true },
    { name: 'supplier_code', type: 'string', description: 'Supplier code from sheet row', required: false },
  ];
  return [
    {
      id: 'fn_builtin_end_call',
      kind: 'builtin',
      builtin_type: 'end_call',
      name: 'end_call',
      description: 'End the call after the goodbye has been spoken, or on a clear voicemail/IVR before any person spoke.',
      sip_headers: [{ key: '', value: '' }],
      talk_while_waiting: false,
    },
    {
      id: 'fn_custom_po_status',
      kind: 'custom',
      name: 'check_po_dispatch_status',
      description: 'Fetch latest dispatch gatepass & ASN status from ERP during the call before confirming balances.',
      method: 'POST',
      url: 'https://api.erp.example.com/v1/po/dispatch-status',
      timeout_s: 15,
      max_retries: 1,
      headers: [{ key: 'Authorization', value: 'Bearer {{erp_api_key}}' }],
      query_params: [{ key: 'org', value: '{{plant}}' }],
      input_mode: 'form',
      payload_args_only: false,
      input_fields: poFields,
      input_json: fieldsToJson(poFields),
      output_mappings: [{ path: 'data.asn_number', variable: 'asn_number' }],
      execution_mode: 'wait',
      talk_while_waiting: true,
      play_typing_sound: false,
    },
  ];
}

export function defaultCodeTools(): CodeToolConfig[] {
  return [
    {
      id: 'code_calc_eta',
      name: 'compute_dispatch_eta',
      description: 'Compute transit ETA days from promised plant & carrier SLA.',
      code: STARTER_CODE_JS,
      timeout_s: 30,
      execution_mode: 'wait',
      talk_while_waiting: true,
      play_typing_sound: false,
      store_fields: [{ path: 'dispatch_window', variable: 'dispatch_sla' }],
    },
  ];
}

export function defaultMcps(): McpServerConfig[] {
  return [
    {
      id: 'mcp_erp_orders',
      name: 'ERP Order MCP',
      url: 'https://mcp.erp.example.com/sse',
      timeout_ms: 10000,
      headers: [{ key: 'Authorization', value: 'Bearer {{mcp_token}}' }],
      query_params: [{ key: 'tenant', value: 'pi_industries' }],
    },
  ];
}
