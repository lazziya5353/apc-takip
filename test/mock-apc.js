'use strict';
// Sahte APC: yalnızca fixture'daki numara için yanıt verir, diğerlerine 404.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const asen = fs.readFileSync(path.join(__dirname, 'fixture-asendia.json'), 'utf8');
const sag = fs.readFileSync(path.join(__dirname, 'fixture-sagawa.html'), 'utf8');
const asenDai = JSON.stringify(Object.assign(JSON.parse(asen), {})).replace(/https:\/\/tracking\.dpd\.pt\/track-and-trace/g, 'https://daipost.com/track?tracknbr=00393580940174033739').replace(/"trackingNumberVendor":"[^"]*"/, '"trackingNumberVendor":"00393580940174033739"');
const dai = fs.readFileSync(path.join(__dirname, 'fixture-daipost.html'), 'utf8');
const daiNo = fs.readFileSync(path.join(__dirname, 'fixture-daipost-yok.html'), 'utf8');
const lap = fs.readFileSync(path.join(__dirname, 'fixture-laposte.json'), 'utf8');
const lapNo = fs.readFileSync(path.join(__dirname, 'fixture-laposte-yok.json'), 'utf8');
const hound = fs.readFileSync(path.join(__dirname, 'fixture-hound.json'), 'utf8');
const body = fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8');
const apcHound = JSON.stringify(Object.assign(JSON.parse(body), { packageNumber: 'HX61222011201046803', carrierTrackingNumber: 'HX61222011201046803', finalMileCarrier: 'Hound Express', externalTrackingUrl: null }));
const apcLa = JSON.stringify(Object.assign(JSON.parse(body), { packageNumber: 'LX110028346NL', carrierTrackingNumber: 'LX110028346NL', finalMileCarrier: 'La Poste', externalTrackingUrl: 'https://www.laposte.fr/outils/track-a-parcel?code=LX110028346NL' }));
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/track' && u.searchParams.get('id') === '18391P1019260002799999') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(apcHound);
  }
  if (u.pathname === '/api/track' && u.searchParams.get('id') === '18391P1007260002670741') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(apcLa);
  }
  if (u.pathname === '/api/track' && u.searchParams.get('id') === '18391P1008260002682920') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(body);
  }
  if (u.pathname === '/api/A1/TrackingBranded/Tracking' && (u.searchParams.get('trackingNumber') === 'AS015144682US' || u.searchParams.get('trackingNumber') === 'AS015391233US') && u.searchParams.get('trackingKey')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(u.searchParams.get('trackingNumber') === 'AS015391233US' ? asenDai : asen);
  }
  if (u.pathname === '/sgx/trackeng.asp') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(u.searchParams.get('awb') === '564652084194' ? sag : '<html><body>Sagawa Global Tracking<table><tr><td>DATE TIME</td><td>STATUS</td><td>COUNTRY</td></tr></table></body></html>');
  }
  if (u.pathname === '/Sabueso/ws/deliveryServices/trackOrder' && req.method === 'POST') {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let g = '';
      try { g = JSON.parse(b)[0].guideNumber; } catch {}
      if (req.headers.partnerkey !== 'test-key') { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(g === 'HX61222011201046803' ? hound : '[]');
    });
    return;
  }
  if (u.pathname.startsWith('/ssu/sun/back/suivi-unifie/')) {
    const ok = decodeURIComponent(u.pathname.split('/').pop()) === 'LX110028346NL';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
    return res.end(ok ? lap : lapNo);
  }
  if (u.pathname === '/track') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(u.searchParams.get('tracknbr') === '00393580940174033739' ? dai : daiNo);
  }
  res.writeHead(404); res.end();
}).listen(4010, '127.0.0.1');
