// Hunch PayPal Integration — REST API
// Docs: https://developer.paypal.com/docs/api-basics/

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { upgradeUser } = require('./users');

const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox'; // 'sandbox' or 'live'
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const BASE_URL = PAYPAL_MODE === 'live' ? 'api.paypal.com' : 'api.sandbox.paypal.com';

const DB_FILE = path.join(__dirname, '..', 'data', 'paypal-orders.json');

function loadOrders() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (_) {}
  return {};
}
function saveOrders(orders) {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));
  } catch (_) {}
}

// ---------- HTTP helper (no axios, pure Node) ----------
function paypalRequest(method, path, body, accessToken) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'Content-Length': Buffer.byteLength(data)
    };
    if (!accessToken) delete headers['Authorization'];

    const opts = { hostname: BASE_URL, path, method, headers };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ---------- OAuth2: get access token ----------
async function getAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not configured');
  }
  const credentials = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: BASE_URL, path: '/v1/oauth2/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': 29
      }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { const d = JSON.parse(body); resolve(d.access_token); }
        catch { reject(new Error('Failed to get PayPal access token')); }
      });
    });
    req.on('error', reject);
    req.write('grant_type=client_credentials');
    req.end();
  });
}

// ---------- Create payment ----------
async function createPayment(amount, currency, returnUrl, cancelUrl) {
  const token = await getAccessToken();
  const orderId = crypto.randomBytes(8).toString('hex');

  const payment = {
    intent: 'CAPTURE',
    application_context: {
      brand_name: 'Hunch',
      landing_page: 'BILLING',
      user_action: 'PAY_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl
    },
    purchase_units: [{
      custom_id: orderId,
      description: 'Hunch Pro — Lifetime Access',
      amount: { currency_code: currency, value: amount }
    }]
  };

  const res = await paypalRequest('POST', '/v2/checkout/orders', payment, token);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`PayPal create payment failed: ${res.data.message || res.status}`);
  }

  // Find approval URL
  const approvalUrl = res.data.links?.find(l => l.rel === 'approve')?.href;
  if (!approvalUrl) throw new Error('No approval URL from PayPal');

  // Store order
  const orders = loadOrders();
  orders[orderId] = { status: 'pending', amount, currency, userId: null, createdAt: new Date().toISOString() };
  saveOrders(orders);

  return { ok: true, orderId, approvalUrl };
}

// ---------- Execute/Capture payment ----------
async function capturePayment(orderId) {
  const token = await getAccessToken();

  // First, get the order to check status
  const getRes = await paypalRequest('GET', `/v2/checkout/orders/${orderId}`, null, token);

  if (getRes.status === 404) throw new Error('Order not found');
  if (getRes.status !== 200) throw new Error('Failed to get PayPal order');

  const order = getRes.data;
  if (order.status !== 'APPROVED') {
    throw new Error(`Order not approved yet. Status: ${order.status}`);
  }

  // Capture the order
  const captureRes = await paypalRequest('POST', `/v2/checkout/orders/${orderId}/capture`, {}, token);

  if (captureRes.status < 200 || captureRes.status >= 300) {
    throw new Error(`Capture failed: ${captureRes.data.message || captureRes.status}`);
  }

  // Mark as completed
  const orders = loadOrders();
  if (orders[orderId]) {
    orders[orderId].status = 'completed';
    orders[orderId].completedAt = new Date().toISOString();
    saveOrders(orders);
  }

  return { ok: true, orderId, status: 'completed' };
}

// ---------- Get order status ----------
function getOrder(orderId) {
  const orders = loadOrders();
  return orders[orderId] || null;
}

// ---------- Check if configured ----------
function isConfigured() {
  return !!(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
}

module.exports = { createPayment, capturePayment, getOrder, isConfigured };
