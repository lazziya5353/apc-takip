'use strict';

// /api/assistant isteği bu fonksiyona yönlenir (bkz. netlify.toml). Anahtar: ANTHROPIC_API_KEY.
const { handleAssistant } = require('../../lib/assistant');

exports.handler = async (event) => {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Yalnızca POST.' }) };
  }
  if ((event.body || '').length > 200 * 1024) {
    return { statusCode: 413, headers, body: JSON.stringify({ error: 'İstek çok büyük.' }) };
  }
  try {
    const ip = (event.headers && (event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'])) || 'x';
    const out = await handleAssistant(JSON.parse(event.body || '{}'), { ip: String(ip).split(',')[0].trim() });
    return { statusCode: out.status, headers, body: JSON.stringify(out.body) };
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Geçersiz istek.' }) };
  }
};
