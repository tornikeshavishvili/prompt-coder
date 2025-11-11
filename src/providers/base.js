// @ts-check
class Provider{
  constructor(cfg){ this.cfg = cfg; }
  async generate(){ throw new Error('not impl'); }
}

function buildUserPrompt(user, languageId, fileCtx, sys){
  const lang = languageId ? `Language: ${languageId}` : 'Language: auto-detect';
  const ctx = fileCtx ? `\n\nCurrent file context:\n${fileCtx}\n` : '';
  const g = sys ? `\n\nGuidelines: ${sys}` : '';
  return `Generate code as requested.\n${lang}${ctx}\nRequest:\n${user}${g}`;
}

module.exports = { Provider, buildUserPrompt };
