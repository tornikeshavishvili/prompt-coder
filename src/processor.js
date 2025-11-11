// @ts-check
const vscode = require('vscode');
const CancelState = require('./cancelState');
const { showRunning, showIdle } = require('./status');
const { refreshLenses } = require('./lenses');
const { makeProvider } = require('./providerFactory');
const {
  MULTI_BEGIN_RE,
  MULTI_END_RE,
  REPLACE_END_RE,
  getContextSnippet,
  extractPromptAndInsertPos,
  findCommentClosePosition
} = require('./parsing');

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

module.exports = {
  processDirectiveAtLine,
  processDirectiveAtCursor,
  processDirectivesInDoc,
  getContextSnippet,
};
