// @ts-check
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

module.exports = { sanitizeLLM };
