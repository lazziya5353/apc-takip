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

  // Gerçek yanıt: Delayed olayı en yeni, tahmini teslimat geçmiş, bir teslimat denemesi var
  const an = a.analysis;
  assert.equal(an.verdict, 'delayed');
  assert.equal(an.flags.returned, false);
  assert.equal(an.flags.attempts, 1);
  assert.equal(an.flags.overdue, true);
  assert.equal(an.overview.origin, 'East Rutherford, NJ');
  assert.equal(an.overview.dutyPaid, true);
  assert.ok(an.points.some((x) => x.level === 'ok' && x.text.startsWith('Gümrük: Cleared customs')));
  assert.ok(an.points.some((x) => x.text.includes('1 kez denendi')));

  // Yapay senaryolar (iade ve teslim örneklerini henüz gerçek yanıtta görmedik)
  const { summarize } = require('../lib/apc');
  const mk = (events, extra = {}) =>
    summarize('X1234567', {
      packageNumber: 'P1',
      estimatingDeliveryTimeFrom: '2099-01-01T00:00:00Z',
      estimatingDeliveryTimeTo: '2099-01-05T00:00:00Z',
      events,
      ...extra,
    });
  const ev = (iso, category, description) => ({
    eventDateTimeISOFormat: iso, eventCategory: category, description, location: 'X', countryCode: 'XX',
  });
  const recent = (h) => new Date(Date.now() - h * 36e5).toISOString();

  const returned = mk([ev(recent(5), 'In Transit', 'Returned to sender.'), ev(recent(50), 'In Transit', 'On the way.')]);
  assert.equal(returned.analysis.verdict, 'returned');

  const delivered = mk([ev(recent(5), 'Delivered', 'Delivered.'), ev(recent(50), 'In Transit', 'On the way.')], { hasArrived: true });
  assert.equal(delivered.analysis.verdict, 'delivered');
  assert.equal(delivered.delivered, true);

  const fine = mk([ev(recent(5), 'In Transit', 'On the way.'), ev(recent(30), 'In Transit', 'On the way.')]);
  assert.equal(fine.analysis.verdict, 'ontrack');

  const stalled = mk([ev(recent(24 * 5), 'In Transit', 'On the way.')]);
  assert.equal(stalled.analysis.verdict, 'delayed');
  assert.equal(stalled.analysis.flags.stalled, true);

  const empty = mk([]);
  assert.equal(empty.analysis.verdict, 'unknown');

  // Boş girdi
  assert.equal((await handleLookup('')).status, 400);
  console.log('Tüm testler geçti');
})().catch((e) => { console.error(e); process.exit(1); });
