// @ts-check
const vscode = require('vscode');

const { log, showIdle } = require('./src/status');
const CancelState = require('./src/cancelState');
const { makeCodeLensProvider, refreshLenses } = require('./src/lenses');
const {
  processDirectiveAtLine,
  processDirectiveAtCursor,
  processDirectivesInDoc,
  getContextSnippet,
} = require('./src/processor');
const { makeProvider } = require('./src/providerFactory');

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
    CancelState.cancel();
    showIdle();
    CancelState.clearActive();
    refreshLenses();
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
      const { showRunning } = require('./src/status');
      showRunning();
      CancelState.setActive(e.document.uri.toString(), e.selection.active.line); refreshLenses();
      const out = await provider.generate(prompt, languageId, fileCtx);
      const wrap = !!cfg.get('wrapSelectionWithCodeFence');
      const code = wrap ? `\n\`\`\`${languageId||''}\n${out.trim()}\n\`\`\`\n` : out;
      const sel = e.selection;
      if (out && out.trim()){
        await e.edit(b => sel && !sel.isEmpty ? b.replace(sel, code) : b.insert(sel.active, code));
      }
    }finally{
      const { showIdle } = require('./src/status');
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
      const { showRunning } = require('./src/status');
      showRunning(); CancelState.setActive(e.document.uri.toString(), 0); refreshLenses();
      const out = await provider.generate(prompt, languageId, fileCtx);
      if (out && out.trim()){
        const full = new vscode.Range(e.document.positionAt(0), e.document.positionAt(e.document.getText().length));
        await e.edit(b => b.replace(full, out));
      }
    }finally{
      const { showIdle } = require('./src/status');
      showIdle(); CancelState.setRunning(false); CancelState.clearActive(); refreshLenses();
    }
  });

  const genNewFile = vscode.commands.registerCommand('promptCoder.generateNewFile', async ()=>{
    const cfg = vscode.workspace.getConfiguration('promptCoder');
    const provider = makeProvider(cfg);
    const prompt = await vscode.window.showInputBox({ title:'Describe the new file to create', validateInput:v=>v.trim()?undefined:'Enter a prompt' });
    if (!prompt) return;
    try{
      const { showRunning } = require('./src/status');
      showRunning(); CancelState.setActive('newfile', 0); refreshLenses();
      const out = await provider.generate(prompt, undefined, undefined);
      const doc = await vscode.workspace.openTextDocument({ content: out, language: 'plaintext' });
      await vscode.window.showTextDocument(doc);
    }finally{
      const { showIdle } = require('./src/status');
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
