import { Component, inject, signal, computed, OnInit, OnDestroy, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';
import { ConfirmComponent } from '../../components/confirm/confirm.component';
import { PromptPreviewComponent } from './prompt-preview.component';
import { mergeFieldLines } from '../../utils/merge-fields';
import { toDoc, fromDoc } from '../../utils/prompt-doc';
import { fmtAgo } from '../../utils/format';

const IN_COLS = '1.4fr 130px 130px 1.4fr 90px 36px';
const OUT_COLS = '1fr 1fr 110px 1.2fr 1.4fr 50px 36px';

const blankInput = () => ({ key: '', sample: '', type: 'string', transform: '', share_on_call: true });
const blankOutput = () => ({ key: '', label: '', description: '', type: 'string', options: [], required: true });
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

/**
 * Agent editor.
 *
 * Everything on the page (prompt, call data, answers, settings) is one draft with
 * one Save. The old editor had a save per tab and reloaded the agent after each,
 * which replaced unsaved prompt text with the stored copy. Now nothing reloads
 * until every changed part is saved, and leaving with changes asks first.
 *
 * The prompt can be edited as blocks (sections) or as one document (Full). Both
 * edit the same list of sections; see utils/prompt-doc.ts.
 */
@Component({
  selector: 'app-agent-detail',
  standalone: true,
  imports: [FormsModule, IconComponent, PromptPreviewComponent, ConfirmComponent],
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
  tab = signal<'prompt' | 'inputs' | 'outputs'>('prompt');
  mode = signal<'blocks' | 'full'>(this.savedMode());
  error = signal('');
  toast = signal('');
  busy = signal(false);

  sections = signal<any[]>([]);
  doc = signal('');
  generated = signal<any>({});
  generatedError = signal('');
  preview = signal<any>(null);
  copied = signal<number | null>(null);
  private copiedTimer: any = null;
  private toastTimer: any = null;

  inputs = signal<any[]>([]);
  outputs = signal<any[]>([]);
  settings = signal<Settings>({ label: '', description: '', voice: '', ozonetel_campaign: '', primary_id_key: '' });
  oznCampaigns = signal<any[]>([]);
  syncPlatforms = signal<{ platform_key: string; label: string }[]>([]);

  confirmDelete = signal(false);
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
    return parts;
  });
  dirty = computed(() => this.changes().length > 0);

  checklist = computed(() => {
    const promptChars = this.sections().filter(s => s.enabled !== false && s.kind === 'text').reduce((n, s) => n + (s.body || '').trim().length, 0);
    return [
      { label: 'Prompt', ok: promptChars > 0 },
      { label: 'Call data', ok: this.inputs().some(v => v.key) },
      { label: 'Answers', ok: this.outputs().some(v => v.key) },
      { label: 'Calls go out on', ok: !!this.settings().ozonetel_campaign },
    ];
  });

  syncLabel = computed(() => {
    const a = this.agent();
    if (!a || !this.syncPlatforms().length) return null;
    const platform = this.syncPlatforms()[0].label;
    if (a.sync_status === 'failed') return { text: `${platform}: sync failed`, cls: 'bad' };
    if (a.sync_status === 'pending') return { text: `${platform}: syncing`, cls: 'info' };
    if (!a.synced_platform) return { text: `Not in ${platform}`, cls: 'muted' };
    if (a.synced_at && a.updated_at && a.updated_at > a.synced_at) return { text: `${platform}: changes waiting`, cls: 'warn' };
    return { text: `In sync with ${platform}`, cls: 'ok' };
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.key = params.get('key') || '';
      if (this.key) { this.load(); this.loadGenerated(); }
    });
    this.api.ozonetelCampaigns(true).then(r => this.oznCampaigns.set(r.campaigns || [])).catch(() => this.oznCampaigns.set([]));
    const orgId = this.auth.currentOrgId();
    if (orgId) this.api.orgSyncPlatforms(orgId).then(p => this.syncPlatforms.set(p || [])).catch(() => this.syncPlatforms.set([]));
  }

  ngOnDestroy(): void { clearTimeout(this.toastTimer); clearTimeout(this.copiedTimer); }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) { e.preventDefault(); e.returnValue = ''; }
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (this.dirty()) this.save(); }
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
      this.doc.set(toDoc(this.sections()));
      this.saved.set(JSON.stringify(this.draft()));
      this.error.set('');
    } catch (e: any) { this.error.set(e.message); }
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
    return { sections, inputs: this.inputs(), outputs: this.outputs(), settings: this.settings() };
  }

  async save(): Promise<void> {
    if (this.busy()) return;
    const parts = this.changes();
    if (!parts.length) return;
    const d = this.draft();
    this.busy.set(true); this.error.set('');
    try {
      // Variables first, so the prompt's generated blocks are built from the new ones.
      if (parts.includes('call data')) await this.api.saveAgentInputs(this.key, d.inputs);
      if (parts.includes('answers')) await this.api.saveAgentOutputs(this.key, d.outputs);
      if (parts.includes('prompt')) await this.api.saveAgentSections(this.key, d.sections);
      if (parts.includes('settings')) {
        const s = d.settings;
        await this.api.updateAgent(this.key, {
          label: s.label.trim() || this.agent().label, description: s.description, voice: s.voice,
          ozonetel_campaign: s.ozonetel_campaign,
          ozonetel_type: this.oznCampaigns().find(c => c.name === s.ozonetel_campaign)?.type || '',
          primary_id_key: s.primary_id_key, primary_id_label: s.primary_id_key,
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
    this.doc.set(toDoc(was.sections));
    this.say('Changes discarded.');
  }

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
    this.busy.set(true);
    try {
      const a = this.agent();
      const out = await this.api.createAgent({
        label: `${a.label} (copy)`, description: a.description || '', copy_from: this.key,
        ozonetel_campaign: a.ozonetel_campaign || '', ozonetel_type: a.ozonetel_type || '',
      });
      this.router.navigate(['/agents', out.agent.key]);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }

  async syncNow(): Promise<void> {
    const p = this.syncPlatforms()[0];
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
  deleteOutput(i: number): void { this.outputs.update(v => v.filter((_, idx) => idx !== i)); }
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

  private say(msg: string): void {
    this.toast.set(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 3200);
  }
}

function pickSync(a: any) {
  return { synced_platform: a.synced_platform, sync_status: a.sync_status, sync_last_error: a.sync_last_error, synced_at: a.synced_at, updated_at: a.updated_at };
}
