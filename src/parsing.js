// @ts-check
const vscode = require('vscode');

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

module.exports = {
  MULTI_BEGIN_RE,
  MULTI_END_RE,
  REPLACE_END_RE,
  getContextSnippet,
  lineStartsWithBlockOpener,
  extractPromptAndInsertPos,
  findCommentClosePosition
};
