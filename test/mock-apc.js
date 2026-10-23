'use strict';
// Sahte APC: yalnızca fixture'daki numara için yanıt verir, diğerlerine 404.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const asen = fs.readFileSync(path.join(__dirname, 'fixture-asendia.json'), 'utf8');
const sag = fs.readFileSync(path.join(__dirname, 'fixture-sagawa.html'), 'utf8');
const body = fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/track' && u.searchParams.get('id') === '18391P1008260002682920') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(body);
  }
  if (u.pathname === '/api/A1/TrackingBranded/Tracking' && u.searchParams.get('trackingNumber') === 'AS015144682US' && u.searchParams.get('trackingKey')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(asen);
  }
  if (u.pathname === '/sgx/trackeng.asp') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(u.searchParams.get('awb') === '564652084194' ? sag : '<html><body>Sagawa Global Tracking<table><tr><td>DATE TIME</td><td>STATUS</td><td>COUNTRY</td></tr></table></body></html>');
  }
  res.writeHead(404); res.end();
}).listen(4010, '127.0.0.1');
