import { Component, inject, signal, computed, OnInit, OnDestroy, HostListener } from '@angular/core';
import { NeedDirective } from '../../components/shared-screens/preview';
import { EchoLoaderComponent } from '../../components/echo-mark/echo-mark.component';
import { ActivatedRoute, Router } from '@angular/router';
import { EnginePanelComponent } from '../../components/engine-panel/engine-panel.component';
import { StatusPickerComponent } from '../../components/status-picker/status-picker.component';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';
import { ConfirmComponent } from '../../components/confirm/confirm.component';
import { PromptPreviewComponent } from './prompt-preview.component';
import { FieldEditModalComponent } from './field-edit-modal.component';
import { ToolModalsComponent, ToolModalMode } from './tool-modals.component';
import { GoalsModalComponent } from './goals-modal.component';
import { GoalConfig, defaultGoalConfigFromOutputs } from './goal-models';
import {
  AgentGuardrailsConfig, AgentPiiConfig, DEFAULT_GUARDRAILS, DEFAULT_PII_CATEGORIES,
  GuardrailsConfig, SafetyPrivacyModalsComponent,
} from '../../components/safety-privacy-modals/safety-privacy-modals.component';
import {
  AgentWebhookConfig, CodeToolConfig, McpServerConfig, ToolFunctionConfig,
  blankCodeTool, blankCustomFn, blankEndCallFn, blankMcp, blankWebhook,
  defaultCodeTools, defaultMcps, defaultToolFunctions,
} from './tool-models';
import { mergeFieldLines } from '../../utils/merge-fields';
import { toDoc, fromDoc } from '../../utils/prompt-doc';
import { fmtAgo } from '../../utils/format';
import { CALL_STATUSES, statusHover } from '../../utils/status';

const IN_COLS = '1.4fr 130px 130px 1.4fr 90px 36px';
const OUT_COLS = '1fr 1fr 110px 1.2fr 1.4fr 50px 36px';

const blankInput = (type = 'string') => ({ key: '', sample: '', type, transform: '', share_on_call: true, allow_empty: false });
const blankOutput = (type = 'string') => ({
  key: '', label: '', description: '', type,
  options: type === 'enum' ? [''] : [],
  fields: type === 'list' ? [{ key: '', type: 'string', options: [] }] : undefined,
  required: true, save_to_contact: false,
});
const blankSection = () => ({ id: '', title: '', body: '', kind: 'text', enabled: true });
const patch = (list: any[], i: number, changes: any) => list.map((r, idx) => (idx === i ? { ...r, ...changes } : r));
const move = (list: any[], from: number, to: number) => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

interface Settings { label: string; description: string; voice: string; ozonetel_campaign: string; primary_id_key: string; }
/** How rows of a file become calls (PRD-ECHO-19 section 4). */
interface SkipRule { column: string; op: string; value: string }
interface InputPlan { mode: 'row' | 'group'; group_by: string; call_columns: string[]; row_columns: string[]; order_by: string; order_dir: 'asc' | 'desc'; max_rows: number; overflow: 'split' | 'cap'; answers_key: string;
  /** How a row is said out loud, with {column} names. */ say_as?: string; max_minutes?: number; /** Columns that make a row the same row on the next upload. */ identity?: string[]; remember?: boolean;
  list_style?: 'one_by_one' | 'all_first'; check_in_after?: number; skip?: SkipRule[]; }
interface Engine {
  preset: string; mode: 's2s' | 'pipeline'; s2s: string; stt: string; llm: string; tts: string;
  fallback?: string; fallback_after_ms?: number; turn?: any;
  stt_fallback?: string; tts_fallback?: string; realtime_alt?: string; turn_detector?: string;
  voice?: string; language?: string; temperature?: number; max_tokens?: number; speed?: number;
}
/** Gemini Live / Vertex native-audio S2S only — STS mode does not offer cascade vendors. */
const STS_MODEL_RE = /gemini.*(live|native)|vertex/i;
const STS_METRICS: Record<string, { latency: string; cost: string; humanness: string; intelligence: string; accuracy: string }> = {
  'gemini-live-2.5-flash': {
    latency: 'About 0.5–0.8 s audio-to-audio (native)',
    cost: '~$0.035–0.07 / min (Vertex Live pricing varies by region)',
    humanness: 'Native audio; natural barge-in on Live',
    intelligence: 'Gemini 2.5 Flash Live reasoning',
    accuracy: 'Multilingual; follows caller language switches',
  },
  'gemini-3.8-live': {
    latency: 'About 0.4–0.7 s audio-to-audio (native)',
    cost: 'Vertex Gemini Live · see current list price',
    humanness: 'Gemini 3.8 Live native audio',
    intelligence: 'Stronger live reasoning than 2.5 Flash',
    accuracy: 'Multilingual India + global',
  },
  'gemini-3.8-live-thinking': {
    latency: 'About 0.7–1.2 s (extended thinking)',
    cost: 'Higher than Live base · thinking tokens billed',
    humanness: 'Same Live voices; longer think before speak',
    intelligence: 'Extended thinking for hard turns',
    accuracy: 'Best for disputes / multi-line calls',
  },
};
type WaitMode = 'static' | 'linear' | 'exponential';
interface WhatsappTrigger {
  id: string;
  when: 'completed' | 'callback_requested' | 'not_reached';
  label: string;
  enabled: boolean;
  template_name: string;
  body: string;
}
interface WhatsappConfig {
  enabled: boolean;
  provider: 'kaleyra';
  sid: string;
  sender_number: string;
  phone_field: string;
  delay_seconds: number;
  triggers: WhatsappTrigger[];
}
interface Rules {
  retry: { tries: number; retries?: number; mode?: WaitMode; gap_minutes: number; on: string[]; answer_field: string; answer_values: string[] };
  sync_target: { type: string; url: string };
  lookups: any[];
  tool_functions: ToolFunctionConfig[];
  code_tools: CodeToolConfig[];
  webhook: AgentWebhookConfig;
  mcps: McpServerConfig[];
  pii_config: AgentPiiConfig;
  guardrails: AgentGuardrailsConfig;
  goal_config: GoalConfig;
  engine: Engine;
  whatsapp: WhatsappConfig;
}
const blankPlan = (): InputPlan => ({ mode: 'row', group_by: '', call_columns: [], row_columns: [], order_by: '', order_dir: 'asc', max_rows: 8, overflow: 'split', answers_key: '', remember: true });
const blankWhatsapp = (): WhatsappConfig => ({
  enabled: true,
  provider: 'kaleyra',
  sid: 'HXIN1748290184IN',
  sender_number: '+91 80 4718 2290',
  phone_field: 'phone_number',
  delay_seconds: 0,
  triggers: [
    { id: 'wa_completed', when: 'completed', label: 'Call completed', enabled: true, template_name: 'pi_dispatch_confirmation_v2', body: 'Namaste {{supplier_name}}, thank you for speaking with PI Industries. Call outcome: {{call_result}}. {{detailed_remarks}}' },
    { id: 'wa_callback', when: 'callback_requested', label: 'Callback requested', enabled: true, template_name: 'pi_callback_slot_v1', body: 'Namaste {{supplier_name}}, as requested on our call, please reply here with your convenient callback time or ready dispatch dates.' },
    { id: 'wa_missed', when: 'not_reached', label: 'No answer / unreachable', enabled: false, template_name: 'pi_missed_call_followup_v1', body: 'Namaste {{supplier_name}}, we tried calling you regarding pending packaging PO dispatch schedule. Please reply with your dispatch plan.' },
  ],
});
const blankRules = (): Rules => ({
  retry: { tries: 3, retries: 2, mode: 'static', gap_minutes: 60, on: ['no_answer', 'busy', 'unreachable', 'network_error', 'call_dropped', 'no_reply', 'voicemail', 'caller_hung_up'], answer_field: '', answer_values: [] },
  sync_target: { type: 'none', url: '' },
  lookups: [],
  tool_functions: defaultToolFunctions(),
  code_tools: defaultCodeTools(),
  webhook: blankWebhook(),
  mcps: defaultMcps(),
  pii_config: { inherit: true, categories: [...DEFAULT_PII_CATEGORIES] },
  guardrails: { inherit: true, input: [...DEFAULT_GUARDRAILS.input], output: [...DEFAULT_GUARDRAILS.output] },
  goal_config: defaultGoalConfigFromOutputs([]),
  engine: { preset: 'natural', mode: 's2s', s2s: '', stt: '', llm: '', tts: '' },
  whatsapp: blankWhatsapp(),
});
const blankLookup = () => ({
  name: '', when: 'before', url: '', send: [] as string[], returns: '',
  timeout_s: 3, retry: 1, wait_line: 'One moment while I check.',
  fallback: 'Let me check and get back to you.',
});
type AgentNode = 'dial' | 'inputs' | 'knowledge' | 'tools' | 'prompt' | 'outputs' | 'results';
type FieldKind = 'input' | 'output';
type AgentPane = 'prompt' | 'settings';
interface ToolPolicy {
  timeout_s: number;
  wait_line: string;
  retry_lookups: number;
  tools: Record<string, { timeout_s: number; wait_line: string; retry: number }>;
}
const blankToolPolicy = (): ToolPolicy => ({
  timeout_s: 6, wait_line: 'One moment.', retry_lookups: 1, tools: {},
});
const TYPE_GLYPH: Record<string, string> = {
  string: 'T', number: '#', boolean: '◐', enum: '⋮≡', list: '≡', phone: '☎', date: 'D',
};

/**
 * Agent editor.
 *
 * Full-width workflow canvas opens focused edit modals for each node,
 * individual input/output extraction fields, and tool integrations
 * (Functions, Code Tools, Webhooks, and MCP servers).
 */
