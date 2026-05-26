// Hunch Server — Multi-Agent AI Debate Platform
// Supports 1-10 agents, each configurable with different LLM

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const loadEnv = require('./lib/env');
const { runDebate } = require('./lib/debate');
const { ROLE_TEMPLATES, AGENT_COLORS, getDefaultAgents } = require('./lib/agents');
const { readStore, writeStore, maskedView, resolveActiveConfig } = require('./lib/keystore');
const { testConnection, PROVIDERS } = require('./lib/llm');
const { register, login, me, upgradeUser, verifyToken, extractToken, getDebates, saveDebate, checkUserAccess, requestPasswordReset, confirmPasswordReset, verifyEmail } = require('./lib/users');
const { createPayment, capturePayment, getOrder, isConfigured: paypalConfigured } = require('./lib/paypal');
const { verifyLicense } = require('./lib/gumroad');

loadEnv();

const PORT = parseInt(process.env.PORT || process.env.HUNCH_PORT || '8100', 10);
const FALLBACK_PROVIDER = process.env.HUNCH_PROVIDER || 'volcengine';
const FALLBACK_MODEL = process.env.HUNCH_MODEL || '';
const DEMO_LIMIT = 5;
const demoUsageFile = path.join(__dirname, 'data', 'demo-usage.json');
const sharesDir = path.join(__dirname, 'data', 'shares');
let demoUsage = {};

// ============ Utilities ============
function loadDemoUsage() {
  try {
    if (fs.existsSync(demoUsageFile)) demoUsage = JSON.parse(fs.readFileSync(demoUsageFile, 'utf8'));
  } catch (_) { demoUsage = {}; }
}
function saveDemoUsage() {
  try {
    const dir = path.dirname(demoUsageFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(demoUsageFile, JSON.stringify(demoUsage, null, 2));
  } catch (_) {}
}
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function checkDemoLimit(req) {
  const ip = getClientIP(req);
  return (demoUsage[ip] || 0) < DEMO_LIMIT;
}
function incrementDemoUsage(req) {
  const ip = getClientIP(req);
  demoUsage[ip] = (demoUsage[ip] || 0) + 1;
  saveDemoUsage();
  return demoUsage[ip];
}
loadDemoUsage();

async function readJSONBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  try { return JSON.parse(body); } catch { return {}; }
}

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
}

