// @ts-check
const OllamaProvider = require('./providers/ollama');
const OpenAIProvider = require('./providers/openai');
const HttpProvider = require('./providers/httpProvider');

function makeProvider(cfg){
  const p = (cfg.get('provider') || 'ollama').toLowerCase();
  if (p==='openai') return new OpenAIProvider(cfg);
  if (p==='http') return new HttpProvider(cfg);
  return new OllamaProvider(cfg);
}

module.exports = { makeProvider };
