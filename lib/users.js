// Hunch Users — SQL.js + JWT + bcryptjs
// Data stored in data/users.json (SQL.js in-memory DB + auto-save)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const WALLET_FILE = path.join(DATA_DIR, 'wallet.json');
const JWT_SECRET = process.env.HUNCH_JWT_SECRET || (() => {
  const randomSecret = crypto.randomBytes(32).toString('hex');
  process.stderr.write('[WARN] HUNCH_JWT_SECRET not set — using random key. All tokens invalid on restart.\n');
  return randomSecret;
})();
const JWT_EXPIRES = '30d';

// ---------- SQL.js setup ----------
let initSqlJs;
try { initSqlJs = require('sql.js'); } catch (e) {}

// In-memory DB
let db = null;

async function getDB() {
  if (db) return db;
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT DEFAULT 'free',
      email_verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS debates (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      topic TEXT,
      agents INTEGER,
      provider TEXT,
      model TEXT,
      summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  // Restore from disk if exists
  if (fs.existsSync(USERS_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      db.import({ table: 'users', rows: saved.users || [] });
      db.import({ table: 'debates', rows: saved.debates || [] });
    } catch (_) {}
  }
  return db;
}

function saveDB() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const users = db.exec('SELECT id,email,password_hash,plan,created_at,last_login FROM users')[0];
    const debates = db.exec('SELECT id,user_id,topic,agents,provider,model,summary,created_at FROM debates')[0];
    fs.writeFileSync(USERS_FILE, JSON.stringify({
      users: users ? users.values.map(row => ({ id: row[0], email: row[1], password_hash: row[2], plan: row[3], created_at: row[4], last_login: row[5] })) : [],
      debates: debates ? debates.values.map(row => ({ id: row[0], user_id: row[1], topic: row[2], agents: row[3], provider: row[4], model: row[5], summary: row[6], created_at: row[7] })) : []
    }, null, 2));
  } catch (_) {}
}

// ---------- Wallet (for PayPal) ----------
function getWallet(userId) {
  try {
    if (fs.existsSync(WALLET_FILE)) {
      const data = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
      return data[userId] || { plan: 'free', paypalEmail: '', upgradedAt: null };
    }
  } catch (_) {}
  return { plan: 'free', paypalEmail: '', upgradedAt: null };
}

