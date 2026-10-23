'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handleLookup } = require('./lib/apc');

const PORT = Number(process.env.PORT) || 3000;
const INDEX = path.join(__dirname, 'public', 'index.html');
const MAX_BODY = 100 * 1024;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return send(res, 200, fs.readFileSync(INDEX), 'text/html; charset=utf-8');
  }

  const logo = req.method === 'GET' && pathname.match(/^\/logos\/(apc|asendia)\.png$/);
  if (logo) {
    const f = path.join(__dirname, 'public', 'logos', logo[1] + '.png');
    return send(res, 200, fs.readFileSync(f), 'image/png');
  }

  if (req.method === 'GET' && pathname === '/healthz') {
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/lookup') {
    try {
      const raw = await readBody(req);
      const { text } = JSON.parse(raw || '{}');
      const out = await handleLookup(text);
      return send(res, out.status, out.body);
    } catch {
      return send(res, 400, { error: 'Geçersiz istek.' });
    }
  }

  send(res, 404, { error: 'Bulunamadı.' });
});

server.listen(PORT, () => {
  console.log(`APC takip uygulaması: http://localhost:${PORT}`);
});
