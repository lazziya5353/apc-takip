'use strict';
const assert = require('node:assert/strict');
process.env.APC_BASE = 'http://127.0.0.1:4010';
process.env.ASENDIA_BASE = 'http://127.0.0.1:4010';
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

  const stalled = mk([ev(recent(24 * 14), 'In Transit', 'On the way.')]); // 14 gün: haftanın hangi günü olursa olsun 3+ iş günü
  assert.equal(stalled.analysis.verdict, 'delayed');
  assert.equal(stalled.analysis.flags.stalled, true);

  const empty = mk([]);
  assert.equal(empty.analysis.verdict, 'unknown');

  // Gecikme günü
  assert.ok(an.delayDays >= 1);
  assert.equal(an.headline, 'Gecikme var: tahmini teslimat tarihi geçti.');
  const late5 = mk([ev(recent(5), 'In Transit', 'On the way.')], {
    estimatingDeliveryTimeFrom: new Date(Date.now() - 7 * 864e5).toISOString(),
    estimatingDeliveryTimeTo: new Date(Date.now() - 5 * 864e5).toISOString(),
  });
  assert.equal(late5.analysis.delayDays, 5);
  assert.equal(fine.analysis.delayDays, null);

  // Local takip no ve carrier linki
  const { carrierLink } = require('../lib/apc');
  assert.equal(a.localTrackingNumber, 'HX61222041201040241');
  assert.equal(a.localCarrierPrefilled, false); // Hound Express için numaralı kalıp bilmiyoruz
  assert.equal(a.localCarrierUrl, 'https://www.hound-express.com/tracking-en.html');
  const rm = carrierLink('Royal Mail', 'GV370207019GB', 'https://www.royalmail.com/');
  assert.equal(rm.url, 'https://www.royalmail.com/track-your-item#/tracking-results/GV370207019GB');
  assert.equal(rm.prefilled, true);
  const unk = carrierLink('Hermes', 'H1034370003838201527', 'https://example.com/track');
  assert.deepEqual(unk, { url: 'https://example.com/track', prefilled: false });
  assert.equal(carrierLink('Royal Mail', 'A/B?x', null).url.includes('A%2FB%3Fx'), true);

  // İş günü hesabı (günler İstanbul saatine göre; 23 Eki 2026 Cuma)
  const { businessDaysSince } = require('../lib/apc');
  const t = (s) => Date.parse(s);
  const fri = t('2026-10-23T12:00:00+03:00');
  assert.equal(businessDaysSince(fri, t('2026-10-23T20:00:00+03:00')), 0); // aynı gün
  assert.equal(businessDaysSince(fri, t('2026-10-24T12:00:00+03:00')), 0); // Cumartesi
  assert.equal(businessDaysSince(fri, t('2026-10-25T12:00:00+03:00')), 0); // Pazar
  assert.equal(businessDaysSince(fri, t('2026-10-26T09:00:00+03:00')), 1); // Pazartesi
  assert.equal(businessDaysSince(fri, t('2026-10-30T09:00:00+03:00')), 5); // sonraki Cuma
  assert.equal(businessDaysSince(t('2026-10-19T09:00:00+03:00'), t('2026-10-23T09:00:00+03:00')), 4); // Pzt -> Cum
  assert.equal(businessDaysSince(t('2026-10-17T09:00:00+03:00'), t('2026-10-19T09:00:00+03:00')), 1); // Cmt -> Pzt
  assert.equal(businessDaysSince(fri, t('2026-10-22T12:00:00+03:00')), 0); // gelecek tarih
  // Gece yarısına yakın olay: UTC'de bir gün önce, İstanbul'da Cuma sabahı
  assert.equal(businessDaysSince(t('2026-10-22T22:30:00Z'), t('2026-10-23T12:00:00+03:00')), 0);

  // İadeye ilk dönüş zamanı (en eski iade olayı) ve yeni olaylar
  const twoReturns = mk([
    ev(recent(24 * 2), 'In Transit', 'Returned to sender.'),
    ev(recent(24 * 9), 'In Transit', 'Return to sender initiated.'),
    ev(recent(24 * 12), 'In Transit', 'On the way.'),
  ]);
  assert.equal(twoReturns.analysis.verdict, 'returned');
  assert.equal(twoReturns.analysis.returned.description, 'Return to sender initiated.');
  assert.equal(twoReturns.analysis.returned.time, twoReturns.events[1].time);
  assert.equal(fine.analysis.returned, null);
  assert.equal(typeof a.analysis.bdSinceLast, 'number');

  // Asendia: link ya da numara, APC ile karışık
  const { providerOf } = require('../lib/apc');
  assert.equal(providerOf('AS015144682US'), 'asendia');
  assert.equal(providerOf('18391P1008260002682920'), 'apc');
  assert.equal(providerOf('H1034370003838201527'), 'apc');
  assert.equal(providerOf('HX61222041201040241'), 'apc');
  const pa = parseInput('https://a1.asendiausa.com/tracking/?trackingnumber=as015144682us as015144682US 18391P1008260002682920');
  assert.deepEqual(pa.ids, ['AS015144682US', '18391P1008260002682920']);
  const mixed = await handleLookup('https://a1.asendiausa.com/tracking/?trackingnumber=AS015144682US 18391P1008260002682920');
  const [as, ap] = mixed.body.results;
  assert.equal(as.ok, true);
  assert.equal(as.provider, 'asendia');
  assert.equal(ap.provider, 'apc');
  assert.equal(as.packageNumber, 'AS015144682US');
  assert.equal(as.events.length, 10);
  assert.equal(as.last.description, 'In Transit');
  assert.equal(as.last.location, 'Oirschot');
  assert.equal(as.localCarrier, 'DPD Portugal');
  assert.equal(as.localTrackingNumber, '29130001741434');
  assert.equal(as.localCarrierUrl, 'https://tracking.dpd.pt/track-and-trace');
  assert.equal(as.analysis.overview.dutyPaid, true);
  assert.equal(as.analysis.returned, null);
  assert.equal(as.events.find((e) => e.description === 'Delayed In Transit').category, 'Delayed');
  const asMiss = (await handleLookup('AS999999999US')).body.results[0];
  assert.equal(asMiss.ok, false);
  assert.match(asMiss.error, /APC ve Asendia/);

  // Boş girdi
  assert.equal((await handleLookup('')).status, 400);
  console.log('Tüm testler geçti');
})().catch((e) => { console.error(e); process.exit(1); });
