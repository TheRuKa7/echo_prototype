import { ChangeDetectionStrategy, Component, HostListener, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../components/icon/icon.component';
import {
  FUNCTION_ARRAY_TYPES,
  FUNCTION_JSON_EXAMPLES,
  FUNCTION_PRIMITIVE_TYPES,
  HTTP_METHODS,
  WEBHOOK_EVENTS,
  fieldsToJson,
  jsonToFields,
} from './tool-models';

export type ToolModalMode = 'builtin' | 'custom' | 'code' | 'webhook' | 'mcp' | null;

@Component({
  selector: 'app-tool-modals',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mode(); as m) {
      @if (draft(); as d) {
        <div class="modal-backdrop" (click)="close.emit()">
          <div
            class="modal agent-modal tm-modal"
            [class.tm-wide]="m === 'code'"
            [class.tm-mid]="m === 'custom' || m === 'mcp'"
            [class.tm-sm]="m === 'builtin' || m === 'webhook'"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="modalTitle()"
            (click)="$event.stopPropagation()"
          >
            <div class="modal-head">
              <div class="tm-title-wrap">
                <app-icon [name]="modalIcon()" [size]="17"></app-icon>
                <div class="modal-title">{{ modalTitle() }}</div>
              </div>
              <button type="button" class="btn-icon" aria-label="Close" (click)="close.emit()"><app-icon name="close" [size]="16"></app-icon></button>
            </div>

            <div class="modal-body tm-body">
              @if (m === 'builtin') {
                <label class="field">
                  <span class="field-label">Name</span>
                  <input class="input" [ngModel]="d.name || ''" (ngModelChange)="patch({ name: $event })" placeholder="end_call" aria-label="Function name" />
                </label>

                <label class="field">
                  <span class="field-label">Description <span class="tm-muted">(Optional)</span></span>
                  <textarea class="input tm-ta" rows="3" [ngModel]="d.description || ''" (ngModelChange)="patch({ description: $event })" placeholder="Describe when to call this built-in function" aria-label="Function description"></textarea>
                </label>

                <div class="field">
                  <span class="field-label">Custom SIP Headers</span>
                  <small class="tm-sub">Add key/value pairs for call routing, metadata, or carrier integration.</small>
                  <div class="tm-kv-list">
                    @for (kv of d.sip_headers || []; track $index; let i = $index) {
                      <div class="tm-kv-row">
                        <input class="input mono" [ngModel]="kv.key" (ngModelChange)="patchKv('sip_headers', i, 'key', $event)" placeholder="X-Custom-Header-Name" aria-label="SIP header name" />
                        <input class="input mono" [ngModel]="kv.value" (ngModelChange)="patchKv('sip_headers', i, 'value', $event)" placeholder="Value" aria-label="SIP header value" />
                        <button type="button" class="btn-icon" (click)="removeKv('sip_headers', i)" aria-label="Remove SIP header"><app-icon name="trash" [size]="14"></app-icon></button>
                      </div>
                    }
                  </div>
                  <button type="button" class="btn btn-sm tm-add-btn" (click)="addKv('sip_headers')"><app-icon name="plus" [size]="12"></app-icon> Add</button>
                </div>

                <label class="tm-check-card">
                  <input type="checkbox" [checked]="!!d.talk_while_waiting" (change)="patch({ talk_while_waiting: $any($event.target).checked })" aria-label="Talk while waiting" />
                  <span>
                    <b>Talk While Waiting</b>
                    <small>Enable to say a short phrase to fill the silence, like "let me look that up for you."</small>
                  </span>
                </label>
              }

              @if (m === 'custom') {
                <label class="field">
                  <span class="field-label">Name</span>
                  <input class="input" [ngModel]="d.name || ''" (ngModelChange)="patch({ name: $event })" placeholder="Name of the custom function" aria-label="Custom function name" />
                </label>

                <label class="field">
                  <span class="field-label">Description</span>
                  <textarea class="input tm-ta" rows="2" [ngModel]="d.description || ''" (ngModelChange)="patch({ description: $event })" placeholder="Describe what this function does and when the agent should call it. Type {{ to add dynamic variables." aria-label="Custom function description"></textarea>
                </label>

                <div class="field">
                  <span class="field-label">API Endpoint</span>
                  <div class="tm-endpoint">
                    <select class="select tm-method" [ngModel]="d.method || 'POST'" (ngModelChange)="patch({ method: $event })" aria-label="HTTP method">
                      @for (hm of HTTP_METHODS; track hm) { <option [value]="hm">{{ hm }}</option> }
                    </select>
                    <input class="input mono tm-url" [ngModel]="d.url || ''" (ngModelChange)="patch({ url: $event })" placeholder="URL of the custom function. Type {{ to add dynamic variables." aria-label="API endpoint URL" />
                  </div>
                </div>

                <div class="ra-two">
                  <label class="field">
                    <span class="field-label">Timeout</span>
                    <div class="tm-suffix-wrap">
                      <input class="input" type="number" min="1" max="300" [ngModel]="d.timeout_s ?? 120" (ngModelChange)="patch({ timeout_s: +$event || 120 })" aria-label="Timeout seconds" />
                      <span class="tm-suffix">sec</span>
                    </div>
                  </label>
                  <label class="field">
                    <span class="field-label">Max retries</span>
                    <input class="input" type="number" min="0" max="5" [ngModel]="d.max_retries ?? 0" (ngModelChange)="patch({ max_retries: Math.max(0, +$event || 0) })" aria-label="Max retries" />
                  </label>
                </div>

                <div class="field">
                  <span class="field-label">Header</span>
                  <div class="tm-kv-list">
                    @for (kv of d.headers || []; track $index; let i = $index) {
                      <div class="tm-kv-row">
                        <input class="input mono" [ngModel]="kv.key" (ngModelChange)="patchKv('headers', i, 'key', $event)" [placeholder]="'e.g. X-{{header_name}}'" aria-label="Header key" />
                        <input class="input mono" [ngModel]="kv.value" (ngModelChange)="patchKv('headers', i, 'value', $event)" [placeholder]="'e.g. Bearer {{api_key}}'" aria-label="Header value" />
                        <button type="button" class="btn-icon" (click)="removeKv('headers', i)" aria-label="Remove header"><app-icon name="trash" [size]="14"></app-icon></button>
                      </div>
                    }
                  </div>
                  <button type="button" class="btn btn-sm tm-add-btn" (click)="addKv('headers')"><app-icon name="plus" [size]="12"></app-icon> Add</button>
                </div>

                <div class="field">
                  <span class="field-label">Query Parameters</span>
                  <div class="tm-kv-list">
                    @for (kv of d.query_params || []; track $index; let i = $index) {
                      <div class="tm-kv-row">
                        <input class="input mono" [ngModel]="kv.key" (ngModelChange)="patchKv('query_params', i, 'key', $event)" placeholder="e.g. user_id" aria-label="Query parameter key" />
                        <input class="input mono" [ngModel]="kv.value" (ngModelChange)="patchKv('query_params', i, 'value', $event)" [placeholder]="'e.g. {{customer_phone}}'" aria-label="Query parameter value" />
                        <button type="button" class="btn-icon" (click)="removeKv('query_params', i)" aria-label="Remove query parameter"><app-icon name="trash" [size]="14"></app-icon></button>
                      </div>
                    }
                  </div>
                  <button type="button" class="btn btn-sm tm-add-btn" (click)="addKv('query_params')"><app-icon name="plus" [size]="12"></app-icon> Add</button>
                </div>

                <div class="field">
                  <div class="tm-row-between">
                    <span class="field-label">Function fields</span>
                    <span class="tm-muted" style="font-size:11.5px">JSON Schema parameters &amp; response extraction</span>
                  </div>
                  <div class="tm-fields-box">
                    <div class="tm-tabs-head" role="tablist" aria-label="Function schema sections">
                      <button type="button" role="tab" [class.on]="fnTab() === 'input'" [attr.aria-selected]="fnTab() === 'input'" (click)="fnTab.set('input')">Input</button>
                      <button type="button" role="tab" [class.on]="fnTab() === 'output'" [attr.aria-selected]="fnTab() === 'output'" (click)="fnTab.set('output')">Output</button>
                    </div>

                    @if (fnTab() === 'input') {
                      <div class="tm-in-toolbar">
                        <div class="seg" role="group" aria-label="Input editor mode">
                          <button type="button" [class.on]="(d.input_mode || 'form') === 'form'" [attr.aria-pressed]="(d.input_mode || 'form') === 'form'" (click)="setCustomInputMode('form')">Form</button>
                          <button type="button" [class.on]="d.input_mode === 'json'" [attr.aria-pressed]="d.input_mode === 'json'" (click)="setCustomInputMode('json')">JSON</button>
                        </div>
                        <label class="tm-payload-tog">
                          <span>Payload: args only</span>
                          <span class="switch"><input type="checkbox" [checked]="!!d.payload_args_only" (change)="patch({ payload_args_only: $any($event.target).checked })" aria-label="Payload args only" /><i></i></span>
                        </label>
                      </div>

                      @if ((d.input_mode || 'form') === 'form') {
                        <div class="tm-param-head">
                          <span>Type</span><span>Parameter name</span><span>Detail</span><span>Required</span><span></span>
                        </div>
                        <div class="tm-param-list">
                          @for (pf of d.input_fields || []; track $index; let i = $index) {
                            <div class="tm-param-row">
                              <select class="select tm-ptype" [ngModel]="pf.type" (ngModelChange)="patchParam(i, { type: $event })" aria-label="Parameter type">
                                <optgroup label="Primitives">
                                  @for (pt of PRIMITIVE_TYPES; track pt.key) { <option [value]="pt.key">{{ pt.glyph }} {{ pt.label }}</option> }
                                </optgroup>
                                <optgroup label="Array">
                                  @for (at of ARRAY_TYPES; track at.key) { <option [value]="at.key">{{ at.glyph }} {{ at.label }}</option> }
                                </optgroup>
                              </select>
                              <input class="input mono" [ngModel]="pf.name" (ngModelChange)="patchParam(i, { name: $event })" placeholder="field_name" aria-label="Parameter name" />
                              <input class="input" [ngModel]="pf.description" (ngModelChange)="patchParam(i, { description: $event })" placeholder="Description" aria-label="Parameter description" />
                              <input type="checkbox" [checked]="!!pf.required" (change)="patchParam(i, { required: $any($event.target).checked })" aria-label="Required parameter" />
                              <button type="button" class="btn-icon" (click)="removeParam(i)" aria-label="Remove parameter"><app-icon name="trash" [size]="13"></app-icon></button>
                            </div>
                          }
                        </div>
                        <div class="tm-box-acts">
                          <button type="button" class="btn btn-sm" (click)="runCustomTest()"><app-icon name="play" [size]="12"></app-icon> Run a test</button>
                          <button type="button" class="btn btn-sm" (click)="addParam()"><app-icon name="plus" [size]="12"></app-icon> Add</button>
                        </div>
                      } @else {
                        <div class="tm-json-wrap">
                          <button type="button" class="tm-json-copy" (click)="copyJson(d.input_json || '')" aria-label="Copy JSON schema">
                            <app-icon [name]="copiedJson() ? 'check' : 'copy'" [size]="13"></app-icon>
                          </button>
                          <textarea class="tm-json-ta mono" rows="10" [ngModel]="d.input_json || ''" (ngModelChange)="patch({ input_json: $event }); jsonErr.set('')" [spellcheck]="false" aria-label="JSON parameter schema"></textarea>
                        </div>
                        @if (jsonErr()) { <div class="note bad" role="alert">{{ jsonErr() }}</div> }
                        <div class="tm-json-foot">
                          <div class="tm-ex-list">
                            @for (ex of JSON_EXAMPLES; track ex.id) {
                              <button type="button" class="btn btn-sm" [class.on]="activeExample()?.id === ex.id" (click)="toggleExample(ex)">{{ ex.label }}</button>
                            }
                          </div>
                          <button type="button" class="btn btn-sm" (click)="formatCustomJson()">Format JSON</button>
                        </div>
                        @if (activeExample(); as ex) {
                          <div class="tm-ex-popover">
                            <div class="tm-ex-head">
                              <b>{{ ex.label }}</b>
                              <div style="display:flex; gap:6px">
                                <button type="button" class="btn btn-sm" (click)="copyJson(ex.json)">{{ copiedJson() ? 'Copied' : 'Copy' }}</button>
                                <button type="button" class="btn btn-sm btn-primary" (click)="applyExample(ex.json)">Use example</button>
                              </div>
                            </div>
                            <pre class="mono tm-ex-pre">{{ ex.json }}</pre>
                          </div>
                        }
                      }
                    } @else {
                      <div class="tm-out-head">
                        <span>Fields for agent context</span>
                        <span>Dynamic variable</span>
                      </div>
                      <div class="tm-out-list">
                        <div class="tm-out-row">
                          <input class="input" value="Success status" disabled aria-label="Built-in success status path" />
                          <span class="tm-dash" aria-hidden="true">—</span>
                          <input class="input" value="" disabled placeholder="Variable name (optional)" aria-label="Built-in success status variable" />
                          <span></span>
                        </div>
                        @for (om of d.output_mappings || []; track $index; let i = $index) {
                          <div class="tm-out-row">
                            <input class="input mono" [ngModel]="om.path" (ngModelChange)="patchOutMap('output_mappings', i, 'path', $event)" placeholder="Response path, e.g. data.id" aria-label="Response path" />
                            <span class="tm-dash" aria-hidden="true">—</span>
                            <input class="input mono" [ngModel]="om.variable" (ngModelChange)="patchOutMap('output_mappings', i, 'variable', $event)" placeholder="Variable name, e.g. order_id" aria-label="Dynamic variable name" />
                            <button type="button" class="btn-icon" (click)="removeOutMap('output_mappings', i)" aria-label="Remove mapping"><app-icon name="trash" [size]="13"></app-icon></button>
                          </div>
                        }
                      </div>
                      <div class="tm-box-acts">
                        <button type="button" class="btn btn-sm" (click)="runCustomTest()"><app-icon name="play" [size]="12"></app-icon> Run a test</button>
                        <button type="button" class="btn btn-sm" (click)="addOutMap('output_mappings')"><app-icon name="plus" [size]="12"></app-icon> Add</button>
                      </div>
                    }

                    @if (customTestOut(); as res) {
                      <div class="tm-test-out" role="status">
                        <b>{{ res.status }}</b>
                        <pre class="mono">{{ res.body }}</pre>
                      </div>
                    }
                  </div>
                </div>

                <div class="field">
                  <span class="field-label">Execution mode</span>
                  <div class="tm-exec">
                    <label class="tm-radio">
                      <input type="radio" name="fnExec" value="wait" [checked]="(d.execution_mode || 'wait') === 'wait'" (change)="patch({ execution_mode: 'wait' })" />
                      <span>
                        <b>Wait for completion</b>
                        <small>The agent waits for the function to finish, then responds to the user.</small>
                      </span>
                    </label>
                    @if ((d.execution_mode || 'wait') === 'wait') {
                      <div class="tm-wait-opts">
                        <label class="tm-sub-check">
                          <input type="checkbox" [checked]="!!d.talk_while_waiting" (change)="patch({ talk_while_waiting: $any($event.target).checked })" />
                          <span><b>Talk while waiting</b><small>Enable to say a short phrase to fill the silence, like "let me look that up for you".</small></span>
                        </label>
                        <label class="tm-sub-check">
                          <input type="checkbox" [checked]="!!d.play_typing_sound" (change)="patch({ play_typing_sound: $any($event.target).checked })" />
                          <span><b>Play typing sound</b><small>Play a subtle typing sound while the function is processing to indicate activity.</small></span>
                        </label>
                      </div>
                    }
                    <label class="tm-radio">
                      <input type="radio" name="fnExec" value="async" [checked]="d.execution_mode === 'async'" (change)="patch({ execution_mode: 'async' })" />
                      <span>
                        <b>Run in background (async)</b>
                        <small>The agent continues the conversation without waiting for the function to finish.</small>
                      </span>
                    </label>
                  </div>
                </div>
              }

              @if (m === 'code') {
                <div class="tm-code-grid">
                  <div class="tm-code-left">
                    <div class="tm-code-head">
                      <b>Code Editor</b>
                      <div style="display:flex; align-items:center; gap:8px; position:relative">
                        <button type="button" class="btn btn-sm" (click)="dvMenuOpen.set(!dvMenuOpen())" [attr.aria-expanded]="dvMenuOpen()">
                          <span class="mono">{{ '{}' }}</span> Dynamic Variables
                        </button>
                        @if (dvMenuOpen()) {
                          <div class="row-menu-list tm-dv-menu" role="menu">
                            @for (v of dynamicVars(); track v) {
                              <button type="button" role="menuitem" (click)="insertDvIntoCode(v)">dv.{{ v }}</button>
                            } @empty {
                              <button type="button" role="menuitem" (click)="insertDvIntoCode('po_number')">dv.po_number</button>
                            }
                          </div>
                        }
                        <span class="mono tm-muted" style="font-size:11px">{{ (d.code || '').length }} / 20,000</span>
                      </div>
                    </div>
                    <textarea
                      class="tm-code-ta mono"
                      [ngModel]="d.code || ''"
                      (ngModelChange)="patch({ code: ($event || '').slice(0, 20000) })"
                      [spellcheck]="false"
                      aria-label="JavaScript code editor"
                    ></textarea>
                    @if (codeRunOut(); as cr) {
                      <div class="tm-test-out" role="status">
                        <b>{{ cr.status }}</b>
                        @if (cr.logs.length) {
                          <div class="mono" style="font-size:11px; margin-bottom:4px">console: {{ cr.logs.join(' | ') }}</div>
                        }
                        <pre class="mono">{{ cr.returned }}</pre>
                      </div>
                    }
                  </div>

                  <div class="tm-code-right">
                    <label class="field">
                      <span class="field-label">Name</span>
                      <input class="input" [ngModel]="d.name || ''" (ngModelChange)="patch({ name: $event })" placeholder="Enter function name" aria-label="Code tool name" />
                    </label>

                    <label class="field">
                      <span class="field-label">Description</span>
                      <textarea class="input tm-ta" rows="3" [ngModel]="d.description || ''" (ngModelChange)="patch({ description: $event })" placeholder="Enter function description. Type {{ to add dynamic variables." aria-label="Code tool description"></textarea>
                    </label>

                    <div class="field">
                      <div class="tm-row-between">
                        <span class="field-label">Timeout</span>
                        <span class="mono" style="font-size:12px">{{ d.timeout_s ?? 30 }}s</span>
                      </div>
                      <small class="tm-sub">Execution Timeout (30s default). The process will terminate if it exceeds this limit.</small>
                      <input type="range" min="5" max="60" step="1" [ngModel]="d.timeout_s ?? 30" (ngModelChange)="patch({ timeout_s: +$event })" aria-label="Code execution timeout seconds" />
                    </div>

                    <div class="field">
                      <span class="field-label">Execution mode</span>
                      <div class="tm-exec">
                        <label class="tm-radio">
                          <input type="radio" name="codeExec" value="wait" [checked]="(d.execution_mode || 'wait') === 'wait'" (change)="patch({ execution_mode: 'wait' })" />
                          <span><b>Wait for completion</b><small>The agent waits for the code to finish, then responds to the user.</small></span>
                        </label>
                        @if ((d.execution_mode || 'wait') === 'wait') {
                          <div class="tm-wait-opts">
                            <label class="tm-sub-check">
                              <input type="checkbox" [checked]="!!d.talk_while_waiting" (change)="patch({ talk_while_waiting: $any($event.target).checked })" />
                              <span><b>Talk while waiting</b><small>Say a short phrase to fill the silence, like "let me look that up for you."</small></span>
                            </label>
                            <label class="tm-sub-check">
                              <input type="checkbox" [checked]="!!d.play_typing_sound" (change)="patch({ play_typing_sound: $any($event.target).checked })" />
                              <span><b>Play typing sound</b><small>Play a subtle typing sound while processing to indicate activity.</small></span>
                            </label>
                          </div>
                        }
                        <label class="tm-radio">
                          <input type="radio" name="codeExec" value="async" [checked]="d.execution_mode === 'async'" (change)="patch({ execution_mode: 'async' })" />
                          <span><b>Run in background (async)</b><small>The agent continues the conversation without waiting for the code to finish.</small></span>
                        </label>
                      </div>
                    </div>

                    <div class="field">
                      <span class="field-label">Store Fields as Variables</span>
                      <small class="tm-sub">Extract values from tool response and store as dynamic variables.</small>
                      <div class="tm-kv-list">
                        @for (sf of d.store_fields || []; track $index; let i = $index) {
                          <div class="tm-kv-row">
                            <input class="input mono" [ngModel]="sf.variable" (ngModelChange)="patchOutMap('store_fields', i, 'variable', $event)" placeholder="Variable name (optional)" aria-label="Variable name" />
                            <input class="input mono" [ngModel]="sf.path" (ngModelChange)="patchOutMap('store_fields', i, 'path', $event)" placeholder="Response path (e.g. result)" aria-label="Return path" />
                            <button type="button" class="btn-icon" (click)="removeOutMap('store_fields', i)" aria-label="Remove variable mapping"><app-icon name="trash" [size]="13"></app-icon></button>
                          </div>
                        }
                      </div>
                      <button type="button" class="btn btn-sm tm-add-btn" (click)="addOutMap('store_fields')"><app-icon name="plus" [size]="12"></app-icon> New key value pair</button>
                    </div>

                    <button type="button" class="btn btn-primary tm-run-code" (click)="runCodeDryRun()">
                      <app-icon name="play" [size]="13"></app-icon> Run Code
                    </button>
                  </div>
                </div>
              }

              @if (m === 'webhook') {
                <div class="field">
                  <span class="field-label">Agent Level Webhook URL</span>
                  <small class="tm-sub">Webhook URL to receive call lifecycle events from Echo.</small>
                  <div class="tm-wh-url">
                    <input class="input mono" [ngModel]="d.url || ''" (ngModelChange)="patch({ url: $event })" placeholder="Type {{ to add dynamic variables" aria-label="Webhook URL" />
                    <button type="button" class="btn" [disabled]="!d.url?.trim()" (click)="runWebhookTest()">Test</button>
                  </div>
                  @if (webhookTestOut(); as wt) {
                    <div class="note good" role="status">{{ wt }}</div>
                  }
                </div>

                <div class="field">
                  <div class="tm-row-between">
                    <span class="field-label">Webhook Timeout</span>
                    <span class="mono" style="font-size:12px">{{ d.timeout_s ?? 5 }} s</span>
                  </div>
                  <small class="tm-sub">Set the maximum time to wait for a webhook response before timing out.</small>
                  <input type="range" min="1" max="30" step="1" [ngModel]="d.timeout_s ?? 5" (ngModelChange)="patch({ timeout_s: +$event })" aria-label="Webhook timeout seconds" />
                </div>

                <div class="field">
                  <span class="field-label">Webhook Events</span>
                  <small class="tm-sub">Choose which events this webhook should receive ({{ (d.events || []).length }} selected).</small>
                  @if ((d.events || []).length) {
                    <div class="tm-ev-pills">
                      @for (ev of d.events; track ev) { <span class="tag">{{ eventLabel(ev) }}</span> }
                    </div>
                  }
                  <button type="button" class="btn tm-setup-btn" (click)="openEventsModal()">
                    <app-icon name="settings" [size]="14"></app-icon> Set Up
                  </button>
                </div>
              }

              @if (m === 'mcp') {
                <div class="field">
                  <span class="field-label">MCP</span>
                  <small class="tm-sub">Add the MCP server to your workspace by pasting the configuration details below.</small>
                  <div class="ra-two">
                    <input class="input" [ngModel]="d.name || ''" (ngModelChange)="patch({ name: $event })" placeholder="Enter the name of the MCP" aria-label="MCP name" />
                    <div class="tm-eye-wrap">
                      <input class="input mono" [type]="showMcpUrl() ? 'text' : 'password'" [ngModel]="d.url || ''" (ngModelChange)="patch({ url: $event })" placeholder="Enter the URL of the MCP" aria-label="MCP URL" />
                      <button type="button" class="btn-icon tm-eye-btn" (click)="showMcpUrl.set(!showMcpUrl())" [attr.aria-label]="showMcpUrl() ? 'Hide URL' : 'Show URL'">
                        <app-icon [name]="showMcpUrl() ? 'eye' : 'eyeOff'" [size]="14"></app-icon>
                      </button>
                    </div>
                  </div>
                </div>

                <label class="field">
                  <span class="field-label">Timeout (ms)</span>
                  <div class="tm-suffix-wrap">
                    <input class="input mono" type="number" min="500" max="60000" step="500" [ngModel]="d.timeout_ms ?? 10000" (ngModelChange)="patch({ timeout_ms: +$event || 10000 })" aria-label="Timeout milliseconds" />
                    <span class="tm-suffix">milliseconds</span>
                  </div>
                </label>

                <div class="field">
                  <span class="field-label">Headers</span>
                  <small class="tm-sub">Specify the HTTP headers required for your MCP connection request.</small>
                  <div class="tm-kv-list">
                    @for (kv of d.headers || []; track $index; let i = $index) {
                      <div class="tm-kv-row">
                        <input class="input mono" [ngModel]="kv.key" (ngModelChange)="patchKv('headers', i, 'key', $event)" [placeholder]="'Key, e.g. X-{{header_name}}'" aria-label="MCP header key" />
                        <input class="input mono" [ngModel]="kv.value" (ngModelChange)="patchKv('headers', i, 'value', $event)" [placeholder]="'Value, e.g. Bearer {{api_key}}'" aria-label="MCP header value" />
                        <button type="button" class="btn-icon" (click)="removeKv('headers', i)" aria-label="Remove MCP header"><app-icon name="trash" [size]="14"></app-icon></button>
                      </div>
                    }
                  </div>
                  <button type="button" class="btn btn-sm tm-add-btn" (click)="addKv('headers')"><app-icon name="plus" [size]="12"></app-icon> New key value pair</button>
                </div>

                <div class="field">
                  <span class="field-label">Query Parameters</span>
                  <small class="tm-sub">Query string parameters to append to the URL.</small>
                  <div class="tm-kv-list">
                    @for (kv of d.query_params || []; track $index; let i = $index) {
                      <div class="tm-kv-row">
                        <input class="input mono" [ngModel]="kv.key" (ngModelChange)="patchKv('query_params', i, 'key', $event)" placeholder="Key, e.g. user_id" aria-label="MCP query parameter key" />
                        <input class="input mono" [ngModel]="kv.value" (ngModelChange)="patchKv('query_params', i, 'value', $event)" [placeholder]="'Value, e.g. {{customer_phone}}'" aria-label="MCP query parameter value" />
                        <button type="button" class="btn-icon" (click)="removeKv('query_params', i)" aria-label="Remove MCP query parameter"><app-icon name="trash" [size]="14"></app-icon></button>
                      </div>
                    }
                  </div>
                  <button type="button" class="btn btn-sm tm-add-btn" (click)="addKv('query_params')"><app-icon name="plus" [size]="12"></app-icon> New key value pair</button>
                </div>
              }
            </div>

            <div class="modal-foot">
              @if (!isNew() && m !== 'webhook') {
                <button type="button" class="btn btn-stop" (click)="remove.emit()">Delete</button>
              }
              <span style="flex:1"></span>
              <button type="button" class="btn" (click)="close.emit()">Cancel</button>
              <button type="button" class="btn btn-primary" (click)="submit()">{{ m === 'builtin' ? 'Update' : 'Save' }}</button>
            </div>
          </div>
        </div>
      }

      @if (eventsOpen()) {
        <div class="modal-backdrop tm-sub-backdrop" (click)="eventsOpen.set(false)">
          <div class="modal agent-modal tm-ev-modal" role="dialog" aria-modal="true" aria-label="Webhook Events" (click)="$event.stopPropagation()">
            <div class="modal-head">
              <div class="modal-title">Webhook Events</div>
              <button type="button" class="btn-icon" aria-label="Close" (click)="eventsOpen.set(false)"><app-icon name="close" [size]="16"></app-icon></button>
            </div>
            <div class="modal-body tm-ev-body">
              @for (ev of WEBHOOK_EVENTS; track ev.key) {
                <label class="tm-ev-check">
                  <input type="checkbox" [checked]="eventsDraft().includes(ev.key)" (change)="toggleEventDraft(ev.key, $any($event.target).checked)" />
                  <span>{{ ev.label }}</span>
                </label>
              }
            </div>
            <div class="modal-foot">
              <span style="flex:1"></span>
              <button type="button" class="btn" (click)="eventsOpen.set(false)">Cancel</button>
              <button type="button" class="btn btn-primary" (click)="saveEventsModal()">Save</button>
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .tm-modal.tm-sm { width: min(520px, 100%); max-width: none; }
    .tm-modal.tm-mid { width: min(680px, 100%); max-width: none; }
    .tm-modal.tm-wide { width: min(960px, 100%); max-width: none; }
    .tm-title-wrap { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .tm-body { display: grid; gap: 14px; }
    .tm-muted { color: var(--ds-text-muted); font-weight: 400; }
    .tm-sub { display: block; font-size: 12px; color: var(--ds-text-muted); margin: -2px 0 4px; line-height: 1.4; }
    .tm-ta { min-height: 76px; resize: vertical; line-height: 1.45; }
    .tm-row-between { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tm-kv-list { display: grid; gap: 6px; }
    .tm-kv-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px; gap: 6px; align-items: center; }
    .tm-add-btn { justify-self: start; margin-top: 2px; }
    .tm-check-card { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
    .tm-check-card b { display: block; font-size: 13px; color: var(--ds-text); }
    .tm-check-card small { display: block; font-size: 12px; color: var(--ds-text-muted); }
    .tm-endpoint { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 8px; align-items: center; }
    .tm-suffix-wrap { display: flex; align-items: stretch; }
    .tm-suffix-wrap .input { border-top-right-radius: 0; border-bottom-right-radius: 0; flex: 1 1 auto; min-width: 0; }
    .tm-suffix {
      display: inline-flex; align-items: center; padding: 0 12px;
      border: 1px solid var(--ds-border-strong); border-left: 0;
      border-radius: 0 var(--ds-r-md) var(--ds-r-md) 0;
      background: var(--ds-surface-sunken); color: var(--ds-text-muted); font-size: 12px; white-space: nowrap;
    }
    .tm-fields-box { border: 1px solid var(--ds-border); border-radius: 10px; background: var(--ds-surface); padding: 10px 12px; display: grid; gap: 10px; }
    .tm-tabs-head { display: flex; gap: 14px; border-bottom: 1px solid var(--ds-border); }
    .tm-tabs-head button {
      border: 0; background: none; padding: 6px 2px 8px; font: inherit; font-size: 13px; font-weight: 600;
      color: var(--ds-text-muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
    }
    .tm-tabs-head button.on { color: var(--ds-text); border-bottom-color: var(--ds-text); }
    .tm-in-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
    .tm-payload-tog { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ds-text-muted); cursor: pointer; }
    .tm-param-head { display: grid; grid-template-columns: 106px minmax(0, 1fr) minmax(0, 1.3fr) 56px 32px; gap: 6px; font-size: 11px; color: var(--ds-text-muted); font-weight: 600; }
    .tm-param-list, .tm-out-list { display: grid; gap: 6px; }
    .tm-param-row { display: grid; grid-template-columns: 106px minmax(0, 1fr) minmax(0, 1.3fr) 56px 32px; gap: 6px; align-items: center; }
    .tm-param-row input[type=checkbox] { justify-self: center; accent-color: var(--ds-accent); width: 16px; height: 16px; }
    .tm-ptype { padding-right: 22px; font-size: 12px; }
    .tm-box-acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .tm-json-wrap { position: relative; border-radius: 8px; overflow: hidden; background: #181c24; border: 1px solid var(--ds-border); }
    .tm-json-ta { width: 100%; border: 0; background: transparent; color: #f3f4f6; padding: 12px 42px 12px 12px; font-size: 12px; line-height: 1.5; resize: vertical; outline: none; }
    .tm-json-copy {
      position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border-radius: 6px;
      border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.08); color: #f9fafb;
      display: grid; place-items: center; cursor: pointer;
    }
    .tm-json-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
    .tm-ex-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .tm-ex-list button.on { border-color: var(--ds-accent); color: var(--ds-accent-fg); background: var(--ds-accent-soft); }
    .tm-ex-popover { border: 1px solid var(--ds-border); border-radius: 8px; padding: 10px; background: var(--ds-surface-sunken); display: grid; gap: 8px; }
    .tm-ex-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tm-ex-pre { margin: 0; font-size: 11.5px; line-height: 1.45; overflow: auto; max-height: 180px; }
    .tm-out-head { display: grid; grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1fr) 32px; gap: 6px; font-size: 11.5px; color: var(--ds-text-muted); font-weight: 600; }
    .tm-out-row { display: grid; grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1fr) 32px; gap: 6px; align-items: center; }
    .tm-dash { text-align: center; color: var(--ds-text-muted); }
    .tm-test-out { border: 1px solid var(--ds-success-border); background: var(--ds-success-bg); color: var(--ds-success-fg); border-radius: 8px; padding: 8px 10px; font-size: 12px; display: grid; gap: 4px; }
    .tm-test-out pre { margin: 0; font-size: 11.5px; color: var(--ds-text); overflow: auto; }
    .tm-exec { display: grid; gap: 8px; }
    .tm-radio { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-size: 13px; }
    .tm-radio input { margin-top: 3px; accent-color: var(--ds-accent); }
    .tm-radio b { display: block; color: var(--ds-text); }
    .tm-radio small { display: block; color: var(--ds-text-muted); font-size: 12px; }
    .tm-wait-opts { margin-left: 22px; padding: 10px 12px; border-radius: 8px; background: var(--ds-surface-sunken); border: 1px solid var(--ds-border); display: grid; gap: 8px; }
    .tm-sub-check { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-size: 12.5px; }
    .tm-sub-check input { margin-top: 3px; accent-color: var(--ds-accent); }
    .tm-sub-check b { display: block; color: var(--ds-text); }
    .tm-sub-check small { display: block; font-size: 11.5px; color: var(--ds-text-muted); }
    .tm-code-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .tm-code-left, .tm-code-right { display: grid; gap: 10px; min-width: 0; }
    .tm-code-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .tm-dv-menu { position: absolute; right: 0; top: calc(100% + 4px); min-width: 170px; z-index: 30; }
    .tm-code-ta {
      width: 100%; min-height: 380px; border-radius: 8px; padding: 12px; font-size: 12px; line-height: 1.55;
      border: 1px solid var(--ds-border); background: var(--ds-surface-sunken); color: var(--ds-text); resize: vertical;
    }
    .tm-run-code { width: 100%; }
    .tm-wh-url { display: flex; gap: 8px; align-items: center; }
    .tm-wh-url .input { flex: 1 1 auto; }
    .tm-ev-pills { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 6px; }
    .tm-setup-btn { justify-self: start; }
    .tm-sub-backdrop { z-index: 1060; }
    .tm-ev-modal { max-width: 340px; width: min(340px, 100%); }
    .tm-ev-body { display: grid; gap: 10px; padding: 14px 18px; }
    .tm-ev-check { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; cursor: pointer; }
    .tm-ev-check input { width: 17px; height: 17px; accent-color: var(--ds-accent); }
    .tm-eye-wrap { position: relative; display: flex; align-items: center; }
    .tm-eye-wrap .input { padding-right: 36px; }
    .tm-eye-btn { position: absolute; right: 4px; width: 28px; height: 28px; }
    @media (max-width: 860px) {
      .tm-code-grid { grid-template-columns: minmax(0, 1fr); }
      .tm-code-ta { min-height: 220px; }
    }
    @media (max-width: 640px) {
      .tm-kv-row, .tm-out-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px; }
      .tm-out-head, .tm-param-head { display: none; }
      .tm-param-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .tm-endpoint { grid-template-columns: 96px minmax(0, 1fr); }
    }
  `],
})
export class ToolModalsComponent {
  mode = input<ToolModalMode>(null);
  value = input<any>(null);
  dynamicVars = input<string[]>([]);
  isNew = input(false);

  save = output<any>();
  remove = output<void>();
  close = output<void>();

  readonly Math = Math;
  readonly HTTP_METHODS = HTTP_METHODS;
  readonly WEBHOOK_EVENTS = WEBHOOK_EVENTS;
  readonly PRIMITIVE_TYPES = FUNCTION_PRIMITIVE_TYPES;
  readonly ARRAY_TYPES = FUNCTION_ARRAY_TYPES;
  readonly JSON_EXAMPLES = FUNCTION_JSON_EXAMPLES;

  draft = signal<any>(null);
  fnTab = signal<'input' | 'output'>('input');
  activeExample = signal<{ id: string; label: string; json: string } | null>(null);
  jsonErr = signal('');
  copiedJson = signal(false);
  customTestOut = signal<{ status: string; body: string } | null>(null);
  codeRunOut = signal<{ status: string; logs: string[]; returned: string } | null>(null);
  webhookTestOut = signal('');
  dvMenuOpen = signal(false);
  eventsOpen = signal(false);
  eventsDraft = signal<string[]>([]);
  showMcpUrl = signal(false);

  modalTitle = computed(() => {
    const m = this.mode();
    const d = this.draft();
    if (m === 'builtin') {
      if (d?.builtin_type === 'transfer_call') return 'Transfer Call';
      if (d?.builtin_type === 'get_current_datetime') return 'Current Date & Time';
      return 'End Call';
    }
    if (m === 'custom') return 'Custom function';
    if (m === 'code') return 'Code Tool';
    if (m === 'webhook') return 'Agent Level Webhook';
    if (m === 'mcp') return this.isNew() ? 'Add MCP' : 'Edit MCP';
    return 'Tool';
  });

  modalIcon = computed(() => {
    const m = this.mode();
    if (m === 'builtin') return 'phoneOff';
    if (m === 'custom') return 'sliders';
    if (m === 'code') return 'code';
    if (m === 'webhook') return 'webhook';
    return 'mcp';
  });

  constructor() {
    effect(() => {
      const m = this.mode();
      const v = this.value();
      if (!m || !v) {
        this.draft.set(null);
        return;
      }
      const copy = structuredClone(v);
      if (m === 'custom' && !copy.input_json) copy.input_json = fieldsToJson(copy.input_fields || []);
      this.draft.set(copy);
      this.fnTab.set('input');
      this.activeExample.set(null);
      this.jsonErr.set('');
      this.customTestOut.set(null);
      this.codeRunOut.set(null);
      this.webhookTestOut.set('');
      this.dvMenuOpen.set(false);
      this.eventsOpen.set(false);
      this.showMcpUrl.set(!this.isNew());
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEsc(e: Event): void {
    e.stopImmediatePropagation?.();
    if (this.eventsOpen()) { this.eventsOpen.set(false); return; }
    if (this.activeExample()) { this.activeExample.set(null); return; }
    if (this.dvMenuOpen()) { this.dvMenuOpen.set(false); return; }
    this.close.emit();
  }

  patch(part: Record<string, any>): void {
    this.draft.update((d) => (d ? { ...d, ...part } : d));
  }

  addKv(field: string): void {
    this.patch({ [field]: [...(this.draft()?.[field] || []), { key: '', value: '' }] });
  }
  patchKv(field: string, i: number, key: 'key' | 'value', val: string): void {
    const list = (this.draft()?.[field] || []).map((row: any, idx: number) => (idx === i ? { ...row, [key]: val } : row));
    this.patch({ [field]: list });
  }
  removeKv(field: string, i: number): void {
    this.patch({ [field]: (this.draft()?.[field] || []).filter((_: any, idx: number) => idx !== i) });
  }

  addOutMap(field: string): void {
    this.patch({ [field]: [...(this.draft()?.[field] || []), { path: '', variable: '' }] });
  }
  patchOutMap(field: string, i: number, key: 'path' | 'variable', val: string): void {
    const list = (this.draft()?.[field] || []).map((row: any, idx: number) => (idx === i ? { ...row, [key]: val } : row));
    this.patch({ [field]: list });
  }
  removeOutMap(field: string, i: number): void {
    this.patch({ [field]: (this.draft()?.[field] || []).filter((_: any, idx: number) => idx !== i) });
  }

  addParam(): void {
    this.patch({
      input_fields: [...(this.draft()?.input_fields || []), { name: '', type: 'string', description: '', required: false }],
    });
  }
  patchParam(i: number, part: Record<string, any>): void {
    const list = (this.draft()?.input_fields || []).map((f: any, idx: number) => (idx === i ? { ...f, ...part } : f));
    this.patch({ input_fields: list });
  }
  removeParam(i: number): void {
    this.patch({ input_fields: (this.draft()?.input_fields || []).filter((_: any, idx: number) => idx !== i) });
  }

  setCustomInputMode(next: 'form' | 'json'): void {
    const d = this.draft();
    if (!d || (d.input_mode || 'form') === next) return;
    if (next === 'json') {
      this.patch({ input_mode: 'json', input_json: fieldsToJson(d.input_fields || []) });
      this.jsonErr.set('');
    } else {
      const parsed = jsonToFields(d.input_json || '{}');
      if (!parsed) {
        this.jsonErr.set('Fix invalid JSON syntax before switching back to Form view.');
        return;
      }
      this.jsonErr.set('');
      this.patch({ input_mode: 'form', input_fields: parsed });
    }
  }

  formatCustomJson(): void {
    const raw = this.draft()?.input_json || '';
    try {
      this.patch({ input_json: JSON.stringify(JSON.parse(raw), null, 2) });
      this.jsonErr.set('');
    } catch {
      this.jsonErr.set('Invalid JSON — check braces and commas.');
    }
  }

  toggleExample(ex: { id: string; label: string; json: string }): void {
    this.activeExample.set(this.activeExample()?.id === ex.id ? null : ex);
  }

  applyExample(json: string): void {
    const parsed = jsonToFields(json);
    this.patch({ input_json: json, ...(parsed ? { input_fields: parsed } : {}) });
    this.jsonErr.set('');
    this.activeExample.set(null);
  }

  async copyJson(text: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); } catch { /* noop */ }
    this.copiedJson.set(true);
    setTimeout(() => this.copiedJson.set(false), 1200);
  }

  runCustomTest(): void {
    const d = this.draft();
    const mapped: Record<string, any> = {};
    for (const om of d?.output_mappings || []) {
      if (om.variable?.trim()) mapped[om.variable.trim()] = 'ASN-2026-8841';
    }
    this.customTestOut.set({
      status: `${d?.method || 'POST'} ${d?.url || 'https://api.example.com'} · 200 OK (142ms)`,
      body: JSON.stringify({
        ok: true,
        data: { asn_number: 'ASN-2026-8841', dispatch_ready: true },
        extracted_variables: mapped,
      }, null, 2),
    });
  }

  insertDvIntoCode(varName: string): void {
    const code = String(this.draft()?.code || '');
    const expr = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(varName) ? `dv.${varName}` : `dv["${varName}"]`;
    this.patch({ code: (code ? code + '\n' : '') + expr });
    this.dvMenuOpen.set(false);
  }

  runCodeDryRun(): void {
    const d = this.draft();
    const src = String(d?.code || '');
    const logs = [...src.matchAll(/console\.log\(([^)]+)\)/g)].map((m) => m[1].trim());
    const stored: Record<string, string> = {};
    for (const sf of d?.store_fields || []) {
      if (sf.variable?.trim()) stored[sf.variable.trim()] = sf.path?.trim() ? `sample(${sf.path.trim()})` : '48h';
    }
    this.codeRunOut.set({
      status: `Dry-run completed · 38ms (timeout ${d?.timeout_s ?? 30}s)`,
      logs,
      returned: JSON.stringify({
        ok: true,
        result: { status: 'ready', dispatch_window: '48h' },
        stored_variables: stored,
      }, null, 2),
    });
  }

  runWebhookTest(): void {
    const d = this.draft();
    this.webhookTestOut.set(`200 OK · Sent test payload (${(d?.events || []).join(', ') || 'ping'}) to ${d?.url}`);
  }

  eventLabel(key: string): string {
    return WEBHOOK_EVENTS.find((e) => e.key === key)?.label || key;
  }

  openEventsModal(): void {
    this.eventsDraft.set([...(this.draft()?.events || [])]);
    this.eventsOpen.set(true);
  }
  toggleEventDraft(key: string, on: boolean): void {
    this.eventsDraft.update((list) => (on ? [...new Set([...list, key])] : list.filter((x) => x !== key)));
  }
  saveEventsModal(): void {
    this.patch({ events: [...this.eventsDraft()] });
    this.eventsOpen.set(false);
  }

  submit(): void {
    const d = structuredClone(this.draft());
    if (!d) return;
    if (this.mode() === 'custom' && d.input_mode === 'json') {
      const parsed = jsonToFields(d.input_json || '{}');
      if (!parsed) {
        this.jsonErr.set('Fix invalid JSON syntax before saving.');
        return;
      }
      d.input_fields = parsed;
    }
    this.save.emit(d);
  }
}
