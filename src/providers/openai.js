// @ts-check
const { Provider, buildUserPrompt } = require('./base');
const { postJSONCancelable } = require('../http');
const { sanitizeLLM } = require('../sanitize');

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

module.exports = OpenAIProvider;
