
// @ts-check
const vscode = require('vscode');
const http = require('http');
const https = require('https');

/* ---------------- Status + Logging ---------------- */
let statusItem;
const log = vscode.window.createOutputChannel('Prompt Coder');
function ensureStatus() {
  if (!statusItem) {
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusItem.text = "$(rocket) Prompt Coder";
    statusItem.tooltip = "Prompt Coder status";
    statusItem.show();
  }
}
function showRunning(){ ensureStatus(); statusItem.text = "$(sync~spin) Prompt running…"; }
function showIdle(){ ensureStatus(); statusItem.text = "$(rocket) Prompt Coder"; }

/* ---------------- Cancellation ---------------- */
const CancelState = {
  _req: null,
  _running: false,
  _cancelled: false,
  activeUri: null,
  activeLine: null,
  setRequest(req){ this._req=req; this._running=!!req; this._cancelled=false; },
  setRunning(v){ this._running=!!v; },
  isRunning(){ return this._running; },
  setActive(uri,line){ this.activeUri=uri; this.activeLine=line; },
  clearActive(){ this.activeUri=null; this.activeLine=null; },
  cancel(){ try{ this._cancelled=true; if(this._req && this._req.destroy) this._req.destroy(new Error('Cancelled')); }catch{} finally{ this._running=false; } }
};

/* ---------------- CodeLens Provider ---------------- */
const aiLensEmitter = new vscode.EventEmitter();
function refreshLenses(){ try{ aiLensEmitter.fire(); }catch(e){ log.appendLine('lens refresh error: '+e); } }

function makeCodeLensProvider(){
  return {
    onDidChangeCodeLenses: aiLensEmitter.event,
    provideCodeLenses(document){
      try{
        const lenses = [];
        const text = document.getText();
        const docUri = document.uri.toString();
        const re = /@ai\s*(?:generate\s*:|replace\s*begin\s*:)/ig;
        let m;
        while ((m = re.exec(text)) !== null){
          const pos = document.positionAt(m.index);
          const line = pos.line;
          const lineText = document.lineAt(line).text;
          const range = new vscode.Range(new vscode.Position(line,0), new vscode.Position(line,lineText.length));
          const active = CancelState.isRunning() && CancelState.activeUri===docUri && CancelState.activeLine===line;
          lenses.push(new vscode.CodeLens(range, {
            title: active ? "$(play) Run @ai (running…)" : "$(play) Run @ai",
            command: "promptCoder.processAICommentAtLine",
            arguments: [{ uri: docUri, line }]
          }));
          lenses.push(new vscode.CodeLens(range, {
            title: active ? "$(debug-stop) Stop (running…)" : "$(debug-stop) Stop",
            command: "promptCoder.stop"
          }));
          // jump to end-of-line to avoid duplicate matches on the same line
          const endOffset = document.offsetAt(new vscode.Position(line, lineText.length));
          re.lastIndex = Math.max(re.lastIndex, endOffset);
        }
        log.appendLine(`[lenses] ${lenses.length} for ${document.uri.toString()}`);
        return lenses;
      }catch(err){ log.appendLine('CodeLens error: '+String(err)); return []; }
    },
    resolveCodeLens(c){ return c; }
  };
}

/* --------------- HTTP + sanitize --------------- */
function postJSONCancelable(urlStr, headers, bodyObj){
  return new Promise((resolve, reject)=>{
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const data = JSON.stringify(bodyObj||{});
      const opts = {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (isHttps?443:80),
        path: u.pathname + (u.search || ''),
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(headers||{}) }
      };
      const req = (isHttps?https:http).request(opts, res=>{
        const chunks = [];
        res.on('data', d=>chunks.push(d));
        res.on('end', ()=>{
          if (CancelState._cancelled || !CancelState.isRunning()) return resolve({ cancelled: true });
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode<200 || res.statusCode>=300) return reject(new Error(`HTTP ${res.statusCode}: ${text}`));
          try{ resolve(JSON.parse(text)); } catch{ resolve({ text }); }
        });
      });
      req.on('error', e=>{ if (CancelState._cancelled) return resolve({ cancelled: true }); else return reject(e); });
      CancelState.setRequest(req);
      CancelState.setRunning(true);
      req.write(data);
      req.end();
    } catch(err){ reject(err); }
  });
}

