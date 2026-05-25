// Hunch Email Service — SendGrid / SMTP fallback
// Supports: email verification, password reset
// If no SENDGRID_API_KEY is set, tokens are logged to console (dev mode)

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'reset-tokens.json');

// In-memory token store
let resetTokens = {};

function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      resetTokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    }
  } catch (_) { resetTokens = {}; }
}

function saveTokens() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // Clean expired tokens before saving
    const now = Date.now();
    for (const [token, data] of Object.entries(resetTokens)) {
      if (data.expiresAt < now) delete resetTokens[token];
    }
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(resetTokens, null, 2));
  } catch (_) {}
}

loadTokens();

/**
 * Generate a password reset token (valid for 1 hour)
 * @param {string} email
 * @returns {{ token: string, expiresAt: number }}
 */
function generateResetToken(email) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 3600000; // 1 hour
  resetTokens[token] = { email, expiresAt, used: false };
  saveTokens();
  return { token, expiresAt };
}

/**
 * Verify a reset token
 * @param {string} token
 * @returns {{ valid: boolean, email?: string, error?: string }}
 */
function verifyResetToken(token) {
  if (!token) return { valid: false, error: 'Token required' };
  const data = resetTokens[token];
  if (!data) return { valid: false, error: 'Invalid or expired token' };
  if (data.used) return { valid: false, error: 'Token already used' };
  if (data.expiresAt < Date.now()) {
    delete resetTokens[token];
    saveTokens();
    return { valid: false, error: 'Token expired' };
  }
  return { valid: true, email: data.email };
}

/**
 * Mark a reset token as used
 * @param {string} token
 */
function consumeResetToken(token) {
  if (resetTokens[token]) {
    delete resetTokens[token];
    saveTokens();
  }
}

/**
 * Generate an email verification token (valid for 24 hours)
 */
function generateVerifyToken(email) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 86400000; // 24 hours
  resetTokens[`verify_${token}`] = { email, expiresAt, used: false, type: 'verify' };
  saveTokens();
  return { token, expiresAt };
}

/**
 * Verify an email verification token
 */
function verifyEmailToken(token) {
  const key = `verify_${token}`;
  const data = resetTokens[key];
  if (!data) return { valid: false, error: 'Invalid or expired token' };
  if (data.used) return { valid: false, error: 'Token already used' };
  if (data.expiresAt < Date.now()) {
    delete resetTokens[key];
    saveTokens();
    return { valid: false, error: 'Token expired' };
  }
  delete resetTokens[key];
  saveTokens();
  return { valid: true, email: data.email };
}

/**
 * Send email via SendGrid API
 * @param {object} opts
 * @param {string} opts.to - recipient email
 * @param {string} opts.subject - email subject
 * @param {string} opts.html - email HTML body
 * @param {string} opts.text - email plain text body
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.HUNCH_FROM_EMAIL || 'noreply@hunch.so';
  const fromName = process.env.HUNCH_FROM_NAME || 'Hunch';

  if (!apiKey) {
    // Dev mode: log to console instead of sending
    console.log(`\n📧 [DEV MODE] Email not sent (no SENDGRID_API_KEY)`);
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Text: ${text?.slice(0, 200) || '(no text)'}\n`);
    return { ok: true, mode: 'dev' };
  }

  // Send via SendGrid API
  const body = JSON.stringify({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: fromName },
    subject,
    content: [
      { type: 'text/plain', value: text || '' },
      { type: 'text/html', value: html || '' }
    ]
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ ok: true });
      } else {
        let errBody = '';
        res.on('data', c => errBody += c);
        res.on('end', () => resolve({ ok: false, error: `SendGrid ${res.statusCode}: ${errBody.slice(0, 300)}` }));
      }
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

/**
 * Send password reset email
 * @param {string} email
 * @param {string} baseUrl - e.g., "https://hunch.so" or "http://localhost:3100"
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function sendResetEmail(email, baseUrl) {
  const { token } = generateResetToken(email);
  const resetUrl = `${baseUrl}?reset_token=${token}`;

  const subject = 'Hunch — Password Reset Request';
  const text = `You requested a password reset for your Hunch account.\n\nClick this link to reset your password (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`;
  const html = `
    <div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:32px;background:#fafafa">
      <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
        <h2 style="margin:0 0 16px;color:#1a1a2e">🔑 Reset Your Password</h2>
        <p style="color:#555;line-height:1.6">You requested a password reset for your Hunch account.</p>
        <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border-radius:10px;text-decoration:none;font-weight:600;margin:16px 0">Reset Password</a>
        <p style="color:#888;font-size:13px;margin-top:16px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    </div>`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send email verification
 * @param {string} email
 * @param {string} baseUrl
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function sendVerificationEmail(email, baseUrl) {
  const { token } = generateVerifyToken(email);
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;

  const subject = 'Hunch — Verify Your Email';
  const text = `Welcome to Hunch! Please verify your email address by clicking this link:\n${verifyUrl}\n\nThis link expires in 24 hours.`;
  const html = `
    <div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:32px;background:#fafafa">
      <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
        <h2 style="margin:0 0 16px;color:#1a1a2e">🤔 Welcome to Hunch!</h2>
        <p style="color:#555;line-height:1.6">Please verify your email address to get started.</p>
        <a href="${verifyUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border-radius:10px;text-decoration:none;font-weight:600;margin:16px 0">Verify Email</a>
        <p style="color:#888;font-size:13px;margin-top:16px">This link expires in 24 hours.</p>
      </div>
    </div>`;

  return sendEmail({ to: email, subject, html, text });
}

module.exports = {
  sendEmail,
  sendResetEmail,
  sendVerificationEmail,
  verifyResetToken,
  consumeResetToken,
  verifyEmailToken,
  generateResetToken
};
