// Minimal .env loader (zero dependencies)
const fs = require('fs');
const path = require('path');

function loadEnv(filePath) {
  filePath = filePath || path.join(__dirname, '..', '.env');
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
    result[k] = v;
  }
  return result;
}

module.exports = loadEnv;