// ============ Routes ============
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Static files
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return serveFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html');
  }
  if (req.method === 'GET' && url.pathname === '/history') {
    return serveFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html');
  }
  if (req.method === 'GET' && url.pathname.startsWith('/share/')) {
    return serveSharePage(res, url.pathname.slice(7));
  }
  if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
    const fp = path.join(__dirname, 'public', url.pathname.slice(8));
    const types = { '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
    const ext = path.extname(fp);
    return serveFile(res, fp, types[ext] || 'application/octet-stream');
  }
  // Serve root-level static files (e.g. /styles-modern.css, /avatars.js)
  if (req.method === 'GET' && /^\/[\w\-]+\.(css|js|png|svg|ico|map)$/.test(url.pathname)) {
    const fp = path.join(__dirname, 'public', url.pathname);
    const types = { '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json' };
    const ext = path.extname(fp);
    return serveFile(res, fp, types[ext] || 'application/octet-stream');
  }

  // PayPal redirect pages
  if (url.pathname === '/paypal/success') return servePayPalPage(res, 'success', url.searchParams.get('token') || '');
  if (url.pathname === '/paypal/cancel') return servePayPalPage(res, 'cancel', '');

  // API Routes
  if (url.pathname === '/api/agents' && req.method === 'GET') return handleGetAgents(req, res);
  if (url.pathname === '/api/role-templates' && req.method === 'GET') return handleGetRoleTemplates(req, res);
  if (url.pathname === '/api/settings' && req.method === 'GET') return handleGetSettings(req, res);
  if (url.pathname === '/api/settings' && req.method === 'POST') return handlePostSettings(req, res);
  if (url.pathname === '/api/test' && req.method === 'POST') return handleTestConnection(req, res);
  if (url.pathname === '/api/debate' && req.method === 'GET') return handleDebate(req, res, url);
  if (url.pathname === '/api/demo-usage' && req.method === 'GET') return handleDemoUsage(req, res);
  if (url.pathname === '/api/share' && req.method === 'POST') return handleShare(req, res);

  // Auth routes
  if (url.pathname === '/api/auth/register' && req.method === 'POST') return handleRegister(req, res);
  if (url.pathname === '/api/auth/login' && req.method === 'POST') return handleLogin(req, res);
  if (url.pathname === '/api/auth/me' && req.method === 'GET') return handleMe(req, res);
  if (url.pathname === '/api/auth/debates' && req.method === 'GET') return handleGetDebates(req, res);
  if (url.pathname === '/api/auth/debates' && req.method === 'POST') return handleSaveDebate(req, res);
  if (url.pathname === '/api/auth/upgrade' && req.method === 'POST') return handleUpgrade(req, res);
  if (url.pathname === '/api/auth/reset-request' && req.method === 'POST') return handleResetRequest(req, res);
  if (url.pathname === '/api/auth/reset-confirm' && req.method === 'POST') return handleResetConfirm(req, res);
  if (url.pathname === '/api/auth/verify-email' && req.method === 'GET') return handleVerifyEmail(req, res);

  // PayPal routes
  if (url.pathname === '/api/paypal/create' && req.method === 'POST') return handlePayPalCreate(req, res);
  if (url.pathname === '/api/paypal/capture' && req.method === 'POST') return handlePayPalCapture(req, res);
  if (url.pathname === '/api/paypal/status' && req.method === 'GET') return handlePayPalStatus(req, res);
  if (url.pathname === '/api/paypal/configured' && req.method === 'GET') return sendJSON(res, 200, { configured: paypalConfigured() });
  if (url.pathname === '/api/plan' && req.method === 'GET') return handlePlan(req, res);

  // Gumroad license verification
  if (url.pathname === '/api/gumroad/verify-license' && req.method === 'POST') return handleVerifyLicense(req, res);

  sendJSON(res, 404, { error: 'Not found' });
});

// ============ GET /api/agents ============
function handleGetAgents(req, res) {
  const store = readStore();
  const agents = store.agents || getDefaultAgents();
  sendJSON(res, 200, { agents });
}

// ============ GET /api/role-templates ============
function handleGetRoleTemplates(req, res) {
  const templates = {};
  for (const [id, t] of Object.entries(ROLE_TEMPLATES)) {
    templates[id] = { id, name: t.name, emoji: t.emoji, color: t.color };
  }
  sendJSON(res, 200, { templates });
}

// ============ GET /api/settings ============
function handleGetSettings(req, res) {
  const data = readStore();
  sendJSON(res, 200, {
    settings: maskedView(data),
    providerCatalog: Object.entries(PROVIDERS).map(([id, p]) => ({
      id, label: p.label, baseUrl: p.baseUrl, defaultModel: p.defaultModel,
      isCustom: id === 'custom'
    }))
  });
}

// ============ POST /api/settings ============
async function handlePostSettings(req, res) {
  const incoming = await readJSONBody(req);
  const cur = readStore();
  const next = {
    providers: { ...(cur.providers || {}) },
    activeProvider: typeof incoming.activeProvider === 'string' ? incoming.activeProvider : cur.activeProvider,
    agents: Array.isArray(incoming.agents) ? incoming.agents : cur.agents,
    agentModels: typeof incoming.agentModels === 'object' && incoming.agentModels ? incoming.agentModels : (cur.agentModels || {}),
    language: typeof incoming.language === 'string' ? incoming.language : cur.language
  };

  // Merge providers (preserve apiKey if masked)
  if (incoming.providers && typeof incoming.providers === 'object') {
    for (const [id, p] of Object.entries(incoming.providers)) {
      if (!p || typeof p !== 'object') continue;
      const prev = cur.providers?.[id] || {};
      let apiKey = p.apiKey || '';
      if (apiKey.includes('...') || apiKey === '***') apiKey = prev.apiKey || '';
      next.providers[id] = {
        baseUrl: p.baseUrl || prev.baseUrl || '',
        apiKey,
        model: p.model || prev.model || '',
        label: p.label || prev.label || id
      };
    }
  }

  const saved = writeStore(next);
  sendJSON(res, 200, { ok: true, settings: maskedView(saved) });
}

