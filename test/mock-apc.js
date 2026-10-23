'use strict';
// Sahte APC: yalnızca fixture'daki numara için yanıt verir, diğerlerine 404.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const body = fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/track' && u.searchParams.get('id') === '18391P1008260002682920') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(body);
  }
  res.writeHead(404); res.end();
}).listen(4010, '127.0.0.1');
