// @ts-check
const { Provider, buildUserPrompt } = require('./base');
const { sanitizeLLM } = require('../sanitize');

class OllamaProvider extends Provider{
  async generate(prompt, languageId, fileCtx){
    const endpoint = this.cfg.get('endpoint') || 'http://localhost:11434';
    const model = this.cfg.get('model') || 'qwen2.5-coder:7b';
    const temperature = Number(this.cfg.get('temperature') || 0.2);
    const maxTokens = Number(this.cfg.get('maxTokens') || 2048);
    const sys = this.cfg.get('systemPrompt') || 'You are a code generator.';
    const url = new URL('/api/generate', endpoint).toString();
    const payload = { model, prompt: buildUserPrompt(prompt, languageId, fileCtx, sys), options: { temperature, num_predict: maxTokens }, stream: false };
    const json = await require('../http').postJSONCancelable(url, {}, payload);
    if (json && json.cancelled) return '';
    const content = json?.response ?? json?.text ?? '';
    return sanitizeLLM(content);
  }
}

module.exports = OllamaProvider;