function setWallet(userId, wallet) {
  try {
    let data = {};
    if (fs.existsSync(WALLET_FILE)) {
      try { data = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8')); } catch (_) {}
    }
    data[userId] = wallet;
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WALLET_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

// ---------- Auth helpers ----------
function genId() { return crypto.randomUUID(); }

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
function verifyPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }

function signToken(userId, email) {
  return jwt.sign({ sub: userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (_) { return null; }
}

// Express-style: extract Bearer token from Authorization header
function extractToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

// ---------- API ----------

// POST /api/auth/register
async function register(email, password) {
  if (!email || !password) return { ok: false, error: 'Email and password required' };
  if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return { ok: false, error: 'Invalid email format' };

  const database = await getDB();
  const stmt = database.prepare('SELECT id FROM users WHERE email = ?');
  stmt.bind([email]);
  const exists = stmt.step();
  stmt.free();
  if (exists) {
    return { ok: false, error: 'Email already registered' };
  }

  const id = genId();
  const hash = hashPassword(password);
  database.run(`INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)`, [id, email, hash]);
  saveDB();

  const token = signToken(id, email);
  return { ok: true, token, user: { id, email, plan: 'free' } };
}

// POST /api/auth/login
async function login(email, password) {
  if (!email || !password) return { ok: false, error: 'Email and password required' };

  const database = await getDB();
  const stmt = database.prepare('SELECT id, email, password_hash, plan FROM users WHERE email = ?');
  stmt.bind([email]);
  if (!stmt.step()) {
    stmt.free();
    return { ok: false, error: 'Invalid email or password' };
  }
  const [id, e, hash, plan] = stmt.get();
  stmt.free();
  if (!verifyPassword(password, hash)) return { ok: false, error: 'Invalid email or password' };

  database.run(`UPDATE users SET last_login = datetime('now') WHERE id = ?`, [id]);
  saveDB();

  const token = signToken(id, e);
  return { ok: true, token, user: { id, email: e, plan: plan || 'free' } };
}

// GET /api/auth/me — requires Authorization: Bearer <token>
async function me(authHeader) {
  const token = extractToken(authHeader);
  if (!token) return { ok: false, error: 'Unauthorized', user: null };
  const payload = verifyToken(token);
  if (!payload) return { ok: false, error: 'Invalid or expired token', user: null };

  const database = await getDB();
  const result = database.exec(`SELECT id, email, plan, created_at FROM users WHERE id = ?`, [payload.sub]);
  if (!result.length || !result[0].values.length) return { ok: false, error: 'User not found', user: null };

  const [id, email, plan, created_at] = result[0].values[0];
  const wallet = getWallet(id);
  return { ok: true, user: { id, email, plan: wallet.plan || plan || 'free', created_at } };
}

// POST /api/auth/upgrade — upgrade user to Pro (called after PayPal confirmed)
async function upgradeUser(userId) {
  const database = await getDB();
  database.run(`UPDATE users SET plan = 'pro' WHERE id = ?`, [userId]);
  const wallet = getWallet(userId);
  wallet.plan = 'pro';
  wallet.upgradedAt = new Date().toISOString();
  setWallet(userId, wallet);
  saveDB();
  return { ok: true, plan: 'pro' };
}

// GET /api/auth/debates — list user's debate history
async function getDebates(authHeader) {
  const token = extractToken(authHeader);
  if (!token) return { ok: false, debates: [] };
  const payload = verifyToken(token);
  if (!payload) return { ok: false, debates: [] };

  const database = await getDB();
  const result = database.exec(`SELECT id, topic, agents, provider, model, summary, created_at FROM debates WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, [payload.sub]);
  if (!result.length) return { ok: true, debates: [] };

  const cols = result[0].columns;
  const debates = result[0].values.map(row => {
    const obj = {}; cols.forEach((c, i) => obj[c] = row[i]); return obj;
  });
  return { ok: true, debates };
}

// POST /api/auth/debates — save a debate
async function saveDebate(authHeader, debate) {
  const token = extractToken(authHeader);
  if (!token) return { ok: false };
  const payload = verifyToken(token);
  if (!payload) return { ok: false };

  const database = await getDB();
  const id = genId();
  database.run(`INSERT INTO debates (id, user_id, topic, agents, provider, model, summary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, payload.sub, debate.topic || '', debate.agents || 5, debate.provider || '', debate.model || '', debate.summary || '']);
  saveDB();
  return { ok: true, id };
}

// Check if user has API key configured OR is Pro
async function checkUserAccess(authHeader) {
  const m = await me(authHeader);
  if (!m.ok) return { hasAccess: false, reason: 'unauthenticated', plan: 'free' };
  if (m.user.plan === 'pro') return { hasAccess: true, reason: 'pro', plan: 'pro' };
  // free users also need an API key configured to use debate
  const hasKey = require('./keystore').resolveActiveConfig() !== null;
  return { hasAccess: hasKey, reason: hasKey ? 'api-key' : 'no-api-key', plan: m.user.plan };
}

// POST /api/auth/reset-request — send password reset email
async function requestPasswordReset(email) {
  if (!email) return { ok: false, error: 'Email required' };
  const database = await getDB();
  const stmt = database.prepare('SELECT id FROM users WHERE email = ?');
  stmt.bind([email]);
  if (!stmt.step()) {
    stmt.free();
    // Don't reveal whether email exists — always return ok
    return { ok: true, message: 'If the email exists, a reset link has been sent.' };
  }
  stmt.free();
  // Email exists — generate token and send
  const baseUrl = process.env.HUNCH_BASE_URL || `http://localhost:${process.env.HUNCH_PORT || 3100}`;
  const { sendResetEmail } = require('./email');
  const sendResult = await sendResetEmail(email, baseUrl);
  if (!sendResult.ok && sendResult.mode !== 'dev') {
    return { ok: false, error: 'Failed to send reset email' };
  }
  return { ok: true, message: 'If the email exists, a reset link has been sent.' };
}

// POST /api/auth/reset-confirm — confirm password reset
async function confirmPasswordReset(token, newPassword) {
  if (!token || !newPassword) return { ok: false, error: 'Token and new password required' };
  if (newPassword.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };

  const { verifyResetToken, consumeResetToken } = require('./email');
  const verification = verifyResetToken(token);
  if (!verification.valid) return { ok: false, error: verification.error };

  const database = await getDB();
  const email = verification.email;
  const hash = hashPassword(newPassword);
  database.run(`UPDATE users SET password_hash = ? WHERE email = ?`, [hash, email]);
  saveDB();
  consumeResetToken(token);

  return { ok: true, message: 'Password reset successful' };
}

// POST /api/auth/verify-email — mark email as verified
async function verifyEmail(token) {
  const { verifyEmailToken } = require('./email');
  const result = verifyEmailToken(token);
  if (!result.valid) return { ok: false, error: result.error };

  const database = await getDB();
  database.run(`UPDATE users SET email_verified = 1 WHERE email = ?`, [result.email]);
  saveDB();
  return { ok: true, message: 'Email verified successfully' };
}

module.exports = {
  register, login, me, upgradeUser,
  verifyToken, extractToken,
  getDebates, saveDebate,
  getWallet, setWallet,
  checkUserAccess,
  requestPasswordReset, confirmPasswordReset, verifyEmail,
  getDB
};
