'use strict';

// Netlify'a yüklemek istersen: /api/lookup isteği bu fonksiyona yönlenir (bkz. netlify.toml).
const { handleLookup } = require('../../lib/apc');

exports.handler = async (event) => {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Yalnızca POST.' }) };
  }
  try {
    const { text } = JSON.parse(event.body || '{}');
    const out = await handleLookup(text);
    return { statusCode: out.status, headers, body: JSON.stringify(out.body) };
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Geçersiz istek.' }) };
  }
};