function sanitizeLLM(text){
  if (!text) return "";
  let t = String(text).replace(/\r\n/g, "\n");
  // Collect fenced blocks ```lang ... ``` or ~~~lang ... ~~~
  const fence = /(?:```|~~~)\s*[a-zA-Z0-9+._-]*\s*\n([\s\S]*?)\n(?:```|~~~)/g;
  const blocks = [];
  let m;
  while ((m=fence.exec(t))!==null) blocks.push(m[1]);
  if (blocks.length) t = blocks.join("\n\n");
  // Inline single `code` (only if whole output trimmed matches)
  const m2 = /^\s*`([^`]+)`\s*$/s.exec(t.trim());
  if (!blocks.length && m2 && m2[1]) t = m2[1];
  // Trim + unindent
  t = t.replace(/^\s*\n+/, "").replace(/\n+\s*$/, "");
  const lines = t.split("\n");
  const nonEmpty = lines.filter(l=>l.trim());
  if (nonEmpty.length){
    const minIndent = Math.min(...nonEmpty.map(l => (l.match(/^[ \t]*/)||[""])[0].length));
    if (minIndent>0) t = lines.map(l=>l.slice(Math.min(minIndent, l.length))).join("\n");
  }
  return t;
}

/* ---------------- Providers ---------------- */
class Provider{ constructor(cfg){ this.cfg=cfg; } async generate(){ throw new Error('not impl'); } }
function buildUserPrompt(user, languageId, fileCtx, sys){
  const lang = languageId ? `Language: ${languageId}` : 'Language: auto-detect';
  const ctx = fileCtx ? `\n\nCurrent file context:\n${fileCtx}\n` : '';
  const g = sys ? `\n\nGuidelines: ${sys}` : '';
  return `Generate code as requested.\n${lang}${ctx}\nRequest:\n${user}${g}`;
}
class OllamaProvider extends Provider{
  async generate(prompt, languageId, fileCtx){
    const endpoint = this.cfg.get('endpoint') || 'http://localhost:11434';
    const model = this.cfg.get('model') || 'qwen2.5-coder:7b';
    const temperature = Number(this.cfg.get('temperature') || 0.2);
    const maxTokens = Number(this.cfg.get('maxTokens') || 2048);
    const sys = this.cfg.get('systemPrompt') || 'You are a code generator.';
    const url = new URL('/api/generate', endpoint).toString();
    const payload = { model, prompt: buildUserPrompt(prompt, languageId, fileCtx, sys), options: { temperature, num_predict: maxTokens }, stream: false };
    const json = await postJSONCancelable(url, {}, payload);
    if (json && json.cancelled) return '';
    const content = json?.response ?? json?.text ?? '';
    return sanitizeLLM(content);
  }
}
class OpenAIProvider extends Provider{
  async generate(prompt, languageId, fileCtx){
    const sys = this.cfg.get('systemPrompt') || 'You are a code generator.';
    const model = this.cfg.get('model');
    const apiKey = this.cfg.get('apiKey');
    const temperature = Number(this.cfg.get('temperature') || 0.2);
    const maxTokens = Number(this.cfg.get('maxTokens') || 2048);
    if (!apiKey) throw new Error('OpenAI API key missing. Set promptCoder.apiKey.');
    const payload = { model, messages: [{role:'system', content: sys}, {role:'user', content: buildUserPrompt(prompt, languageId, fileCtx)}], temperature, max_tokens: maxTokens };
    const json = await postJSONCancelable('https://api.openai.com/v1/chat/completions', { 'Authorization': `Bearer ${apiKey}` }, payload);
    if (json && json.cancelled) return '';
    const content = json?.choices?.[0]?.message?.content ?? '';
    return sanitizeLLM(content);
  }
}
class HttpProvider extends Provider{
  async generate(prompt, languageId, fileCtx){
    const endpoint = this.cfg.get('endpoint');
    const path = this.cfg.get('httpPath') || '/api/generate';
    const apiKey = this.cfg.get('apiKey') || '';
    const model = this.cfg.get('model');
    const temperature = Number(this.cfg.get('temperature') || 0.2);
    const maxTokens = Number(this.cfg.get('maxTokens') || 0);
    const sys = this.cfg.get('systemPrompt') || 'You are a code generator.';
    const url = new URL(path, endpoint).toString();
    const payload = { model, system: sys, prompt: buildUserPrompt(prompt, languageId, fileCtx), temperature, maxTokens };
    const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
    const json = await postJSONCancelable(url, headers, payload);
    if (json && json.cancelled) return '';
    const content = json.completion || json.text || json.output || json.response || json.result || '';
    return sanitizeLLM(content);
  }
}
function makeProvider(cfg){
  const p = (cfg.get('provider') || 'ollama').toLowerCase();
  if (p==='openai') return new OpenAIProvider(cfg);
  if (p==='http') return new HttpProvider(cfg);
  return new OllamaProvider(cfg);
}

/* -------------- Parsing helpers -------------- */
const MULTI_BEGIN_RE = /^.*@ai\s*generate\s*:\s*$/i;
const MULTI_END_RE = /^.*@ai\s*end\s*$/i;
const REPLACE_END_RE = /@ai\s*replace\s*end/i;

function getContextSnippet(doc){ return doc.getText().slice(0,4000); }

// Strict rule: only scan for multiline close if the trimmed line STARTS with a block opener.
function lineStartsWithBlockOpener(lineText){
  const t = lineText.trimStart();
  return t.startsWith('/*') || t.startsWith('<!--') || t.startsWith('{/*');
}

// Extract prompt and insertion position per spec.
function extractPromptAndInsertPos(doc, lineIdx){
  const total = doc.lineCount;
  const lineText = doc.lineAt(lineIdx).text;
  const lower = lineText.toLowerCase();
  let idx = lower.indexOf('generate:');
  let tokLen = 'generate:'.length;
  const bIdx = lower.indexOf('begin:');
  if (idx === -1 || (bIdx !== -1 && bIdx < idx)) { idx = bIdx; tokLen = 'begin:'.length; }
  if (idx === -1) return { prompt: '', insertPos: doc.lineAt(lineIdx).range.end };

  const startCol = idx + tokLen;
  const rest = lineText.slice(startCol);

  // Same-line close?
  const endOnThisLine = (()=>{
    const a = rest.indexOf('-->');
    const b = rest.indexOf('*/');
    const c = rest.indexOf('*/}');
    const idxs = [a,b,c].filter(x=>x!==-1);
    return idxs.length ? Math.min(...idxs) : -1;
  })();
  if (endOnThisLine !== -1){
    const raw = rest.slice(0, endOnThisLine).trim();
    const prompt = raw.replace(/^[\s:*#/\-<!]+/, '').trim();
    const insertPos = doc.lineAt(lineIdx).range.end;
    return { prompt, insertPos };
  }

  // If the directive line does NOT start with a block opener, treat as single-line (no forward scan)
  if (!lineStartsWithBlockOpener(lineText)){
    const prompt = rest.trim();
    const insertPos = doc.lineAt(lineIdx).range.end;
    return { prompt, insertPos };
  }

  // Otherwise scan for first close marker on subsequent lines
  let j = lineIdx + 1;
  let parts = [rest];
  while (j < total){
    const t = doc.lineAt(j).text;
    const a = t.indexOf('-->');
    const b = t.indexOf('*/');
    const c = t.indexOf('*/}');
    if (a !== -1 || b !== -1 || c !== -1){
      const candidates = [a,b,c].filter(x=>x!==-1);
      const idx2 = Math.min(...candidates);
      parts.push(t.slice(0, idx2));
      const prompt = parts.map(s => s.replace(/^\s*([\/\*\#\-\s<>!]+)?\s?/, '')).join("\n").trim();
      let markerLen = 2;
      if (a !== -1 && idx2 === a) markerLen = 3; // '-->'
      if (c !== -1 && idx2 === c) markerLen = 3; // '*/}'
      return { prompt, insertPos: new vscode.Position(j, idx2 + markerLen) };
    } else {
      parts.push(t);
    }
    j++;
  }
  // Fallback to EOL of begin line
  return { prompt: rest.trim(), insertPos: doc.lineAt(lineIdx).range.end };
}

// Find the close position for begin line (used for block replaces)
function findCommentClosePosition(doc, lineIdx){
  const total = doc.lineCount;
  const start = doc.lineAt(lineIdx).text;
  const trimmed = start.trimStart();
  if (!(trimmed.startsWith('/*') || trimmed.startsWith('<!--') || trimmed.startsWith('{/*'))){
    return doc.lineAt(lineIdx).range.end;
  }
  const scanLine = (txt) => {
    const a = txt.indexOf('-->');
    const b = txt.indexOf('*/');
    const c = txt.indexOf('*/}');
    const idxs = [a,b,c].filter(x=>x!==-1);
    if (!idxs.length) return { idx: -1, len: 0 };
    const idx = Math.min(...idxs);
    let len = 2;
    if (a !== -1 && idx === a) len = 3; // -->
    if (c !== -1 && idx === c) len = 3; // */}
    return { idx, len };
  };
  const r0 = scanLine(start);
  if (r0.idx !== -1) return new vscode.Position(lineIdx, r0.idx + r0.len);
  let j = lineIdx + 1;
  while (j < total){
    const t = doc.lineAt(j).text;
    const r = scanLine(t);
    if (r.idx !== -1) return new vscode.Position(j, r.idx + r.len);
    j++;
  }
  return doc.lineAt(lineIdx).range.end;
}

/* ---------------- Core processors ---------------- */
async function processDirectiveAtLine(uri, line){
  try{
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString()===doc.uri.toString()) || await vscode.window.showTextDocument(doc);
    const cfg = vscode.workspace.getConfiguration('promptCoder');
    const provider = makeProvider(cfg);
    const languageId = doc.languageId;
    const fileContext = getContextSnippet(doc);
    const text = doc.lineAt(line).text;

    // explicit replace begin...end
    const rb = /@ai\s*replace\s*begin\s*:\s*(?<prompt>.+)/i.exec(text);
    if (rb){
      let j = line + 1;
      while (j < doc.lineCount && !REPLACE_END_RE.test(doc.lineAt(j).text)) j++;
      if (j < doc.lineCount){
        const prompt = (rb.groups?.prompt || '').trim();
        showRunning(); CancelState.setActive(doc.uri.toString(), line); refreshLenses();
        try{
          const out = await provider.generate(prompt, languageId, fileContext);
          if (out && out.trim()){
            const afterBegin = findCommentClosePosition(doc, line);
            const beforeEnd = doc.lineAt(j).range.start;
            const we = new vscode.WorkspaceEdit();
            we.replace(doc.uri, new vscode.Range(afterBegin, beforeEnd), "\n"+out.replace(/\s*$/,'')+"\n");
            await vscode.workspace.applyEdit(we);
          }
        } finally {
          showIdle(); CancelState.setRunning(false); CancelState.clearActive(); refreshLenses();
        }
        return;
      } else {
        // treat as inline/comment-close rule
        let tmp = extractPromptAndInsertPos(doc, line);
        const prompt = tmp.prompt; let insertPos = tmp.insertPos;
        showRunning(); CancelState.setActive(doc.uri.toString(), line); refreshLenses();
        try{
          const out = await provider.generate(prompt, languageId, fileContext);
          const fresh = extractPromptAndInsertPos(doc, line); insertPos = fresh.insertPos || insertPos;
          if (out && out.trim()){
            const we = new vscode.WorkspaceEdit();
            we.insert(doc.uri, insertPos, "\n"+out.replace(/\s*$/,'')+"\n");
            await vscode.workspace.applyEdit(we);
          }
        } finally {
          showIdle(); CancelState.setRunning(false); CancelState.clearActive(); refreshLenses();
        }
        return;
      }
    }

    // multi-line generate ... @ai end
    if (MULTI_BEGIN_RE.test(text)){
      let j = line + 1;
      let lines = [];
      while (j < doc.lineCount && !MULTI_END_RE.test(doc.lineAt(j).text)){
        const raw = doc.lineAt(j).text;
        lines.push(raw.replace(/^\s*([\/\*\#\-\s<>!]+)?\s?/, '').trimEnd());
        j++;
      }
      if (j < doc.lineCount){
        const prompt = lines.join("\n").trim();
        showRunning(); CancelState.setActive(doc.uri.toString(), line); refreshLenses();
        try{
          const out = await provider.generate(prompt, languageId, fileContext);
          if (out && out.trim()){
            const afterBegin = findCommentClosePosition(doc, line);
            const beforeEnd = doc.lineAt(j).range.start;
            const we = new vscode.WorkspaceEdit();
            we.replace(doc.uri, new vscode.Range(afterBegin, beforeEnd), "\n"+out.replace(/\s*$/,'')+"\n");
            await vscode.workspace.applyEdit(we);
          }
        } finally {
          showIdle(); CancelState.setRunning(false); CancelState.clearActive(); refreshLenses();
        }
        return;
      }
      // fall through to comment-close rule when no @ai end
    }

    // single-line or comment-close generate
    if (/@ai\s*generate\s*:/i.test(text)){
      const first = extractPromptAndInsertPos(doc, line);
      const prompt = first.prompt; let insertPos = first.insertPos;
      showRunning(); CancelState.setActive(doc.uri.toString(), line); refreshLenses();
      try{
        const out = await provider.generate(prompt, languageId, fileContext);
        const fresh = extractPromptAndInsertPos(doc, line); insertPos = fresh.insertPos || insertPos;
        if (out && out.trim()){
          const we = new vscode.WorkspaceEdit();
          we.insert(doc.uri, insertPos, "\n"+out.replace(/\s*$/,'')+"\n");
          await vscode.workspace.applyEdit(we);
        }
      } finally {
        showIdle(); CancelState.setRunning(false); CancelState.clearActive(); refreshLenses();
      }
      return;
    }

    vscode.window.showInformationMessage('Prompt Coder: No @ai directive on this line.');
  } catch(err){
    vscode.window.showErrorMessage(String(err));
  }
}

async function processDirectiveAtCursor(editor){
  const doc = editor.document;
  const cur = editor.selection.active.line;
  await processDirectiveAtLine(doc.uri, cur);
}

async function processDirectivesInDoc(editor){
  const doc = editor.document;
  const total = doc.lineCount;
  for (let i=0;i<total;i++){
    const t = doc.lineAt(i).text;
    if (/@ai\s*replace\s*begin\s*:/i.test(t) || MULTI_BEGIN_RE.test(t) || /@ai\s*generate\s*:/i.test(t)){
      await processDirectiveAtLine(doc.uri, i);
    }
  }
}

/* ---------------- Activate ---------------- */
function activate(context){
  log.appendLine('Activating Prompt Coder...');
  showIdle();
  vscode.window.setStatusBarMessage('Prompt Coder: activated', 1500);

  const runAtLine = vscode.commands.registerCommand('promptCoder.processAICommentAtLine', async (args)=>{
    try{
      const editor = vscode.window.activeTextEditor;
      const uri = (args && args.uri) ? vscode.Uri.parse(args.uri) : editor?.document.uri;
      const line = (args && typeof args.line === 'number') ? args.line : editor?.selection.active.line;
      if (!uri || typeof line !== 'number') return vscode.window.showErrorMessage('No line to process.');
      await processDirectiveAtLine(uri, line);
    }catch(err){ vscode.window.showErrorMessage(String(err)); }
  });
  const runCurrent = vscode.commands.registerCommand('promptCoder.processCurrentAIComment', async ()=>{
    const e = vscode.window.activeTextEditor;
    if (!e) return vscode.window.showErrorMessage('No active editor.');
    await processDirectiveAtCursor(e);
  });
  const runAll = vscode.commands.registerCommand('promptCoder.processAIComments', async ()=>{
    const e = vscode.window.activeTextEditor;
    if (!e) return vscode.window.showErrorMessage('No active editor.');
    await processDirectivesInDoc(e);
  });
  const stopCmd = vscode.commands.registerCommand('promptCoder.stop', async ()=>{
    CancelState.cancel(); showIdle(); CancelState.clearActive(); refreshLenses();
    vscode.window.setStatusBarMessage('Prompt Coder: Cancelled', 1500);
  });
  const genHere = vscode.commands.registerCommand('promptCoder.generateHere', async ()=>{
    const e = vscode.window.activeTextEditor;
    if (!e) return vscode.window.showErrorMessage('No active editor.');
    const cfg = vscode.workspace.getConfiguration('promptCoder');
    const provider = makeProvider(cfg);
    const languageId = e.document.languageId;
    const fileCtx = getContextSnippet(e.document);
    const prompt = await vscode.window.showInputBox({ title:'Describe the code to generate', validateInput:v=>v.trim()?undefined:'Enter a prompt' });
    if (!prompt) return;
    try{
      showRunning(); CancelState.setActive(e.document.uri.toString(), e.selection.active.line); refreshLenses();
      const out = await provider.generate(prompt, languageId, fileCtx);
      const wrap = !!cfg.get('wrapSelectionWithCodeFence');
      const code = wrap ? `\n\`\`\`${languageId||''}\n${out.trim()}\n\`\`\`\n` : out;
      const sel = e.selection;
      if (out && out.trim()){
        await e.edit(b => sel && !sel.isEmpty ? b.replace(sel, code) : b.insert(sel.active, code));
      }
    }finally{
      showIdle(); CancelState.setRunning(false); CancelState.clearActive(); refreshLenses();
    }
  });
  const genReplaceFile = vscode.commands.registerCommand('promptCoder.generateReplaceFile', async ()=>{
    const e = vscode.window.activeTextEditor;
    if (!e) return vscode.window.showErrorMessage('No active editor.');
    const cfg = vscode.workspace.getConfiguration('promptCoder');
    const provider = makeProvider(cfg);
    const languageId = e.document.languageId;
    const fileCtx = getContextSnippet(e.document);
    const prompt = await vscode.window.showInputBox({ title:'Describe the entire file to generate', validateInput:v=>v.trim()?undefined:'Enter a prompt' });
    if (!prompt) return;
    try{
      showRunning(); CancelState.setActive(e.document.uri.toString(), 0); refreshLenses();
      const out = await provider.generate(prompt, languageId, fileCtx);
      if (out && out.trim()){
        const full = new vscode.Range(e.document.positionAt(0), e.document.positionAt(e.document.getText().length));
        await e.edit(b => b.replace(full, out));
      }
    }finally{
      showIdle(); CancelState.setRunning(false); CancelState.clearActive(); refreshLenses();
    }
  });
  const genNewFile = vscode.commands.registerCommand('promptCoder.generateNewFile', async ()=>{
    const cfg = vscode.workspace.getConfiguration('promptCoder');
    const provider = makeProvider(cfg);
    const prompt = await vscode.window.showInputBox({ title:'Describe the new file to create', validateInput:v=>v.trim()?undefined:'Enter a prompt' });
    if (!prompt) return;
    try{
      showRunning(); CancelState.setActive('newfile', 0); refreshLenses();
      const out = await provider.generate(prompt, undefined, undefined);
      const doc = await vscode.workspace.openTextDocument({ content: out, language: 'plaintext' });
      await vscode.window.showTextDocument(doc);
    }finally{
      showIdle(); CancelState.setRunning(false); CancelState.clearActive(); refreshLenses();
    }
  });
  const refreshCmd = vscode.commands.registerCommand('promptCoder.refreshCodeLens', ()=>refreshLenses());
  const debugCmd = vscode.commands.registerCommand('promptCoder.debugShowDirectiveMatches', ()=>{
    const e = vscode.window.activeTextEditor;
    if (!e) return vscode.window.showInformationMessage('No active editor.');
    const text = e.document.getText();
    const re = /@ai\s*(?:generate\s*:|replace\s*begin\s*:)/ig;
    const lines = [];
    let m;
    while ((m = re.exec(text)) !== null){
      const pos = e.document.positionAt(m.index);
      lines.push(`Line ${pos.line+1}: ${e.document.lineAt(pos.line).text.trim()}`);
      const endOfLine = e.document.lineAt(pos.line).text.length;
      re.lastIndex = Math.max(re.lastIndex, e.document.offsetAt(new vscode.Position(pos.line, endOfLine)));
    }
    vscode.window.showQuickPick(lines.length?lines:['No matches found.'], { title: 'Directive Matches' });
  });

  // Provider + refresh hooks
  const lensProvider = makeCodeLensProvider();
  context.subscriptions.push(vscode.languages.registerCodeLensProvider({language:'*'}, lensProvider));

  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(()=>refreshLenses()));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(()=>refreshLenses()));
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(()=>refreshLenses()));
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(()=>refreshLenses()));
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(()=>refreshLenses()));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(()=>refreshLenses()));
  setTimeout(()=>refreshLenses(), 200);

  if (!!vscode.workspace.getConfiguration('promptCoder').get('runOnSave')){
    context.subscriptions.push(vscode.workspace.onWillSaveTextDocument(async (e)=>{
      const ed = vscode.window.activeTextEditor;
      if (ed && ed.document.uri.toString()===e.document.uri.toString()){
        await processDirectivesInDoc(ed);
      }
    }));
  }

  context.subscriptions.push(runAtLine, runCurrent, runAll, stopCmd, genHere, genReplaceFile, genNewFile, refreshCmd, debugCmd);
}

function deactivate(){}

module.exports = { activate, deactivate };
