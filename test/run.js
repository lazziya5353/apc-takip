'use strict';
const assert = require('node:assert/strict');
process.env.APC_BASE = 'http://127.0.0.1:4010';
const { parseInput, handleLookup } = require('../lib/apc');

(async () => {
  // Girdi ayrıştırma
  const p = parseInput(`https://tracking.apc-pli.com/18391P1008260002682920
    H1034370003838201527, 18391P1008260002682920
    https://tracking.apc-pli.com/api/track?id=18391P1012260002728838
    ???`);
  assert.deepEqual(p.ids, ['18391P1008260002682920', 'H1034370003838201527', '18391P1012260002728838']);
  assert.equal(p.invalid.length, 1);

  // Enjeksiyon denemeleri reddedilmeli
  assert.equal(parseInput('../../etc/passwd').ids.length, 0);
  assert.equal(parseInput('a/b?x=1&y=2').ids.length, 0);

  // Gerçek yanıtla sorgu
  const out = await handleLookup('https://tracking.apc-pli.com/18391P1008260002682920\n18391P0000000000000000');
  assert.equal(out.status, 200);
  const [a, b] = out.body.results;
  assert.equal(a.ok, true);
  assert.equal(a.packageNumber, 'HX61222041201040241');
  assert.equal(a.localCarrier, 'Hound Express');
  assert.equal(a.last.category, 'Delayed');          // en yeni olay
  assert.equal(a.last.time, '2026-10-23T00:55:00+00:00');
  assert.equal(a.delivered, false);
  assert.equal(a.events.length, 17);
  assert.equal(b.ok, false);

  // Boş girdi
  assert.equal((await handleLookup('')).status, 400);
  console.log('Tüm testler geçti');
})().catch((e) => { console.error(e); process.exit(1); });