// ============ POST /api/test ============
async function handleTestConnection(req, res) {
  const { providerId, baseUrl, apiKey, model } = await readJSONBody(req);

  // Resolve config from keystore or request params
  const store = readStore();
  const pConfig = store.providers?.[providerId];
  const cfg = {
    provider: providerId || undefined,
    customConfig: (baseUrl && apiKey) ? { baseUrl, apiKey, model } : undefined,
    model: model || pConfig?.model || PROVIDERS[providerId]?.defaultModel || ''
  };

  // If no customConfig, fall back to keystore
  if (!cfg.customConfig && pConfig?.apiKey && pConfig?.baseUrl) {
    cfg.customConfig = { baseUrl: pConfig.baseUrl, apiKey: pConfig.apiKey, model: cfg.model };
  }

  const result = await testConnection(cfg);
  sendJSON(res, 200, result);
}

// ============ GET /api/debate (SSE) ============
async function handleDebate(req, res, url) {
  const topic = url.searchParams.get('topic');
  if (!topic) return sendJSON(res, 400, { error: 'Missing topic' });

  // Access check: Pro unlimited | API key unlimited | Free demo 5/IP
  const access = await checkUserAccess(req.headers.authorization);
  const hasApiKey = resolveActiveConfig() !== null;
  const hasPro = access.plan === 'pro';
  const canUse = hasPro || hasApiKey || checkDemoLimit(req);
  if (!canUse) {
    return sendJSON(res, 429, { error: 'Demo limit reached. Login or configure API key for unlimited debates.' });
  }

  // Parse agents from query params
  let agents = null;
  const agentsParam = url.searchParams.get('agents');
  if (agentsParam) {
    try { agents = JSON.parse(agentsParam); } catch (_) {}
  }

  const provider = url.searchParams.get('provider') || FALLBACK_PROVIDER;
  const model = url.searchParams.get('model') || FALLBACK_MODEL;
  const customConfig = resolveActiveConfig()
    ? { baseUrl: resolveActiveConfig().baseUrl, apiKey: resolveActiveConfig().apiKey, model: resolveActiveConfig().model }
    : undefined;

  sendSSE(res);

  if (!hasPro && !hasApiKey) incrementDemoUsage(req);

  runDebate({
    topic, agents, provider, customConfig, model,
    emit: (event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (_) {}
    }
  }).then(({ transcript, summary }) => {
    try { res.end(); } catch (_) {}
  }).catch(e => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
      res.end();
    } catch (_) {}
  });
}

// ============ GET /api/demo-usage ============
function handleDemoUsage(req, res) {
  const ip = getClientIP(req);
  sendJSON(res, 200, { used: demoUsage[ip] || 0, limit: DEMO_LIMIT, remaining: Math.max(0, DEMO_LIMIT - (demoUsage[ip] || 0)) });
}

// ============ POST /api/share ============
async function handleShare(req, res) {
  const { topic, transcript, summary } = await readJSONBody(req);
  const id = crypto.randomBytes(4).toString('hex');
  try {
    if (!fs.existsSync(sharesDir)) fs.mkdirSync(sharesDir, { recursive: true });
    fs.writeFileSync(path.join(sharesDir, `${id}.json`), JSON.stringify({ topic, transcript, summary, createdAt: new Date().toISOString() }));
  } catch (_) {}
  sendJSON(res, 200, { ok: true, id, url: `http://localhost:${PORT}/share/${id}` });
}

// ============ Static file serving ============
function serveFile(res, fp, contentType) {
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType + (contentType.includes('text') ? '; charset=utf-8' : '') });
    res.end(data);
  });
}