@Component({
  selector: 'app-agent-detail',
  standalone: true,
  imports: [NeedDirective, EchoLoaderComponent, FormsModule, EnginePanelComponent, StatusPickerComponent, IconComponent, PromptPreviewComponent, ConfirmComponent, FieldEditModalComponent, ToolModalsComponent, SafetyPrivacyModalsComponent, GoalsModalComponent],
  templateUrl: './agent-detail.component.html',
})
export class AgentDetailComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  key = '';
  IN_COLS = IN_COLS;
  OUT_COLS = OUT_COLS;
  /** Matches VOICE_AGENT_VOICE in the backend: what an empty selection resolves to. */
  DEFAULT_VOICE = 'Aoede';
  ago = fmtAgo;

  agent = signal<any>(null);
  meta = signal<any>(null);
  /** Workflow canvas highlight. */
  selectedNode = signal<AgentNode>('prompt');
  /** Active node editor modal (null by default — canvas stays clean). */
  activeModal = signal<AgentNode | null>(null);
  /** Individual field edit modal (Pre-call input or Post-call extraction). */
  editingField = signal<{ kind: FieldKind; index: number; field: any; isNew: boolean } | null>(null);
  /** Active tool integration modal (Built-in / Custom Function / Code / Webhook / MCP). */
  toolModal = signal<{ mode: Exclude<ToolModalMode, null>; index: number; value: any; isNew: boolean } | null>(null);
  toolAddMenu = signal(false);
  /** @deprecated kept as alias during template transition */
  tab = this.selectedNode;
  mode = signal<'blocks' | 'full'>(this.savedMode());
  /** Agent modal tab: Prompt | Settings. */
  agentPane = signal<AgentPane>('prompt');
  /** Accordion section open inside Agent → Settings. */
  accordion = signal<string>('goals');
  addMenu = signal<'input' | 'output' | null>(null);
  error = signal('');
  toast = signal('');
  busy = signal(false);
  /** What the agent is trying to achieve; reported on agent_goal after calls. */
  goals = signal<string[]>([]);
  /** Optional in-call tools (checkbox catalogue). */
  optionalTools = signal<string[]>([]);
  /** Timeouts, spoken wait line, lookup retries (ECH-149). */
  toolPolicy = signal<ToolPolicy>(blankToolPolicy());
  /** Draft vs published versions from /api/report/versions. */
  versions = signal<any>(null);
  publishing = signal(false);
  /** Persona / schema simulations (ECH-150/157). */
  simOpen = signal(false);
  simBusy = signal(false);
  simView = signal<any>(null);
  simRun = signal<any>(null);
  readonly TOOL_CATALOGUE = [
    { key: 'get_current_datetime', label: 'Current date and time', description: "Lets the agent check today's date, the day of the week and the time in India (IST) during a call." },
  ];
  readonly INPUT_TYPES = [
    { key: 'string', label: 'Text', glyph: 'T' },
    { key: 'number', label: 'Number', glyph: '9' },
    { key: 'phone', label: 'Phone', glyph: '#' },
    { key: 'boolean', label: 'Boolean', glyph: '?' },
    { key: 'date', label: 'Date', glyph: 'D' },
  ];
  readonly OUTPUT_TYPES = [
    { key: 'string', label: 'Text', glyph: 'T' },
    { key: 'enum', label: 'Selector', glyph: '▾' },
    { key: 'boolean', label: 'Boolean', glyph: '?' },
    { key: 'number', label: 'Number', glyph: '9' },
    { key: 'date', label: 'Date', glyph: 'D' },
    { key: 'list', label: 'List', glyph: '≡' },
  ];
  readonly GRAPH_NODES: { key: AgentNode; label: string; sub: string }[] = [
    { key: 'dial', label: 'Dial', sub: 'Calling flow and retries' },
    { key: 'inputs', label: 'Input variables', sub: 'Sheet columns for the call' },
    { key: 'knowledge', label: 'Knowledge', sub: 'Reference files for the agent' },
    { key: 'tools', label: 'Tool calls', sub: 'Functions, lookups and webhooks' },
    { key: 'prompt', label: 'Agent', sub: 'Prompt and behaviour' },
    { key: 'outputs', label: 'Post-call extraction', sub: 'Answers saved after the call' },
    { key: 'results', label: 'Results', sub: 'Where answers go' },
  ];
  sections = signal<any[]>([]);
  doc = signal('');
  generated = signal<any>({});
  generatedError = signal('');
  preview = signal<any>(null);
  copied = signal<number | null>(null);
  private copiedTimer: any = null;
  private toastTimer: any = null;
  private kbIndexTimer: any = null;
  private kbCopyTimer: any = null;

  safetyModal = signal<'pii' | 'guardrails' | null>(null);
  goalsOpen = signal(false);
  callGoalsCount = computed(() => (this.rules().goal_config?.call_goals || []).filter((g) => g.enabled !== false).length);
  campaignGoalsCount = computed(() => (this.rules().goal_config?.campaign_goals || []).filter((g) => g.enabled !== false).length);
  kb = signal<{ id: string; name: string; status: string; usage_30d: { files: number; texts: number; urls: number } }>({
    id: 'know_00000000',
    name: 'Knowledge base',
    status: 'ready',
    usage_30d: { files: 0, texts: 0, urls: 0 },
  });
  kbIndexing = signal(false);
  kbLimitsOpen = signal(false);
  kbCopied = signal(false);
  kbAddMode = signal<'text' | 'url' | null>(null);
  kbEditingId = signal<string | null>(null);
  kbBusy = signal(false);
  kbTextName = signal('');
  kbTextContent = signal('');
  kbUrlValue = signal('');
  kbUrlName = signal('');
  kbUrlRefresh = signal(true);
  kbShortId = computed(() => {
    const id = this.kb().id || '';
    return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-3)}` : id;
  });
  kbUsage = computed(() => this.kb().usage_30d || { files: 0, texts: 0, urls: 0 });

  inputs = signal<any[]>([]);
  outputs = signal<any[]>([]);
  settings = signal<Settings>({ label: '', description: '', voice: '', ozonetel_campaign: '', primary_id_key: '' });
  oznCampaigns = signal<any[]>([]);
  /** Org agents — used to count who shares a dial line. */
  peerAgents = signal<{ key: string; label: string; ozonetel_campaign?: string }[]>([]);
  /** Enabled flows, grouped by provider for the dropdown. */
  flowGroups = computed(() => {
    const m = new Map<string, any[]>();
    for (const c of this.oznCampaigns()) { const k = c.provider_label || 'Telephony'; m.set(k, [...(m.get(k) || []), c]); }
    return [...m].map(([label, flows]) => ({ label, flows }));
  });
  /** The picked line with its owner and caller number, shown on the agent. */
  flowInfo = computed(() => this.oznCampaigns().find((c) => c.name === this.settings().ozonetel_campaign) ?? null);
  flowOn = computed(() => !this.settings().ozonetel_campaign || this.oznCampaigns().some((c) => c.name === this.settings().ozonetel_campaign));
  /** How many agents use the selected dial line (including this one). */
  flowUsedBy = computed(() => {
    const name = this.settings().ozonetel_campaign;
    if (!name) return { count: 0, labels: [] as string[] };
    const fromPeers = this.peerAgents().filter((a) => a.ozonetel_campaign === name);
    if (fromPeers.length) {
      return { count: fromPeers.length, labels: fromPeers.map((a) => a.label || a.key) };
    }
    const f = this.flowInfo();
    const labels: string[] = Array.isArray(f?.used_by) ? f.used_by : [];
    return { count: f?.used_count ?? labels.length, labels };
  });
  syncPlatforms = signal<{ platform_key: string; label: string; connected?: boolean; needs_url?: boolean }[]>([]);
  plan = signal<InputPlan>(blankPlan());
  rules = signal<Rules>(blankRules());
  references = signal<any[]>([]);
  fileCheck = signal<any>(null);
  fileChecking = signal(false);
  refScope = signal<'campaign' | 'agent'>('campaign');
  /** Outcomes a user may choose to retry; Completed, Wrong number and Blocked are never retried. */
  /** Any final call status can be chosen; the defaults are the ones marked to retry. */
  readonly RETRYABLE = CALL_STATUSES.filter((s) => s.group !== 'in_progress' && s.group !== 'not_dialled').map((s) => ({ key: s.key, label: s.label, hover: statusHover(s.key) }));
  grouped = computed(() => this.plan().mode === 'group');
  inputKeys = computed(() => this.inputs().map((v) => v.key).filter(Boolean));
  onceCols = computed(() => this.inputKeys().filter((k) => this.roleOf(k) === 'call'));
  rowCols = computed(() => this.inputKeys().filter((k) => this.roleOf(k) === 'row'));
  phoneKey = computed(() => this.inputs().find((v) => v.type === 'phone')?.key || '');
  listOutputs = computed(() => this.outputs().filter((v) => v.type === 'list'));
  /** A row as the agent will say it, from the sample values of its columns. */
  sayPreview = computed(() => {
    const p = this.plan(); const sample = (k: string) => String(this.inputs().find((v: any) => v.key === k)?.sample ?? k);
    const cols = (p.row_columns || []).filter((k) => k !== p.group_by);
    return p.say_as ? p.say_as.replace(/\{(\w+)\}/g, (_: string, k: string) => sample(k)) : cols.slice(0, 2).map(sample).join(', ');
  });
  toggleIdentity(k: string): void { const cur = this.plan().identity || []; this.patchPlan({ identity: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] }); }
  addSkip(): void { this.patchPlan({ skip: [...(this.plan().skip || []), { column: this.rowCols()[0] || '', op: 'is', value: '' }] }); }
  setSkip(i: number, c: Partial<SkipRule>): void { this.patchPlan({ skip: (this.plan().skip || []).map((r, n) => (n === i ? { ...r, ...c } : r)) }); }
  dropSkip(i: number): void { this.patchPlan({ skip: (this.plan().skip || []).filter((_, n) => n !== i) }); }
  rowAnswers = computed(() => this.outputs().find((v) => v.key === this.plan().answers_key && v.type === 'list') || this.listOutputs()[0] || null);
  answerOptions = computed(() => this.outputs().find((v) => v.key === this.rules().retry.answer_field)?.options || []);
  /** Where each column goes on a grouped call: once for the whole call, or read out per row. */
  roleOf(k: string): 'call' | 'row' {
    const p = this.plan();
    if (k === p.group_by || k === this.phoneKey()) return 'call';
    return p.row_columns.includes(k) ? 'row' : 'call';
  }

  confirmDelete = signal(false);
  cloneConfirm = signal(false);
  cloneName = signal('');
  listSubOpen = signal<Record<number, boolean>>({});
  isListSubOpen(i: number, v: any): boolean {
    const m = this.listSubOpen();
    return i in m ? m[i] : (v?.fields?.length || 0) > 0;
  }
  toggleListSub(i: number, v: any): void {
    const cur = this.isListSubOpen(i, v);
    this.listSubOpen.update((m) => ({ ...m, [i]: !cur }));
  }
  startClonePrompt(): void {
    this.cloneName.set(`${this.agent()?.label || this.key} (copy)`);
    this.cloneConfirm.set(true);
  }
  leaveAsk = signal(false);
  private leaveResolve: ((ok: boolean) => void) | null = null;

  /** The last saved state, normalized the same way as the draft for comparison. */
  private saved = signal<string>('');

  voiceOptions = computed(() => {
    const all = (this.meta()?.voices || []).filter((v: any) => v.provider === 'gemini');
    return [...all].sort((a: any, b: any) =>
      a.name === this.DEFAULT_VOICE ? -1 : b.name === this.DEFAULT_VOICE ? 1 : a.name.localeCompare(b.name),
    );
  });

  genderOf(name: string): string {
    return (this.meta()?.voices || []).find((v: any) => v.name === name)?.gender || '';
  }

  tokens = computed(() => {
    const s = this.sections().filter(x => x.kind === 'text' && x.enabled !== false);
    const matches = s.flatMap(x => (x.body || '').match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) || []);
    return [...new Set(matches.map(t => t.replace(/[{}\s]/g, '')))];
  });

  undeclared = computed(() => {
    const declared = new Set(this.inputs().map(v => v.key));
    const reserved = new Set((this.meta()?.placeholders || []).map((x: any) => x.name));
    const derived = new Set(this.generated().derived || []);
    return this.tokens().filter(t => !declared.has(t) && !reserved.has(t) && !derived.has(t));
  });

  /** Which parts differ from what is saved. */
  changes = computed(() => {
    if (!this.saved()) return [] as string[];
    const was = JSON.parse(this.saved());
    const now = this.draft();
    const parts: string[] = [];
    if (JSON.stringify(now.sections) !== JSON.stringify(was.sections)) parts.push('prompt');
    if (JSON.stringify(now.inputs) !== JSON.stringify(was.inputs)) parts.push('call data');
    if (JSON.stringify(now.outputs) !== JSON.stringify(was.outputs)) parts.push('answers');
    if (JSON.stringify(now.settings) !== JSON.stringify(was.settings)) parts.push('settings');
    if (JSON.stringify(now.goals) !== JSON.stringify(was.goals)) parts.push('goals');
    if (JSON.stringify(now.optionalTools) !== JSON.stringify(was.optionalTools)) parts.push('tools');
    if (JSON.stringify(now.toolPolicy) !== JSON.stringify(was.toolPolicy)) parts.push('tools');
    if (JSON.stringify(now.plan) !== JSON.stringify(was.plan)) parts.push('input file');
    if (now.kbName !== was.kbName) parts.push('knowledge');
    if (JSON.stringify(now.rules) !== JSON.stringify(was.rules) && !parts.includes('settings') && !parts.includes('tools')) parts.push('settings');
    return parts;
  });
  dirty = computed(() => this.changes().length > 0);
  toolCount = computed(() =>
    (this.rules().tool_functions?.length || 0) +
    (this.rules().code_tools?.length || 0) +
    (this.rules().mcps?.length || 0) +
    (this.rules().lookups?.length || 0),
  );
  webhookEventsCount = computed(() => (this.rules().webhook?.events || []).length);
  agentPiiSummary = computed(() => {
    const p = this.rules().pii_config;
    if (p?.inherit !== false) return 'Workspace default';
    return p.categories?.length ? `${p.categories.length} categories` : 'Off';
  });
  agentGuardrailsSummary = computed(() => {
    const g = this.rules().guardrails;
    if (g?.inherit !== false) return 'Workspace default';
    const n = (g.input?.length || 0) + (g.output?.length || 0);
    return n ? `${n} active` : 'Off';
  });
  allVarKeys = computed(() => [...new Set([...this.inputKeys(), ...this.outputs().map((o) => o.key).filter(Boolean)])]);
  preCallLookupsCount = computed(() => (this.rules().lookups || []).filter((l: any) => (l.when || 'before') === 'before').length);
  duringCallLookupsCount = computed(() => (this.rules().lookups || []).filter((l: any) => l.when === 'during').length);
  extractionModelLabel = computed(() => {
    const e = this.engine();
    const id = e.mode === 's2s' ? e.s2s : e.llm;
    return id ? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 18) : 'GPT-6 Luna';
  });
  postPane = signal<'whatsapp' | 'sync'>('whatsapp');
  activeWaTrigger = signal<number>(0);
  waTestTo = signal<string>('+91 98200 11223');
  waTestBusy = signal<boolean>(false);
  waTestResult = signal<any>(null);
  enabledWhatsappCount = computed(() => {
    const w = this.rules().whatsapp;
    return w?.enabled ? (w.triggers || []).filter((t) => t.enabled).length : 0;
  });
  waActiveTriggerObj = computed(() => {
    const list = this.rules().whatsapp?.triggers || [];
    const i = Math.min(Math.max(0, this.activeWaTrigger()), Math.max(0, list.length - 1));
    return list[i] || null;
  });
  waTokenChoices = computed(() => {
    const ins = this.inputs().map((v: any) => v.key).filter(Boolean);
    const outs = this.outputs().map((v: any) => v.key).filter((k: string) => k && k !== 'rows' && k !== 'agent_goal');
    return [...new Set([...ins.slice(0, 3), ...outs.slice(0, 3), 'detailed_remarks'])];
  });
  waPreviewText = computed(() => {
    const trig = this.waActiveTriggerObj();
    if (!trig) return '';
    const sampleMap: Record<string, string> = {};
    for (const v of this.inputs()) if (v.key) sampleMap[v.key] = String(v.sample || v.key);
    for (const o of this.outputs()) if (o.key) sampleMap[o.key] = o.options?.[0] || (o.type === 'number' ? '6' : o.type === 'date' ? '12 Nov 2026' : 'confirmed');
    sampleMap['detailed_remarks'] ||= '600 pcs scheduled for 12 Nov, balance on 18 Nov.';
    sampleMap['overall_dispatch_status'] ||= 'scheduled';
    return String(trig.body || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_: string, k: string) => sampleMap[k] || `[${k}]`);
  });
  /** Pass/fail criteria reused from the answer schema (ECH-150). */
  outputCriteria = computed(() => this.outputs().filter((o) => o.key && o.key !== 'agent_goal').map((o) => ({
    key: o.key,
    label: o.label || o.key,
    required: o.required !== false,
    type: o.type || 'string',
    options: o.options || [],
  })));
  versionLabel = computed(() => {
    const v = this.versions();
    if (!v) return null;
    if (v.published != null && v.draft != null && v.draft !== v.published) {
      return { text: `Draft v${v.draft} · live dials use published v${v.published}`, cls: 'warn' };
    }
    if (v.published != null) return { text: `Published v${v.published}`, cls: 'ok' };
    if (v.draft != null) return { text: `Draft v${v.draft} (not published)`, cls: 'warn' };
    return { text: 'No published version yet', cls: 'muted' };
  });
  canPublish = computed(() => {
    const v = this.versions();
    return !!(v?.draft != null && v.draft !== v.published);
  });

  /** Arrow keys move across selectable graph nodes. */
  nodeKeys(e: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const keys = this.GRAPH_NODES.map((n) => n.key);
    const i = keys.indexOf(this.selectedNode());
    if (i < 0) return;
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    e.preventDefault();
    this.selectNode(keys[n]);
  }
  toggleAccordion(id: string): void {
    this.accordion.update((cur) => (cur === id ? '' : id));
  }
  setAgentPane(pane: AgentPane): void {
    this.agentPane.set(pane);
  }
  selectKnowledge(): void {
    this.openNodeModal('knowledge');
  }
  selectMemoryCard(): void {
    this.openNodeModal('inputs');
  }
  toggleMemoryCard(ev: Event): void {
    ev.stopPropagation();
    this.patchPlan({ remember: this.plan().remember === false });
  }
  selectNode(key: AgentNode): void {
    this.selectedNode.set(key);
    this.persistNode(key);
    this.addMenu.set(null);
    this.toolAddMenu.set(false);
  }
  openNodeModal(key: AgentNode): void {
    this.selectNode(key);
    this.activeModal.set(key);
    if (key === 'prompt') this.agentPane.set('prompt');
  }
  openFieldModal(kind: FieldKind, index: number): void {
    const list = kind === 'input' ? this.inputs() : this.outputs();
    const row = list[index];
    if (!row) return;
    this.selectNode(kind === 'input' ? 'inputs' : 'outputs');
    this.addMenu.set(null);
    this.editingField.set({ kind, index, field: row, isNew: false });
  }
  saveFieldModal(updated: any): void {
    const ef = this.editingField();
    if (!ef) return;
    if (ef.kind === 'input') {
      if (ef.isNew || ef.index < 0) this.inputs.update((v) => [...v, updated]);
      else this.inputs.update((v) => v.map((r, i) => (i === ef.index ? updated : r)));
    } else {
      if (ef.isNew || ef.index < 0) this.outputs.update((v) => [...v, updated]);
      else this.outputs.update((v) => v.map((r, i) => (i === ef.index ? updated : r)));
    }
    this.editingField.set(null);
  }
  removeFieldModal(): void {
    const ef = this.editingField();
    if (!ef || ef.isNew || ef.index < 0) { this.editingField.set(null); return; }
    if (ef.kind === 'input') this.deleteInput(ef.index);
    else this.deleteOutput(ef.index);
    this.editingField.set(null);
  }
  openToolModal(mode: 'builtin' | 'custom' | 'code' | 'mcp', index: number): void {
    const r = this.rules();
    const list = mode === 'code' ? r.code_tools : mode === 'mcp' ? r.mcps : r.tool_functions;
    const item = list[index];
    if (!item) return;
    this.toolAddMenu.set(false);
    this.toolModal.set({ mode, index, value: item, isNew: false });
  }
  openNewToolModal(mode: 'builtin' | 'custom' | 'code' | 'mcp'): void {
    this.toolAddMenu.set(false);
    const val = mode === 'builtin' ? blankEndCallFn() : mode === 'custom' ? blankCustomFn() : mode === 'code' ? blankCodeTool() : blankMcp();
    this.toolModal.set({ mode, index: -1, value: val, isNew: true });
  }
  openWebhookModal(): void {
    this.selectNode('tools');
    this.toolAddMenu.set(false);
    this.toolModal.set({ mode: 'webhook', index: 0, value: this.rules().webhook || blankWebhook(), isNew: false });
  }
  saveToolModal(updated: any): void {
    const tm = this.toolModal();
    if (!tm) return;
    if (tm.mode === 'webhook') {
      this.patchRules({ webhook: updated });
    } else if (tm.mode === 'code') {
      const list = [...(this.rules().code_tools || [])];
      if (tm.isNew || tm.index < 0) list.push(updated);
      else list[tm.index] = updated;
      this.patchRules({ code_tools: list });
    } else if (tm.mode === 'mcp') {
      const list = [...(this.rules().mcps || [])];
      if (tm.isNew || tm.index < 0) list.push(updated);
      else list[tm.index] = updated;
      this.patchRules({ mcps: list });
    } else {
      const list = [...(this.rules().tool_functions || [])];
      if (tm.isNew || tm.index < 0) list.push(updated);
      else list[tm.index] = updated;
      this.patchRules({ tool_functions: list });
    }
    this.toolModal.set(null);
  }
  removeToolModal(): void {
    const tm = this.toolModal();
    if (!tm || tm.isNew || tm.index < 0 || tm.mode === 'webhook') { this.toolModal.set(null); return; }
    if (tm.mode === 'code') this.deleteCodeTool(tm.index);
    else if (tm.mode === 'mcp') this.deleteMcp(tm.index);
    else this.deleteToolFunction(tm.index);
    this.toolModal.set(null);
  }
  deleteToolFunction(i: number): void {
    this.patchRules({ tool_functions: (this.rules().tool_functions || []).filter((_, idx) => idx !== i) });
  }
  deleteCodeTool(i: number): void {
    this.patchRules({ code_tools: (this.rules().code_tools || []).filter((_, idx) => idx !== i) });
  }
  deleteMcp(i: number): void {
    this.patchRules({ mcps: (this.rules().mcps || []).filter((_, idx) => idx !== i) });
  }
  moveInput(i: number, dir: number): void {
    this.inputs.update((v) => move(v, i, i + dir));
  }
  moveOutput(i: number, dir: number): void {
    this.outputs.update((v) => move(v, i, i + dir));
  }
  isPhonetic(v: any): boolean { return v?.transform === 'phonetic'; }
  setPhonetic(i: number, on: boolean): void { this.patchInput(i, { transform: on ? 'phonetic' : '' }); }
  /** Visible field rows on compact canvas cards (rest: “+N more”). */
  canvasFields(kind: 'input' | 'output', limit = 3): any[] {
    const list = kind === 'input' ? this.inputs() : this.outputs();
    return list.slice(0, limit);
  }
  canvasFieldMore(kind: 'input' | 'output', limit = 3): number {
    const n = (kind === 'input' ? this.inputs() : this.outputs()).length - limit;
    return n > 0 ? n : 0;
  }
  /** Short dial label for the compact canvas card — prefer the phone number. */
  dialCanvasLabel(): string {
    const name = this.settings().ozonetel_campaign || '';
    const did = this.flowInfo()?.did || '';
    if (!name && !did) return 'Pick a line';
    if (did) return String(did);
    return name;
  }
  typeGlyph(type: string): string { return TYPE_GLYPH[type] || 'T'; }
  addInputOfType(type: string): void {
    this.addMenu.set(null);
    this.selectNode('inputs');
    this.editingField.set({ kind: 'input', index: -1, field: blankInput(type), isNew: true });
  }
  addOutputOfType(type: string): void {
    this.addMenu.set(null);
    this.selectNode('outputs');
    this.editingField.set({ kind: 'output', index: -1, field: blankOutput(type), isNew: true });
  }
  private nodeStorageKey(): string { return `echo.agentNode.${this.key || '_'}`; }
  private persistNode(key: string): void {
    try {
      sessionStorage.setItem(this.nodeStorageKey(), key);
      localStorage.setItem(this.nodeStorageKey(), key);
    } catch { /* private mode */ }
  }
  private restoreNode(): void {
    try {
      const raw = sessionStorage.getItem(this.nodeStorageKey()) || localStorage.getItem(this.nodeStorageKey());
      if (raw === 'dial' || raw === 'inputs' || raw === 'knowledge' || raw === 'tools' || raw === 'prompt' || raw === 'outputs' || raw === 'results') this.selectedNode.set(raw);
    } catch { /* private mode */ }
  }
  /** @deprecated */
  tabKeys(e: KeyboardEvent): void { this.nodeKeys(e); }

  syncLabel = computed(() => {
    const a = this.agent();
    if (!a || !this.syncPlatforms().length) return null;
    const platform = this.syncPlatforms().find((p) => p.platform_key === a.synced_platform)?.label || '';
    if (!a.synced_platform) return { text: 'Results stay in Echo', cls: 'muted' };
    if (a.sync_status === 'failed') return { text: `${platform}: sync failed`, cls: 'bad' };
    if (a.sync_status === 'pending') return { text: `${platform}: syncing`, cls: 'info' };
    if (a.synced_at && a.updated_at && a.updated_at > a.synced_at) return { text: `${platform}: changes waiting`, cls: 'warn' };
    return { text: `In sync with ${platform}`, cls: 'ok' };
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.key = params.get('key') || '';
      if (this.key) {
        this.restoreNode();
        this.load();
        this.loadGenerated();
      }
    });
    this.api.ozonetelCampaigns(true).then(r => this.oznCampaigns.set(r.campaigns || [])).catch(() => this.oznCampaigns.set([]));
    this.api.agentList(false).then((r) => this.peerAgents.set((r.agents || []).map((a: any) => ({
      key: a.key, label: a.label || a.key, ozonetel_campaign: a.ozonetel_campaign || '',
    })))).catch(() => this.peerAgents.set([]));
    const orgId = this.auth.currentOrgId();
    if (orgId) this.api.orgSyncPlatforms(orgId).then(p => this.syncPlatforms.set(p || [])).catch(() => this.syncPlatforms.set([]));
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
    clearTimeout(this.copiedTimer);
    clearTimeout(this.kbIndexTimer);
    clearTimeout(this.kbCopyTimer);
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) { e.preventDefault(); e.returnValue = ''; }
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (this.dirty()) this.save(); }
    if (e.key === 'Escape') {
      if (this.toolAddMenu()) { this.toolAddMenu.set(false); return; }
      if (this.addMenu()) { this.addMenu.set(null); return; }
      if (this.toolModal() || this.editingField() || this.safetyModal() || this.goalsOpen()) return; // handled by child modals
      if (this.kbLimitsOpen()) { this.kbLimitsOpen.set(false); return; }
      if (this.kbAddMode()) { this.closeKbForm(); return; }
      if (this.voiceOpen() || this.simOpen()) {
        this.voiceOpen.set(false); this.simOpen.set(false); return;
      }
      if (this.activeModal()) { this.activeModal.set(null); }
    }
  }

  /** Router guard hook (see app.routes.ts). Asks in-app before dropping changes. */
  canLeave(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    this.leaveAsk.set(true);
    return new Promise<boolean>(resolve => { this.leaveResolve = resolve; });
  }
  answerLeave(ok: boolean): void {
    this.leaveAsk.set(false);
    this.leaveResolve?.(ok);
    this.leaveResolve = null;
  }

  async load(): Promise<void> {
    try {
      const [d, m] = await Promise.all([this.api.agentDetail(this.key), this.api.agentMeta()]);
      const a = d.agent;
      this.agent.set(a);
      this.meta.set(m);
      this.inputs.set(structuredClone(a.input_variables || []));
      this.outputs.set(structuredClone(a.output_variables || []));
      this.sections.set(structuredClone(a.sections || []));
      this.settings.set({
        label: a.label || '', description: a.description || '', voice: a.voice || '',
        ozonetel_campaign: a.ozonetel_campaign || '', primary_id_key: a.primary_id_key || '',
      });
      this.plan.set({ ...blankPlan(), ...structuredClone(a.input_plan || {}) });
      const savedRetry = a.retry || {};
      const migrated = { ...savedRetry, mode: savedRetry.mode || 'static', retries: savedRetry.retries ?? Math.min(5, Math.max(0, (savedRetry.tries ?? 3) - 1)) };
      const phoneKey = (a.input_variables || []).find((v: any) => v.type === 'phone')?.key || 'phone_number';
      const savedWa = a.whatsapp
        ? { ...blankWhatsapp(), ...structuredClone(a.whatsapp), triggers: Array.isArray(a.whatsapp.triggers) ? structuredClone(a.whatsapp.triggers) : blankWhatsapp().triggers }
        : { ...blankWhatsapp(), phone_field: phoneKey };
      const br = blankRules();
      this.rules.set({
        ...br,
        retry: { ...br.retry, ...migrated },
        sync_target: { ...br.sync_target, ...(a.sync_target || {}) },
        lookups: structuredClone(a.lookups || []),
        tool_functions: Array.isArray(a.tool_functions) ? structuredClone(a.tool_functions) : br.tool_functions,
        code_tools: Array.isArray(a.code_tools) ? structuredClone(a.code_tools) : br.code_tools,
        webhook: a.webhook ? { ...br.webhook, ...structuredClone(a.webhook) } : br.webhook,
        mcps: Array.isArray(a.mcps) ? structuredClone(a.mcps) : br.mcps,
        pii_config: a.pii_config ? { ...br.pii_config, ...structuredClone(a.pii_config) } : br.pii_config,
        guardrails: a.guardrails ? { ...br.guardrails, ...structuredClone(a.guardrails) } : br.guardrails,
        goal_config: a.goal_config ? structuredClone(a.goal_config) : defaultGoalConfigFromOutputs(a.output_variables || []),
        engine: { ...br.engine, ...(a.engine || {}) },
        whatsapp: savedWa,
      });
      this.references.set(a.references || []);
      this.syncKbFromAgent(a);
      this.goals.set(Array.isArray(a.goals) ? structuredClone(a.goals) : []);
      this.optionalTools.set(Array.isArray(a.optional_tools) ? structuredClone(a.optional_tools) : []);
      this.toolPolicy.set({ ...blankToolPolicy(), ...(a.tool_policy || {}), tools: { ...blankToolPolicy().tools, ...((a.tool_policy || {}).tools || {}) } });
      this.outputs.set(this.withAgentGoalOutput(this.outputs(), this.goals()));
      this.doc.set(toDoc(this.sections()));
      this.saved.set(JSON.stringify(this.draft()));
      this.error.set('');
      this.loadVersions();
    } catch (e: any) { this.error.set(e.message); }
  }

  async loadVersions(): Promise<void> {
    try { this.versions.set(await this.api.agentVersions(this.key)); }
    catch { this.versions.set(null); }
  }

  async loadGenerated(): Promise<any> {
    try {
      const fresh = await this.api.agentGenerated(this.key);
      this.generated.set(fresh);
      this.generatedError.set('');
      return fresh;
    } catch (e: any) {
      this.generated.set({});
      this.generatedError.set(e.message);
      return null;
    }
  }

  /** The draft in saved form: generated blocks left exactly as generated count as empty. */
  private draft() {
    const sections = this.sections().map(sec => {
      if (!this.isGenerated(sec)) return { ...sec };
      const body = (sec.body || '').trim();
      const asGenerated = (this.generated()[sec.kind] || '').trim();
      return body && body === asGenerated ? { ...sec, body: '' } : { ...sec };
    });
    return {
      sections, inputs: this.inputs(), outputs: this.outputs(), settings: this.settings(),
      plan: this.plan(), kbName: this.kb().name, rules: this.rules(), goals: this.goals(), optionalTools: this.optionalTools(),
      toolPolicy: this.toolPolicy(),
    };
  }

  async save(): Promise<void> {
    if (this.busy()) return;
    const parts = this.changes();
    if (!parts.length) return;
    if (!this.flowOn()) { this.error.set("This agent is set to a line that is not this workspace's own. Pick one of this workspace's lines before saving."); return; }
    const d = this.draft();
    this.busy.set(true); this.error.set('');
    try {
      // Variables first, so the prompt's generated blocks are built from the new ones.
      if (parts.includes('call data')) await this.api.saveAgentInputs(this.key, d.inputs);
      const was = JSON.parse(this.saved());
      if (parts.includes('input file') || parts.includes('tools') || parts.includes('knowledge') || JSON.stringify(d.rules) !== JSON.stringify(was.rules)) {
        await this.api.updateAgent(this.key, {
          input_plan: d.plan,
          kb: { ...this.kb(), name: d.kbName },
          retry: { ...d.rules.retry, tries: (d.rules.retry.retries ?? 0) + 1 },
          sync_target: d.rules.sync_target,
          lookups: d.rules.lookups,
          tool_functions: d.rules.tool_functions,
          code_tools: d.rules.code_tools,
          webhook: d.rules.webhook,
          mcps: d.rules.mcps,
          pii_config: d.rules.pii_config,
          guardrails: d.rules.guardrails,
          goal_config: d.rules.goal_config,
          engine: d.rules.engine,
          optional_tools: d.optionalTools,
          tool_policy: d.toolPolicy,
          whatsapp: d.rules.whatsapp,
        });
      }
      if (parts.includes('answers') || parts.includes('goals')) {
        const outs = this.withAgentGoalOutput(d.outputs, d.goals);
        await this.api.saveAgentOutputs(this.key, outs);
      }
      if (parts.includes('prompt')) await this.api.saveAgentSections(this.key, d.sections);
      if (parts.includes('settings') || parts.includes('goals')) {
        const s = d.settings;
        await this.api.updateAgent(this.key, {
          label: s.label.trim() || this.agent().label, description: s.description, voice: s.voice,
          ozonetel_campaign: s.ozonetel_campaign,
          ozonetel_type: this.oznCampaigns().find(c => c.name === s.ozonetel_campaign)?.type || '',
          primary_id_key: s.primary_id_key, primary_id_label: s.primary_id_key,
          goals: d.goals,
        });
      }
      await Promise.all([this.load(), this.loadGenerated()]);
      this.say(`Saved ${parts.join(', ')}. Live on the next call.`);
    } catch (e: any) {
      this.error.set(`Not saved: ${e.message}. Your changes are still here.`);
    } finally {
      this.busy.set(false);
    }
  }

  discard(): void {
    const was = JSON.parse(this.saved());
    this.sections.set(was.sections);
    this.inputs.set(was.inputs);
    this.outputs.set(was.outputs);
    this.settings.set(was.settings);
    this.plan.set(was.plan);
    if (was.kbName !== undefined) this.kb.update((k) => ({ ...k, name: was.kbName }));
    this.rules.set(was.rules);
    this.goals.set(was.goals || []);
    this.optionalTools.set(was.optionalTools || []);
    this.toolPolicy.set(was.toolPolicy || blankToolPolicy());
    this.doc.set(toDoc(was.sections));
    this.say('Changes discarded.');
  }

  // ── Agent goals ───────────────────────────────────────────────────────────
  addGoal(): void { this.goals.update((g) => [...g, '']); this.syncGoalOutput(); }
  patchGoal(i: number, text: string): void { this.goals.update((g) => g.map((x, n) => (n === i ? text : x))); this.syncGoalOutput(); }
  moveGoal(i: number, dir: number): void { this.goals.update((g) => move(g, i, i + dir)); this.syncGoalOutput(); }
  deleteGoal(i: number): void { this.goals.update((g) => g.filter((_, n) => n !== i)); this.syncGoalOutput(); }
  /** Keep a locked agent_goal enum on outputs when goals exist. */
  private withAgentGoalOutput(outputs: any[], goals: string[]): any[] {
    const cleaned = outputs.filter((o) => o.key !== 'agent_goal');
    const filled = goals.map((g) => g.trim()).filter(Boolean);
    if (!filled.length || !cleaned.length) return cleaned;
    return [...cleaned, {
      key: 'agent_goal', label: 'Agent goals', type: 'enum', required: false,
      options: filled, description: 'Whether each goal was achieved on the call (locked)',
      locked: true,
    }];
  }
  private syncGoalOutput(): void {
    this.outputs.set(this.withAgentGoalOutput(this.outputs(), this.goals()));
  }

  // ── Optional tools ────────────────────────────────────────────────────────
  toolOn(key: string): boolean { return this.optionalTools().includes(key); }
  toggleTool(key: string, on: boolean): void {
    this.optionalTools.update((list) => on ? [...new Set([...list, key])] : list.filter((k) => k !== key));
  }
  patchToolPolicy(c: Partial<ToolPolicy>): void {
    this.toolPolicy.update((p) => ({ ...p, ...c, tools: c.tools ? { ...p.tools, ...c.tools } : p.tools }));
  }
  toolPolicyOf(key: string): { timeout_s: number; wait_line: string; retry: number } {
    const p = this.toolPolicy();
    const t = p.tools[key] || {};
    return {
      timeout_s: t.timeout_s ?? p.timeout_s,
      wait_line: t.wait_line ?? p.wait_line,
      retry: t.retry ?? 0,
    };
  }
  patchToolPolicyFor(key: string, c: Partial<{ timeout_s: number; wait_line: string; retry: number }>): void {
    const cur = this.toolPolicyOf(key);
    this.toolPolicy.update((p) => ({ ...p, tools: { ...p.tools, [key]: { ...cur, ...c } } }));
  }

  /** Publish live version, then push to Clarix/destination when configured. */
  async publishAndSync(): Promise<void> {
    if (this.publishing() || this.busy()) return;
    this.publishing.set(true); this.error.set('');
    try {
      if (this.dirty()) {
        await this.save();
        if (this.error() || this.dirty()) return;
      }
      this.versions.set(await this.api.publishAgentDraft(this.key));
      const ver = this.versions()?.published;
      const dest = this.rules().sync_target?.type;
      const platformKey = dest && dest !== 'none' ? dest : (this.agent()?.synced_platform || null);
      if (platformKey) {
        await this.api.syncAgent(this.key, platformKey);
        this.agent.update((a) => ({ ...a, synced_platform: platformKey, sync_status: 'pending' }));
        const label = this.syncPlatforms().find((p) => p.platform_key === platformKey)?.label || platformKey;
        this.say(`Published v${ver}. Sending to ${label}…`);
        setTimeout(() => this.refreshAgentHeader(), 2500);
      } else {
        this.say(`Published v${ver}. Results stay in Echo — set a destination on Results to sync Clarix.`);
      }
    } catch (e: any) { this.error.set(e.message); }
    finally { this.publishing.set(false); }
  }
  /** @deprecated use publishAndSync */
  async publishDraft(): Promise<void> { return this.publishAndSync(); }

  // Prompt modes
  setMode(m: 'blocks' | 'full'): void {
    if (m === this.mode()) return;
    if (m === 'full') this.doc.set(toDoc(this.sections()));
    this.mode.set(m);
    try { localStorage.setItem('echo.promptMode', m); } catch { /* private mode */ }
  }
  private savedMode(): 'blocks' | 'full' {
    try { return localStorage.getItem('echo.promptMode') === 'full' ? 'full' : 'blocks'; } catch { return 'blocks'; }
  }
  onDocInput(text: string): void {
    this.doc.set(text);
    this.sections.set(fromDoc(text, this.sections()));
  }

  async showPreview(): Promise<void> {
    this.error.set('');
    this.selectNode('prompt');
    this.setAgentPane('prompt');
    try { this.preview.set(await this.api.previewAgentPrompt(this.key, { sections: this.sections() })); }
    catch (e: any) { this.error.set(e.message); this.preview.set(null); }
  }

  async remove(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.deleteAgent(this.key);
      this.saved.set(JSON.stringify(this.draft())); // nothing left to protect
      this.router.navigate(['/agents']);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); this.confirmDelete.set(false); }
  }

  async clone(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const a = this.agent();
      const label = this.cloneName().trim() || `${a.label} (copy)`;
      const out = await this.api.createAgent({
        label, description: a.description || '', copy_from: this.key,
        ozonetel_campaign: a.ozonetel_campaign || '', ozonetel_type: a.ozonetel_type || '',
      });
      this.cloneConfirm.set(false);
      this.router.navigate(['/agents', out.agent.key]);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }

  async syncNow(): Promise<void> {
    const p = this.syncPlatforms().find((x) => x.platform_key === this.agent()?.synced_platform);
    if (!p) return;
    try {
      await this.api.syncAgent(this.key, p.platform_key);
      this.agent.update(a => ({ ...a, synced_platform: p.platform_key, sync_status: 'pending' }));
      this.say(`Sending to ${p.label}…`);
      setTimeout(() => this.refreshAgentHeader(), 2500);
    } catch (e: any) {
      this.say(/409|already/i.test(e.message) ? `Already in sync with ${p.label}.` : `Sync failed: ${e.message}`);
    }
  }
  private async refreshAgentHeader(): Promise<void> {
    try { const d = await this.api.agentDetail(this.key); this.agent.update(a => ({ ...a, ...pickSync(d.agent) })); } catch { /* keep */ }
  }

  api_templateUrl(): string { return this.api.agentTemplateUrl(this.key); }
  testCall(): void { this.router.navigate(['/console'], { queryParams: { agent: this.key } }); }
  goBack(): void { this.router.navigate(['/agents']); }

  // Section tools
  patchSection(i: number, changes: any): void { this.sections.update(s => patch(s, i, changes)); }
  moveSection(i: number, dir: number): void { this.sections.update(s => move(s, i, i + dir)); }
  deleteSection(i: number): void { this.sections.update(s => s.filter((_, idx) => idx !== i)); }
  addSection(kind: string, title: string): void {
    this.sections.update(s => [...s, { ...blankSection(), kind, title: title || '' }]);
  }
  sectionText(sec: any): string {
    const body = (sec.body || '').trim();
    if (body) return body;
    return (sec.kind === 'input' || sec.kind === 'output') ? (this.generated()[sec.kind] || '') : '';
  }

  async copySection(i: number, sec: any): Promise<void> {
    const text = this.sectionText(sec);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
    this.copied.set(i);
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(null), 1400);
  }

  async refreshSection(i: number, sec: any, overridden: boolean): Promise<void> {
    const fresh = await this.loadGenerated();
    if (!overridden || !fresh?.[sec.kind]) return;
    this.patchSection(i, { body: mergeFieldLines(sec.body || '', fresh[sec.kind]) });
  }

  // Call data and answers
  patchInput(i: number, changes: any): void { this.inputs.update(v => patch(v, i, changes)); }
  deleteInput(i: number): void { this.inputs.update(v => v.filter((_, idx) => idx !== i)); }
  addInput(): void { this.inputs.update(v => [...v, blankInput()]); }
  patchOutput(i: number, changes: any): void { this.outputs.update(v => patch(v, i, changes)); }
  setOutputKey(i: number, key: string): void { this.patchOutput(i, { key, label: key }); }
  deleteOutput(i: number): void {
    const row = this.outputs()[i];
    if (row?.locked || row?.key === 'agent_goal') return;
    this.outputs.update(v => v.filter((_, idx) => idx !== i));
  }
  addOutput(): void { this.outputs.update(v => [...v, blankOutput()]); }
  readonly SUB_TYPES = ['string', 'number', 'date', 'boolean', 'enum'];
  readonly SUB_COLS = '180px 140px 1fr 40px';
  patchSub(i: number, j: number, changes: any): void {
    this.outputs.update(v => patch(v, i, { fields: patch(v[i].fields || [], j, changes) }));
  }
  addSub(i: number): void { this.outputs.update(v => patch(v, i, { fields: [...(v[i].fields || []), { key: '', type: 'string', options: [] }] })); }
  deleteSub(i: number, j: number): void { this.outputs.update(v => patch(v, i, { fields: (v[i].fields || []).filter((_: any, k: number) => k !== j) })); }
  setSubOptions(i: number, j: number, val: string): void { this.patchSub(i, j, { options: val.split(',').map(s => s.trim()).filter(Boolean) }); }
  setOptions(i: number, val: string): void {
    this.patchOutput(i, { options: val.split(',').map(s => s.trim()).filter(Boolean) });
  }
  patchSettings(changes: Partial<Settings>): void { this.settings.update(s => ({ ...s, ...changes })); }

  isGenerated(sec: any): boolean { return sec.kind === 'input' || sec.kind === 'output'; }
  sectionValue(sec: any): string {
    return sec.body || (this.isGenerated(sec) ? (this.generated()[sec.kind] || '') : '');
  }

  // ── Input file (how rows become calls) ────────────────────────────────────
  patchPlan(c: Partial<InputPlan>): void {
    this.plan.update((p) => {
      const next = { ...p, ...c };
      if (c.mode === 'group' && !next.group_by) next.group_by = this.phoneKey();
      if (c.mode === 'group' && !next.answers_key) next.answers_key = this.listOutputs()[0]?.key || '';
      return next;
    });
    this.fileCheck.set(null);
  }
  setRole(k: string, role: 'call' | 'row'): void {
    this.plan.update((p) => {
      const rows = p.row_columns.filter((x) => x !== k);
      const calls = p.call_columns.filter((x) => x !== k);
      return role === 'row' ? { ...p, row_columns: [...rows, k], call_columns: calls } : { ...p, row_columns: rows, call_columns: [...calls, k] };
    });
  }
  /** Adds the list answer the agent fills once per row, starting with the row number. */
  addRowAnswers(): void {
    const key = this.outputs().some((v) => v.key === 'rows') ? `rows_${this.outputs().length}` : 'rows';
    this.outputs.update((v) => [...v, { key, label: 'Answer for each row', type: 'list', required: true, description: 'One entry per row on the call, covered or not',
      fields: [{ key: 'row', type: 'number', options: [] }, { key: 'status', type: 'enum', options: ['done', 'not_covered'] }] }]);
    this.patchPlan({ answers_key: key });
    this.selectNode('outputs');
  }
  async checkFile(file?: File): Promise<void> {
    if (!file) return;
    this.fileChecking.set(true); this.error.set('');
    try { this.fileCheck.set(await this.api.checkAgentFile(this.key, file, this.plan())); }
    catch (e: any) { this.error.set(e.message); }
    finally { this.fileChecking.set(false); }
  }

  // ── Calling rules, results destination, lookups ───────────────────────────
  patchRules(c: Partial<Rules>): void { this.rules.update((r) => ({ ...r, ...c })); }
  patchRetry(c: any): void { this.rules.update((r) => ({ ...r, retry: { ...r.retry, ...c } })); }
  protected readonly Math = Math;
  readonly waitModes: { key: WaitMode; label: string; hint: string }[] = [
    { key: 'static', label: 'Same each time', hint: 'The same wait before every retry' },
    { key: 'linear', label: 'Grows evenly', hint: 'Each wait is longer by the starting wait' },
    { key: 'exponential', label: 'Doubles', hint: 'Each wait is twice the one before' },
  ];
  retryMode = computed<WaitMode>(() => this.rules().retry.mode || 'static');
  retryCount = computed(() => this.rules().retry.retries ?? 0);
  retryError = signal('');
  /** Minutes before each retry: static 30,30,30; linear 30,60,90; exponential 30,60,120. */
  retryWaits = computed(() => {
    const r = this.rules().retry; const start = Math.max(1, r.gap_minutes || 1); const mode = r.mode || 'static';
    return Array.from({ length: Math.min(5, r.retries ?? 0) }, (_, i) => mode === 'linear' ? start * (i + 1) : mode === 'exponential' ? start * 2 ** i : start);
  });
  retryTotal = computed(() => this.retryWaits().reduce((a, b) => a + b, 0));
  fmtWait(mins: number): string {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  retryTimeline = computed(() => {
    const waits = this.retryWaits();
    const steps: { step: number; label: string; gapLabel: string; totalLabel: string }[] = [
      { step: 0, label: 'Dial 1', gapLabel: '', totalLabel: '0m' },
    ];
    let cum = 0;
    waits.forEach((w, i) => {
      cum += w;
      steps.push({ step: i + 1, label: `Retry ${i + 1}`, gapLabel: `+${this.fmtWait(w)}`, totalLabel: this.fmtWait(cum) });
    });
    return steps;
  });
  waitModeHint = computed(() => this.waitModes.find((m) => m.key === this.retryMode())?.hint || '');
  retrySummary = computed(() => this.retryCount() ? `${this.retryCount()} retr${this.retryCount() === 1 ? 'y' : 'ies'}, ${this.waitModes.find((m) => m.key === this.retryMode())?.label.toLowerCase()}` : 'No retries');
  retryWaitsLine = computed(() => this.retryWaits().length ? `${this.retryWaits().join(', ')} minutes · ${this.retryTotal()} in total` : 'A contact is called once.');
  setRetries(n: number): void {
    if (n > 5) { this.retryError.set('At most 5 retries after the first call. Lower the number to save.'); this.patchRetry({ retries: 5 }); return; }
    this.retryError.set(''); this.patchRetry({ retries: Math.max(0, Math.floor(n || 0)) });
  }
  patchTarget(c: any): void { this.rules.update((r) => ({ ...r, sync_target: { ...r.sync_target, ...c } })); }
  patchWhatsapp(c: Partial<WhatsappConfig>): void {
    this.rules.update((r) => ({ ...r, whatsapp: { ...r.whatsapp, ...c } }));
  }
  patchWaTrigger(i: number, c: Partial<WhatsappTrigger>): void {
    this.rules.update((r) => ({
      ...r,
      whatsapp: { ...r.whatsapp, triggers: r.whatsapp.triggers.map((t, idx) => (idx === i ? { ...t, ...c } : t)) },
    }));
  }
  insertWaToken(token: string): void {
    const idx = this.activeWaTrigger();
    const trig = this.waActiveTriggerObj();
    if (!trig) return;
    const sep = trig.body && !/\s$/.test(trig.body) ? ' ' : '';
    this.patchWaTrigger(idx, { body: `${trig.body || ''}${sep}{{${token}}}` });
  }
  async sendWaTest(): Promise<void> {
    if (this.waTestBusy()) return;
    const trig = this.waActiveTriggerObj();
    const wa = this.rules().whatsapp;
    this.waTestBusy.set(true);
    this.waTestResult.set(null);
    try {
      const r = await this.api.testAgentWhatsapp(this.key, {
        to: this.waTestTo(),
        template_name: trig?.template_name || 'pi_dispatch_confirmation_v2',
        sid: wa.sid,
        sender_number: wa.sender_number,
        body: this.waPreviewText(),
      });
      this.waTestResult.set(r);
      this.say(`Test WhatsApp sent via Kaleyra (${r.message_id})`);
    } catch (e: any) {
      this.error.set(e.message || 'Could not send test WhatsApp');
    } finally {
      this.waTestBusy.set(false);
    }
  }
  fieldList(v: any): string { return (v?.fields || []).map((f: any) => f.key).join(', ') || 'no fields yet'; }
  // ── Voice and brain presets ───────────────────────────────────────────────
  engine = computed(() => this.rules().engine);
  readonly LANGS = [
    ['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['hinglish', 'Hinglish'],
    ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['mr-IN', 'Marathi'], ['bn-IN', 'Bengali'],
    ['gu-IN', 'Gujarati'], ['kn-IN', 'Kannada'], ['en-US', 'English (US)'],
  ] as const;
  /** Cascade presets only (Balanced / Fast / …). Custom opens model pickers. */
  presets = computed(() => ((this.meta()?.engines?.presets || []) as any[]).filter((p) => p.key !== 'custom'));
  cascadePresets = computed(() => this.presets().filter((p: any) => (p.engine?.mode || 'pipeline') !== 's2s'));
  presetMetrics = computed(() => {
    const e = this.engine();
    if (e.mode === 's2s') return STS_METRICS[e.s2s] || STS_METRICS['gemini-3.8-live'];
    return this.presets().find((p: any) => p.key === e.preset)?.metrics || null;
  });
  /** Compact chips for the modal metrics strip. */
  metricsChips = computed(() => {
    const m = this.presetMetrics();
    if (!m) return [] as { key: string; value: string }[];
    return [
      { key: 'Latency', value: this.short(m.latency) },
      { key: 'Cost', value: this.perMin(m.cost) || this.short(m.cost) },
      { key: 'Voice', value: this.short(m.humanness) },
      { key: 'Intelligence', value: this.short((m as any).intelligence || '') },
      { key: 'Accuracy', value: this.short(m.accuracy) },
    ].filter((x) => x.value);
  });
  /** Visual 5-bar metrics with concise tag and tooltip explanation. */
  visualMetrics = computed(() => {
    const m = this.presetMetrics();
    if (!m) return [] as { key: string; tag: string; bars: number; tip: string }[];
    const score = (text: string, kind: string): number => {
      const s = String(text || '').toLowerCase();
      if (kind === 'speed') return /0\.[3-6]|fast|very low|sub/.test(s) ? 5 : /0\.[7-9]|low|balanced/.test(s) ? 4 : /1\.|moderate/.test(s) ? 3 : 3;
      if (kind === 'cost') return /0\.0[1-3]|low|rs\s*1|cheapest/.test(s) ? 5 : /0\.0[4-6]|rs\s*[2-3]|moderate/.test(s) ? 4 : /high|thinking/.test(s) ? 2 : 3;
      if (kind === 'voice') return /native|natural|3\.8|expressive/.test(s) ? 5 : /good|clear/.test(s) ? 4 : 3;
      if (kind === 'iq') return /thinking|stronger|frontier|high|best/.test(s) ? 5 : /flash|balanced|good/.test(s) ? 4 : 3;
      return /best|multi|high|india/.test(s) ? 5 : 4;
    };
    const latTag = String(m.latency || '').match(/[\d.–-]+\s*s/)?.[0] || this.short(m.latency).slice(0, 10);
    const costTag = this.perMin(m.cost) || (String(m.cost || '').toLowerCase().includes('high') ? '$$$' : '$$');
    return [
      { key: 'Speed', tag: latTag, bars: score(m.latency, 'speed'), tip: m.latency || 'Audio-to-audio response latency' },
      { key: 'Cost', tag: costTag, bars: score(m.cost, 'cost'), tip: m.cost || 'Estimated per-minute cost' },
      { key: 'Voice', tag: `${score(m.humanness, 'voice')}/5`, bars: score(m.humanness, 'voice'), tip: m.humanness || 'Voice naturalness & barge-in handling' },
      { key: 'IQ', tag: `${score((m as any).intelligence || '', 'iq')}/5`, bars: score((m as any).intelligence || '', 'iq'), tip: (m as any).intelligence || 'Reasoning & multi-step instruction following' },
      { key: 'Accuracy', tag: `${score(m.accuracy, 'acc')}/5`, bars: score(m.accuracy, 'acc'), tip: m.accuracy || 'Multilingual transcription & field accuracy' },
    ];
  });
  turnLabel = computed(() => (this.meta()?.engines?.turn_detectors || []).find((t: any) => t.id === this.engine().turn_detector)?.label || 'Model default');
  short(x: string): string { return String(x || '').split(/ \(|;| per call| · /)[0]; }
  perMin(cost?: string): string {
    const rs = cost?.match(/Rs\s*([\d.]+)/); if (rs) return `₹${rs[1]} / min`;
    const d = cost?.match(/\$\s*([\d.]+)/); return d ? `$${d[1]} / min` : '';
  }
  engineLine = computed(() => {
    const e = this.engine();
    const name = (kind: string, id?: string) => this.modelLabel(kind, id).split(' · ')[0].replace(/\s*\(.*?\)/g, '');
    return e.mode === 's2s' ? name('s2s', e.s2s) : [name('stt', e.stt), name('llm', e.llm), name('tts', e.tts)].join(' · ');
  });
  modeLabel = computed(() => this.engine().mode === 's2s' ? 'Speech to speech' : 'Cascade');
  /** Gemini Live / Vertex S2S catalogue only. */
  stsModels = computed(() => this.models('s2s').filter((m) => STS_MODEL_RE.test(m.id) || STS_MODEL_RE.test(m.label) || /google/i.test(m.vendor)));
  pickPreset(key: string): void {
    const pr = this.presets().find((x: any) => x.key === key) || (this.meta()?.engines?.presets || []).find((x: any) => x.key === key);
    this.patchEngine({ ...(key === 'custom' ? { mode: 'pipeline' as const } : { mode: 'pipeline' as const, ...(pr?.engine || {}) }), preset: key });
    this.fixVoice();
  }
  customise(): void { this.patchEngine({ preset: 'custom', mode: 'pipeline' }); }
  setMode2(mode: 's2s' | 'pipeline'): void {
    const e = this.engine();
    if (mode === 's2s') {
      const sts = this.stsModels();
      const s2s = sts.some((m) => m.id === e.s2s) ? e.s2s : (sts[0]?.id || 'gemini-3.8-live');
      this.patchEngine({
        mode: 's2s', s2s, preset: 'custom',
        language: e.language || 'en-IN', temperature: e.temperature ?? 0.4,
      });
    } else {
      const first = (k: string) => this.models(k)[0]?.id || '';
      const bal = this.cascadePresets().find((p: any) => p.key === 'balanced');
      this.patchEngine({
        mode: 'pipeline',
        ...(bal?.engine || { stt: e.stt || first('stt'), llm: e.llm || first('llm'), tts: e.tts || first('tts') }),
        preset: bal?.key || e.preset || 'balanced',
      });
    }
    this.fixVoice();
  }
  models(kind: string): { id: string; label: string; vendor: string; voices?: string[] }[] { return this.meta()?.engines?.[kind] || []; }
  modelLabel(kind: string, id: string | undefined): string { const m = this.models(kind).find((x) => x.id === id); return m ? `${m.label} · ${m.vendor}` : id || 'Not set'; }
  engineVoices = computed(() => {
    const e = this.engine();
    if (e.mode === 's2s') return this.stsModels().find((x) => x.id === e.s2s)?.voices || [];
    return this.models('tts').find((x) => x.id === e.tts)?.voices || [];
  });
  fixVoice(): void {
    const vs = this.engineVoices();
    const cur = this.settings().voice || this.engine().voice || '';
    if (vs.length && !vs.includes(cur)) {
      this.patchSettings({ voice: vs[0] });
      this.patchEngine({ voice: vs[0] });
    }
  }
  patchBehaviour(e: any): void {
    this.patchEngine({
      fallback: e.fallback, fallback_after_ms: e.fallback_after_ms, turn: e.turn,
      stt_fallback: e.stt_fallback, tts_fallback: e.tts_fallback, turn_detector: e.turn_detector,
      temperature: e.temperature, max_tokens: e.max_tokens, speed: e.speed, language: e.language,
    });
  }
  patchEngine(c: Partial<Engine>): void { this.rules.update((r) => ({ ...r, engine: { ...r.engine, ...c } })); }

  // ── More actions menu (placed on the page so it is never cut off) ────────
  /** The two settings pop-ups: voice and model, and the rarely used advanced rules. */
  voiceOpen = signal(false);
  advOpen = signal(false);
  presetLabel = computed(() => {
    const e = this.engine();
    if (e.mode === 's2s') return 'Speech to speech';
    return this.presets().find((p: any) => p.key === e.preset)?.label || (e.preset === 'custom' ? 'Custom cascade' : 'Cascade');
  });
  menuOpen = signal(false);
  menuPos = signal({ top: 0, left: 0 });
  toggleMenu(e: Event): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuPos.set({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 220, window.innerWidth - 228)) });
    this.menuOpen.set(!this.menuOpen());
  }
  @HostListener('document:click') closeMenu(): void { this.menuOpen.set(false); }
  @HostListener('window:resize') onResize(): void { this.menuOpen.set(false); }
  // Do not close the more-menu on wheel: nested editors and the sidebar need to scroll.

  syncLabelName(): string { return this.syncPlatforms().find((p) => p.platform_key === this.agent()?.synced_platform)?.label || 'the destination'; }
  targetInfo = computed(() => this.syncPlatforms().find((p) => p.platform_key === this.rules().sync_target.type) || null);
  toggleRetry(k: string, on: boolean): void {
    this.rules.update((r) => ({ ...r, retry: { ...r.retry, on: on ? [...new Set([...r.retry.on, k])] : r.retry.on.filter((x) => x !== k) } }));
  }
  toggleAnswerValue(v: string, on: boolean): void {
    const cur = this.rules().retry.answer_values;
    this.patchRetry({ answer_values: on ? [...new Set([...cur, v])] : cur.filter((x) => x !== v) });
  }
  splitList(v: string): string[] { return String(v || '').split(',').map((x) => x.trim()).filter(Boolean); }
  addLookup(): void { this.rules.update((r) => ({ ...r, lookups: [...r.lookups, blankLookup()] })); }
  patchLookup(i: number, c: any): void { this.rules.update((r) => ({ ...r, lookups: patch(r.lookups, i, c) })); }
  deleteLookup(i: number): void { this.rules.update((r) => ({ ...r, lookups: r.lookups.filter((_, k) => k !== i) })); }
  toggleLookupSend(i: number, k: string, on: boolean): void {
    const cur: string[] = this.rules().lookups[i].send || [];
    this.patchLookup(i, { send: on ? [...new Set([...cur, k])] : cur.filter((x) => x !== k) });
  }
  private syncKbFromAgent(a: any): void {
    const refs = a?.references || [];
    const fallbackUsage = {
      files: refs.filter((r: any) => (r.kind || 'file') === 'file').length,
      texts: refs.filter((r: any) => r.kind === 'text').length,
      urls: refs.filter((r: any) => r.kind === 'url').length,
    };
    const nextKb = a?.kb || {
      id: `know_${String(a?.key || 'agent').slice(0, 8)}a3a`,
      name: String(a?.label || a?.key || 'Knowledge base').replace(/\s*-\s*/, ' · ').slice(0, 44),
      status: 'ready',
      usage_30d: fallbackUsage,
    };
    this.kb.set({
      id: nextKb.id || `know_${String(this.key || 'agent').slice(0, 8)}a3a`,
      name: nextKb.name || 'Knowledge base',
      status: nextKb.status || 'ready',
      usage_30d: { ...fallbackUsage, ...(nextKb.usage_30d || {}) },
    });
  }
  patchKbName(name: string): void {
    this.kb.update((k) => ({ ...k, name }));
  }
  async copyKbId(): Promise<void> {
    const id = this.kb().id;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = id; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
    this.kbCopied.set(true);
    clearTimeout(this.kbCopyTimer);
    this.kbCopyTimer = setTimeout(() => this.kbCopied.set(false), 1500);
    this.say('Knowledge base ID copied.');
  }
  triggerKbIndexing(): void {
    this.kbIndexing.set(true);
    clearTimeout(this.kbIndexTimer);
    this.kbIndexTimer = setTimeout(() => this.kbIndexing.set(false), 1400);
  }
  openKbAdd(mode: 'text' | 'url'): void {
    this.kbEditingId.set(null);
    this.kbAddMode.set(mode);
    if (mode === 'text') {
      this.kbTextName.set('');
      this.kbTextContent.set('');
    } else {
      this.kbUrlValue.set('');
      this.kbUrlName.set('');
      this.kbUrlRefresh.set(true);
    }
  }
  closeKbForm(): void {
    this.kbAddMode.set(null);
    this.kbEditingId.set(null);
  }
  startEditKbItem(r: any): void {
    if (!r?.id) return;
    this.kbEditingId.set(r.id);
    if (r.kind === 'url') {
      this.kbAddMode.set('url');
      this.kbUrlValue.set(r.url || '');
      this.kbUrlName.set(r.name || '');
      this.kbUrlRefresh.set(!!r.auto_refresh);
    } else {
      this.kbAddMode.set('text');
      this.kbTextName.set(r.name || '');
      this.kbTextContent.set(r.content || '');
    }
  }
  async saveKbText(): Promise<void> {
    const name = this.kbTextName().trim();
    const content = this.kbTextContent().trim();
    if (!name || !content) { this.error.set('Enter both a title and text content for the snippet.'); return; }
    this.kbBusy.set(true); this.error.set('');
    try {
      const editId = this.kbEditingId();
      const res = editId
        ? await this.api.updateAgentReference(this.key, editId, { name, content })
        : await this.api.addAgentReferenceSource(this.key, { kind: 'text', name, content, scope: this.refScope() });
      this.references.set(res.agent.references || []);
      this.syncKbFromAgent(res.agent);
      this.closeKbForm();
      this.triggerKbIndexing();
      this.say(editId ? `Updated snippet "${name}".` : `Added snippet "${name}".`);
    } catch (e: any) { this.error.set(e.message || 'Could not save snippet'); }
    finally { this.kbBusy.set(false); }
  }
  async saveKbUrl(): Promise<void> {
    const url = this.kbUrlValue().trim();
    const name = this.kbUrlName().trim() || url;
    if (!/^https?:\/\/\S+/i.test(url)) { this.error.set('Enter a valid http:// or https:// URL.'); return; }
    this.kbBusy.set(true); this.error.set('');
    try {
      const editId = this.kbEditingId();
      const res = editId
        ? await this.api.updateAgentReference(this.key, editId, { url, name, auto_refresh: this.kbUrlRefresh() })
        : await this.api.addAgentReferenceSource(this.key, { kind: 'url', url, name, auto_refresh: this.kbUrlRefresh(), scope: this.refScope() });
      this.references.set(res.agent.references || []);
      this.syncKbFromAgent(res.agent);
      this.closeKbForm();
      this.triggerKbIndexing();
      this.say(editId ? `Updated URL source.` : `Crawling URL source.`);
    } catch (e: any) { this.error.set(e.message || 'Could not save URL source'); }
    finally { this.kbBusy.set(false); }
  }
  async refreshKbUrl(r: any): Promise<void> {
    if (!r?.id) return;
    this.error.set('');
    try {
      const res = await this.api.updateAgentReference(this.key, r.id, { auto_refresh: r.auto_refresh });
      this.references.set(res.agent.references || []);
      this.syncKbFromAgent(res.agent);
      this.triggerKbIndexing();
      this.say(`Re-crawling ${r.name || r.url}…`);
    } catch (e: any) { this.error.set(e.message || 'Could not refresh URL'); }
  }
  async addReference(file?: File): Promise<void> {
    if (!file) return;
    try {
      const r = await this.api.addAgentReference(this.key, file, this.refScope());
      this.references.set(r.agent.references || []);
      this.syncKbFromAgent(r.agent);
      this.triggerKbIndexing();
      this.say(`${file.name} added. The agent can search it on calls.`);
    }
    catch (e: any) { this.error.set(e.message); }
  }
  async removeReference(id: string): Promise<void> {
    try {
      const r = await this.api.removeAgentReference(this.key, id);
      this.references.set(r.agent.references || []);
      this.syncKbFromAgent(r.agent);
    }
    catch (e: any) { this.error.set(e.message); }
  }
  saveAgentPii(categories: string[]): void {
    this.patchRules({ pii_config: { inherit: false, categories } });
    this.safetyModal.set(null);
  }
  resetAgentPii(): void {
    this.patchRules({ pii_config: { inherit: true, categories: [...DEFAULT_PII_CATEGORIES] } });
  }
  saveAgentGuardrails(cfg: GuardrailsConfig): void {
    this.patchRules({ guardrails: { inherit: false, input: cfg.input, output: cfg.output } });
    this.safetyModal.set(null);
  }
  resetAgentGuardrails(): void {
    this.patchRules({ guardrails: { inherit: true, input: [...DEFAULT_GUARDRAILS.input], output: [...DEFAULT_GUARDRAILS.output] } });
  }
  saveGoalConfig(cfg: GoalConfig): void {
    this.patchRules({ goal_config: structuredClone(cfg) });
    this.goalsOpen.set(false);
    this.say('Goal rules updated — click Save to apply live.');
  }


  private say(msg: string): void {
    this.toast.set(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 3200);
  }
}

function pickSync(a: any) {
  return { synced_platform: a.synced_platform, sync_status: a.sync_status, sync_last_error: a.sync_last_error, synced_at: a.synced_at, updated_at: a.updated_at };
}
