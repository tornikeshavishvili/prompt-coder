// @ts-check
const vscode = require('vscode');
const CancelState = require('./cancelState');
const { log } = require('./status');

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

module.exports = { makeCodeLensProvider, refreshLenses };
