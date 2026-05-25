// Hunch Gumroad Integration — License Key Verification
// Uses Gumroad's public license verify endpoint (no API key needed)
// Product: Hunch Pro - Lifetime ($49) — permalink: xdfzmhj

const https = require('https');
const { upgradeUser } = require('./users');

const PRODUCT_PERMALINK = 'xdfzmhj';

function gumroadRequest(formFields) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(formFields).toString();
    const opts = {
      hostname: 'api.gumroad.com',
      path: '/v2/licenses/verify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
        'User-Agent': 'Hunch/1.0'
      }
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Gumroad timeout')); });
    req.write(body);
    req.end();
  });
}

async function verifyLicense(licenseKey, userId) {
  if (!licenseKey || !userId) {
    return { ok: false, message: 'License key and user ID required.' };
  }

  let res;
  try {
    res = await gumroadRequest({
      product_permalink: PRODUCT_PERMALINK,
      license_key: licenseKey.trim()
    });
  } catch (e) {
    return { ok: false, message: 'Could not reach Gumroad: ' + e.message };
  }

  const { status, body } = res;

  if (status === 404 || body.success === false) {
    return { ok: false, message: body?.message || 'Invalid license key.' };
  }

  if (status < 200 || status >= 300) {
    return { ok: false, message: 'Gumroad error (status ' + status + ').' };
  }

  const purchase = body.purchase || {};

  // Reject refunded/disputed purchases
  if (purchase.refunded || purchase.chargebacked || purchase.disputed) {
    return { ok: false, message: 'This license has been refunded or disputed.' };
  }

  // Upgrade the user to Pro
  try {
    await upgradeUser(userId);
  } catch (e) {
    return { ok: false, message: 'Could not upgrade account: ' + e.message };
  }

  return {
    ok: true,
    plan: 'pro',
    message: 'License verified. Welcome to Hunch Pro!',
    purchase: { email: purchase.email, sale_id: purchase.sale_id || purchase.id }
  };
}

module.exports = { verifyLicense };
