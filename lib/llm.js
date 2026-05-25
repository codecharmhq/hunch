// Hunch LLM Client — supports multiple providers
// Now supports runtime override: callers can pass a `customConfig` { baseUrl, apiKey, model }
// which takes precedence over the built-in PROVIDERS table and env vars.
const https = require('https');
const http = require('http');
const { URL } = require('url');

const PROVIDERS = {
  volcengine: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnv: 'VOLCENGINE_API_KEY',
    defaultModel: 'ep-20250519234557-cpc7p',
    label: 'Volcengine ARK'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro'
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    label: 'OpenAI GPT-4o'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-3-5-sonnet-latest',
    label: 'Anthropic Claude'
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GOOGLE_API_KEY',
    defaultModel: 'gemini-2.0-flash',
    label: 'Google Gemini'
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOWER_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    label: 'SiliconFlow'
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'QWEN_API_KEY',
    defaultModel: 'qwen-plus',
    label: 'Qwen (Tongyi)'
  },
  custom: {
    baseUrl: '',
    apiKeyEnv: '',
    defaultModel: '',
    label: 'Custom (OpenAI-compatible)'
  }
};

function resolveProvider({ provider, customConfig }) {
  // Priority 1: explicit customConfig (from keystore)
  if (customConfig && customConfig.baseUrl && customConfig.apiKey) {
    return {
      baseUrl: customConfig.baseUrl.replace(/\/$/, ''),
      apiKey: customConfig.apiKey,
      model: customConfig.model || '',
      source: 'custom'
    };
  }
  // Priority 2: built-in provider + env
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  if (!p.baseUrl) throw new Error(`Provider "${provider}" requires customConfig (baseUrl/apiKey)`);
  const apiKey = p.apiKeyEnv ? process.env[p.apiKeyEnv] : '';
  if (!apiKey) {
    throw new Error(`No API key. Please set it in Settings, or set env ${p.apiKeyEnv}.`);
  }
  return {
    baseUrl: p.baseUrl,
    apiKey,
    model: p.defaultModel,
    source: 'env'
  };
}

/**
 * Streaming chat (OpenAI-compatible)
 * @param {object} opts
 * @param {string} [opts.provider]
 * @param {object} [opts.customConfig]  - { baseUrl, apiKey, model }
 * @param {string} [opts.model]         - explicit model override
 * @param {Array}  opts.messages
 * @param {(token:string)=>void} opts.onToken
 * @param {number} [opts.timeoutMs=300000]
 * @returns {Promise<string>}
 */
function chatStream({ provider, customConfig, model, messages, onToken, timeoutMs = 300000 }) {
  const cfg = resolveProvider({ provider, customConfig });
  const finalModel = model || cfg.model;
  if (!finalModel) throw new Error('No model specified (set it in Settings or pass `model`).');

  const url = new URL(cfg.baseUrl + '/chat/completions');
  const body = JSON.stringify({
    model: finalModel,
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 2048
  });

  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Accept': 'text/event-stream',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: timeoutMs
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', c => errBody += c);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errBody.slice(0, 500)}`)));
        return;
      }
      let buffer = '';
      let fullText = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const token = json.choices?.[0]?.delta?.content;
            if (token) {
              fullText += token;
              onToken && onToken(token);
            }
          } catch (_) {}
        }
      });
      res.on('end', () => resolve(fullText));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Stream timeout (300s)')); });
    req.write(body);
    req.end();
  });
}

/**
 * Connection test — run a very short prompt, see if we get tokens.
 * @returns {Promise<{ok:boolean, sample?:string, error?:string, ms:number}>}
 */
async function testConnection({ provider, customConfig, model }) {
  const start = Date.now();
  try {
    let sample = '';
    await chatStream({
      provider,
      customConfig,
      model,
      messages: [
        { role: 'system', content: 'You are a connectivity test.' },
        { role: 'user', content: 'Say "ok" only.' }
      ],
      onToken: (t) => { sample += t; if (sample.length > 40) throw new Error('STOP'); },
      timeoutMs: 20000
    }).catch(e => { if (e.message !== 'STOP') throw e; });
    return { ok: true, sample: sample.slice(0, 40), ms: Date.now() - start };
  } catch (e) {
    return { ok: false, error: e.message, ms: Date.now() - start };
  }
}

module.exports = { chatStream, testConnection, PROVIDERS };
