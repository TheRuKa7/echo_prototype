import { Component, inject, signal, computed, OnInit, effect } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { PromptPreviewComponent } from './prompt-preview.component';
import { mergeFieldLines } from '../../utils/merge-fields';

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

@Component({
  selector: 'app-agent-detail',
  standalone: true,
  imports: [FormsModule, IconComponent, PromptPreviewComponent],
  templateUrl: './agent-detail.component.html',
})
export class AgentDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  key = '';
  IN_COLS = IN_COLS;
  OUT_COLS = OUT_COLS;
  /** Matches VOICE_AGENT_VOICE in the backend — what an empty selection resolves to. */
  DEFAULT_VOICE = 'Aoede';

  agent = signal<any>(null);
  meta = signal<any>(null);
  tab = signal<'prompt' | 'inputs' | 'outputs'>('prompt');
  error = signal('');
  saved = signal('');
  busy = signal(false);

  sections = signal<any[]>([]);
  voice = signal('');
  generated = signal<any>({});
  generatedError = signal('');
  preview = signal<any>(null);
  /** Index of the section whose Copy button just fired, for transient feedback. */
  copied = signal<number | null>(null);
  private copiedTimer: any = null;

  inputs = signal<any[]>([]);
  outputs = signal<any[]>([]);
  oznCampaigns = signal<any[]>([]);

  /**
   * Gemini's voices, each labelled with its gender, default first.
   *
   * The provider is no longer an operator choice, so listing every provider's
   * voices offered names that would silently fall back to the default if picked
   * (a voice is only valid for its own provider).
   */
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

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.key = params.get('key') || '';
      if (this.key) { this.load(); this.loadGenerated(); }
    });
    this.api.ozonetelCampaigns(true)
      .then(r => this.oznCampaigns.set(r.campaigns || []))
      .catch(() => this.oznCampaigns.set([]));
  }

  async load(): Promise<void> {
    try {
      const [d, m] = await Promise.all([this.api.agentDetail(this.key), this.api.agentMeta()]);
      this.agent.set(d.agent);
      this.meta.set(m);
      this.inputs.set(d.agent.input_variables || []);
      this.outputs.set(d.agent.output_variables || []);
      this.sections.set(d.agent.sections || []);
      this.voice.set(d.agent.voice || '');
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

  async runTask(fn: () => Promise<any>, msg: string): Promise<void> {
    this.busy.set(true); this.error.set('');
    try {
      await fn();
      await this.load();
      this.saved.set(msg);
      setTimeout(() => this.saved.set(''), 3000);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }

  /**
   * Save one agent field that applies immediately (voice, dial route, primary id).
   *
   * Deliberately does not call load(). Those controls sit on the same screen as
   * the prompt editor, and reloading would replace `sections` with the stored
   * copy — silently discarding whatever the operator was part-way through
   * typing. Only the agent header is refreshed, from the response.
   */
  private async saveSetting(fn: () => Promise<any>, msg: string): Promise<void> {
    this.busy.set(true); this.error.set('');
    try {
      const out = await fn();
      if (out?.agent) this.agent.set(out.agent);
      this.saved.set(msg);
      setTimeout(() => this.saved.set(''), 3000);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }

  async showPreview(): Promise<void> {
    this.error.set('');
    try { this.preview.set(await this.api.previewAgentPrompt(this.key, { sections: this.sections() })); }
    catch (e: any) { this.error.set(e.message); this.preview.set(null); }
  }

  async remove(): Promise<void> {
    if (!window.confirm(`Delete "${this.agent().label}"? This cannot be undone.`)) return;
    try {
      const out = await this.api.deleteAgent(this.key);
      if (out.note) window.alert(out.note);
      this.router.navigate(['/agents']);
    } catch (e: any) { this.error.set(e.message); }
  }

  goBack(): void { this.router.navigate(['/agents']); }

  // Section tools
  patchSection(i: number, changes: any): void { this.sections.update(s => patch(s, i, changes)); }
  moveSection(i: number, dir: number): void { this.sections.update(s => move(s, i, i + dir)); }
  deleteSection(i: number): void { this.sections.update(s => s.filter((_, idx) => idx !== i)); }
  addSection(kind: string, title: string): void {
    this.sections.update(s => [...s, { ...blankSection(), kind, title: title || '' }]);
  }
  /** What this section contributes to the prompt: the override, else the generated text. */
  sectionText(sec: any): string {
    const body = (sec.body || '').trim();
    if (body) return body;
    // An empty input/output section renders from the generator, shown in the UI as a
    // placeholder — copying "" would hand back nothing for the text actually in use.
    return (sec.kind === 'input' || sec.kind === 'output') ? (this.generated()[sec.kind] || '') : '';
  }

  async copySection(i: number, sec: any): Promise<void> {
    const text = this.sectionText(sec);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API needs a secure context; over plain http it rejects. Fall back
      // to the old selection trick so the button still works on a LAN address.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
    this.copied.set(i);
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(null), 1400);
  }

  async refreshSection(i: number, sec: any, overridden: boolean): Promise<void> {
    const fresh = await this.loadGenerated();
    if (!overridden || !fresh?.[sec.kind]) return;
    // Merge rather than replace: add and remove field lines to match the current
    // variables, and leave the operator's wording and prose alone.
    this.patchSection(i, { body: mergeFieldLines(sec.body || '', fresh[sec.kind]) });
  }

  // Inputs/Outputs tools
  patchInput(i: number, changes: any): void { this.inputs.update(v => patch(v, i, changes)); }
  deleteInput(i: number): void { this.inputs.update(v => v.filter((_, idx) => idx !== i)); }
  addInput(): void { this.inputs.update(v => [...v, blankInput()]); }
  
  patchOutput(i: number, changes: any): void { this.outputs.update(v => patch(v, i, changes)); }
  deleteOutput(i: number): void { this.outputs.update(v => v.filter((_, idx) => idx !== i)); }
  addOutput(): void { this.outputs.update(v => [...v, blankOutput()]); }
  setOptions(i: number, val: string): void {
    this.patchOutput(i, { options: val.split(',').map(s => s.trim()).filter(Boolean) });
  }

  /** True for the two blocks built from the variable declarations. */
  isGenerated(sec: any): boolean { return sec.kind === 'input' || sec.kind === 'output'; }

  /** What the textarea shows: the override, or the generated text as real, editable content. */
  sectionValue(sec: any): string {
    return sec.body || (this.isGenerated(sec) ? (this.generated()[sec.kind] || '') : '');
  }

  savePrompt(): void {
    // A generated section left exactly as generated is stored empty, not as a copy.
    // Otherwise merely opening the editor would freeze today's text into the prompt,
    // and the block would stop tracking the variables it is built from.
    const sections = this.sections().map(sec => {
      if (!this.isGenerated(sec)) return sec;
      const body = (sec.body || '').trim();
      const asGenerated = (this.generated()[sec.kind] || '').trim();
      return body && body === asGenerated ? { ...sec, body: '' } : sec;
    });
    this.runTask(() => this.api.saveAgentSections(this.key, sections), 'Prompt saved — live on the next call, no restart.');
  }

  /** Applies on its own, like the other agent settings — no Save press needed. */
  updateVoice(val: string): void {
    this.voice.set(val);
    this.saveSetting(
      () => this.api.updateAgent(this.key, { voice: val }),
      val ? `Voice set to ${val}.` : 'Voice reset to the default.',
    );
  }
  saveInputs(): void { this.runTask(() => this.api.saveAgentInputs(this.key, this.inputs()), 'Input variables saved.'); }
  saveOutputs(): void { this.runTask(() => this.api.saveAgentOutputs(this.key, this.outputs()), 'Output variables saved.'); }

  updateOzonetel(val: string): void {
    const type = this.oznCampaigns().find(c => c.name === val)?.type || '';
    this.saveSetting(
      () => this.api.updateAgent(this.key, { ozonetel_campaign: val, ozonetel_type: type }),
      val ? `Calls will be queued on "${val}".` : 'Ozonetel mapping cleared.',
    );
  }

  updatePrimaryId(val: string): void {
    // Inputs no longer carry an editable label, so the key is the only name there
    // is. Sent as both so the campaign export header stays populated.
    this.saveSetting(
      () => this.api.updateAgent(this.key, { primary_id_key: val, primary_id_label: val }),
      'Primary id updated.',
    );
  }
}
