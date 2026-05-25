// Hunch Keystore — User-level config persistence
// Stored at ~/.hunch/config.json
// Supports: multi-provider, dynamic agents (1-10), per-agent LLM config

const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_DIR = process.env.HUNCH_CONFIG_DIR || path.join(os.homedir(), '.hunch');
const STORE_FILE = path.join(STORE_DIR, 'config.json');

const DEFAULTS = {
  providers: {},       // provider id -> { baseUrl, apiKey, model, label }
  activeProvider: '',  // Currently active provider
  agents: null,        // null = use default 5 agents; Array = custom
  agentModels: {},     // agent id -> { provider, model } (per-agent LLM)
  language: 'en'
};

function ensureDir() {
  try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch (_) {}
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return { ...DEFAULTS };
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {},
      activeProvider: typeof parsed.activeProvider === 'string' ? parsed.activeProvider : '',
      agents: Array.isArray(parsed.agents) ? parsed.agents : null,
      agentModels: parsed.agentModels && typeof parsed.agentModels === 'object' ? parsed.agentModels : {},
      language: typeof parsed.language === 'string' ? parsed.language : 'en'
    };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function writeStore(data) {
  ensureDir();
  const safe = {
    providers: data.providers && typeof data.providers === 'object' ? data.providers : {},
    activeProvider: typeof data.activeProvider === 'string' ? data.activeProvider : '',
    agents: Array.isArray(data.agents) ? data.agents : null,
    agentModels: data.agentModels && typeof data.agentModels === 'object' ? data.agentModels : {},
    language: typeof data.language === 'string' ? data.language : 'en'
  };
  fs.writeFileSync(STORE_FILE, JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}

function maskedView(data) {
  const out = JSON.parse(JSON.stringify(data));
  for (const id of Object.keys(out.providers || {})) {
    const p = out.providers[id];
    if (p && typeof p.apiKey === 'string' && p.apiKey.length > 0) {
      const k = p.apiKey;
      p.apiKey = k.length <= 8 ? '***' : k.slice(0, 4) + '...' + k.slice(-4);
      p.hasKey = true;
    } else {
      p.hasKey = false;
      p.apiKey = '';
    }
  }
  return out;
}

function resolveActiveConfig() {
  const store = readStore();
  const activeId = store.activeProvider;
  if (activeId && store.providers[activeId]) {
    const p = store.providers[activeId];
    if (p.apiKey && p.baseUrl) {
      return {
        source: 'keystore',
        id: activeId,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        model: p.model || '',
        label: p.label || activeId
      };
    }
  }
  return null;
}

function resolveAgentConfig(agentId) {
  const store = readStore();
  const agentModel = store.agentModels?.[agentId];
  if (agentModel?.provider) {
    const p = store.providers[agentModel.provider];
    if (p && p.apiKey && p.baseUrl) {
      return {
        source: 'agent-override',
        id: agentModel.provider,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        model: agentModel.model || p.model || '',
        label: `${p.label || agentModel.provider} → ${agentModel.model || p.model || 'default'}`
      };
    }
  }
  return resolveActiveConfig();
}

module.exports = { readStore, writeStore, maskedView, resolveActiveConfig, resolveAgentConfig, STORE_FILE };
