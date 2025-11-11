// @ts-check
const { Provider, buildUserPrompt } = require('./base');
const { postJSONCancelable } = require('../http');
const { sanitizeLLM } = require('../sanitize');

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

module.exports = HttpProvider;