function serveSharePage(res, id) {
  const fp = path.join(sharesDir, `${id}.json`);
  if (!fs.existsSync(fp)) {
    res.writeHead(404);
    res.end('Share not found');
    return;
  }
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const safeTopic = escapeHtml(data.topic);
  const turnsHtml = (data.transcript || []).map(t => {
    const safeName = escapeHtml(t.agentName);
    const safeRole = escapeHtml(t.agentRole);
    const safeContent = escapeHtml(t.content);
    const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(t.agentColor || '') ? t.agentColor : '#333';
    return `<div class="turn${t.isFinal ? ' echo' : ''}"><div class="turn-header" style="color:${safeColor}">${safeName} — ${safeRole}</div><div>${safeContent}</div></div>`;
  }).join('');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Hunch Debate</title><style>body{font-family:system-ui;max-width:800px;margin:40px auto;padding:0 20px;background:#fafafa;color:#1a1a2e}h1{font-size:28px}h2{color:#7048E8}.turn{padding:16px;margin:12px 0;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.1)}.turn-header{font-weight:700;margin-bottom:8px}.echo{background:#f0fdf4;border:2px solid #51CF66}</style></head><body><h1>📋 ${safeTopic}</h1>${turnsHtml}</body></html>`);
}

// ============ Auth Handlers ============

async function handleRegister(req, res) {
  const { email, password } = await readJSONBody(req);
  const result = await register(email, password);
  if (result.ok) {
    // Send verification email (non-blocking)
    const baseUrl = process.env.HUNCH_BASE_URL || `http://localhost:${PORT}`;
    const { sendVerificationEmail } = require('./lib/email');
    sendVerificationEmail(email, baseUrl).catch(() => {});
  }
  sendJSON(res, result.ok ? 200 : 400, result);
}

async function handleLogin(req, res) {
  const { email, password } = await readJSONBody(req);
  const result = await login(email, password);
  sendJSON(res, result.ok ? 200 : 401, result);
}

async function handleMe(req, res) {
  const result = await me(req.headers.authorization);
  sendJSON(res, result.ok ? 200 : 401, result);
}

async function handleGetDebates(req, res) {
  const result = await getDebates(req.headers.authorization);
  sendJSON(res, 200, result);
}

async function handleSaveDebate(req, res) {
  const body = await readJSONBody(req);
  const result = await saveDebate(req.headers.authorization, body);
  sendJSON(res, result.ok ? 200 : 401, result);
}

async function handleUpgrade(req, res) {
  const { userId } = await readJSONBody(req);
  const tokenPayload = require('./lib/users').extractToken(req.headers.authorization);
  if (!tokenPayload) return sendJSON(res, 401, { ok: false, error: 'Unauthorized' });
  const result = await upgradeUser(userId);
  sendJSON(res, 200, result);
}

// ============ Password Reset & Email Verification Handlers ============

async function handleResetRequest(req, res) {
  const { email } = await readJSONBody(req);
  const result = await requestPasswordReset(email);
  sendJSON(res, result.ok ? 200 : 400, result);
}

async function handleResetConfirm(req, res) {
  const { token, password } = await readJSONBody(req);
  const result = await confirmPasswordReset(token, password);
  sendJSON(res, result.ok ? 200 : 400, result);
}

async function handleVerifyEmail(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const result = await verifyEmail(token);
  // Return HTML page instead of JSON
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (result.ok) {
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Email Verified</title><style>body{font-family:system-ui;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f7ff;margin:0}.card{background:white;border-radius:20px;padding:48px;max-width:480px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.1)}h1{font-size:28px;color:#1a1a2e}p{color:#666;font-size:16px}a{display:inline-block;margin-top:24px;padding:12px 28px;background:#667eea;color:white;border-radius:10px;text-decoration:none;font-weight:600}</style></head><body><div class="card"><div style="font-size:64px;margin-bottom:16px">✅</div><h1>Email Verified!</h1><p>Your email has been verified successfully.</p><a href="/">← Back to Hunch</a></div></body></html>`);
  } else {
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Verification Failed</title><style>body{font-family:system-ui;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f7ff;margin:0}.card{background:white;border-radius:20px;padding:48px;max-width:480px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.1)}h1{font-size:28px;color:#e53e3e}p{color:#666;font-size:16px}a{display:inline-block;margin-top:24px;padding:12px 28px;background:#667eea;color:white;border-radius:10px;text-decoration:none;font-weight:600}</style></head><body><div class="card"><div style="font-size:64px;margin-bottom:16px">❌</div><h1>Verification Failed</h1><p>${result.error || 'The link may have expired.'}</p><a href="/">← Back to Hunch</a></div></body></html>`);
  }
}

// ============ PayPal Handlers ============

async function handlePayPalCreate(req, res) {
  const authResult = await me(req.headers.authorization);
  if (!authResult.ok) return sendJSON(res, 401, { ok: false, error: 'Login required to purchase' });
  if (!paypalConfigured()) return sendJSON(res, 503, { ok: false, error: 'PayPal not configured yet. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env' });

  const { amount = '99', currency = 'USD' } = await readJSONBody(req);
  const origin = `http://localhost:${PORT}`;
  const returnUrl = `${origin}/paypal/success`;
  const cancelUrl = `${origin}/paypal/cancel`;

  try {
    const result = await createPayment(amount, currency, returnUrl, cancelUrl);
    sendJSON(res, 200, result);
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
}

async function handlePayPalCapture(req, res) {
  const authResult = await me(req.headers.authorization);
  if (!authResult.ok) return sendJSON(res, 401, { ok: false, error: 'Login required' });

  const { orderId } = await readJSONBody(req);
  if (!orderId) return sendJSON(res, 400, { ok: false, error: 'orderId required' });

  try {
    const result = await capturePayment(orderId);
    if (result.ok) {
      // Upgrade user
      await upgradeUser(authResult.user.id);
    }
    sendJSON(res, 200, result);
  } catch (e) {
    sendJSON(res, 400, { ok: false, error: e.message });
  }
}

async function handlePayPalStatus(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const orderId = url.searchParams.get('orderId');
  if (!orderId) return sendJSON(res, 400, { ok: false, error: 'orderId required' });
  const order = getOrder(orderId);
  sendJSON(res, 200, { ok: true, order });
}

async function handlePlan(req, res) {
  const authResult = await me(req.headers.authorization);
  if (!authResult.ok) return sendJSON(res, 200, { plan: 'free', configured: false });
  sendJSON(res, 200, { plan: authResult.user.plan, configured: paypalConfigured() });
}

// Gumroad license verification
async function handleVerifyLicense(req, res) {
  const tokenPayload = extractToken(req.headers.authorization);
  if (!tokenPayload) return sendJSON(res, 401, { ok: false, error: 'Login required' });

  const verified = verifyToken(tokenPayload);
  if (!verified) return sendJSON(res, 401, { ok: false, error: 'Invalid or expired token' });

  const { licenseKey } = await readJSONBody(req);
  if (!licenseKey || typeof licenseKey !== 'string') {
    return sendJSON(res, 400, { ok: false, error: 'licenseKey required' });
  }

  try {
    const result = await verifyLicense(licenseKey, verified.sub);
    sendJSON(res, result.ok ? 200 : 400, result);
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
}

// Serve PayPal success/cancel pages
function servePayPalPage(res, type, orderId) {
  const color = type === 'success' ? '#48bb78' : '#e53e3e';
  const icon = type === 'success' ? '✅' : '❌';
  const title = type === 'success' ? 'Payment Successful!' : 'Payment Cancelled';
  const msg = type === 'success'
    ? 'Your Hunch Pro upgrade is confirmed. Enjoy unlimited debates!'
    : 'Payment was cancelled. You can try again anytime from Settings.';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#f7f7ff;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0}
    .card{background:white;border-radius:20px;padding:48px;max-width:480px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.1)}
    h1{font-size:28px;color:#1a1a2e;margin-bottom:12px}
    p{color:#666;font-size:16px;line-height:1.6}
    a{display:inline-block;margin-top:24px;padding:12px 28px;background:#667eea;color:white;border-radius:10px;text-decoration:none;font-weight:600}
  </style></head><body>
    <div class="card">
      <div style="font-size:64px;margin-bottom:16px">${icon}</div>
      <h1>${title}</h1>
      <p>${msg}</p>
      ${type === 'success' && orderId ? `<p style="font-size:13px;color:#999">Order: ${orderId}</p>` : ''}
      <a href="/">← Back to Hunch</a>
    </div>
  </body></html>`);
}


server.listen(PORT, () => {
  console.log(`
  Hunch — Multi-Model AI Debate Engine
  -------------------------------------
  URL:       http://localhost:${PORT}
  Agents:    Dynamic (1-10, customer configurable)
  Active:    [env fallback] provider=${FALLBACK_PROVIDER}
  `);
});
