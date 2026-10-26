'use strict';
const assert = require('node:assert/strict');
process.env.APC_BASE = 'http://127.0.0.1:4010';
process.env.ASENDIA_BASE = 'http://127.0.0.1:4010';
process.env.SAGAWA_BASE = 'http://127.0.0.1:4010';
process.env.DAIPOST_BASE = 'http://127.0.0.1:4010';
process.env.LAPOSTE_BASE = 'http://127.0.0.1:4010';
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
  assert.ok(an.points.some((x) => x.level === 'ok' && x.text.startsWith('Gümrük: Gümrükten geçti.')));
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
  assert.match(asMiss.error, /APC, Asendia, Sagawa, DAI Post ve La Poste/);

  // Sagawa: link ya da 12 haneli numara
  const ps = parseInput('https://tracking.sagawa-sgx.com/sgx/trackeng.asp?enc=ENG&cat=AWB&awb=564652084194');
  assert.deepEqual(ps.ids, ['564652084194']);
  assert.equal(ps.hints['564652084194'], 'sagawa');
  const sg = (await handleLookup('564652084194')).body.results[0]; // sadece numara: APC 404 -> Sagawa
  assert.equal(sg.ok, true);
  assert.equal(sg.provider, 'sagawa');
  assert.equal(sg.delivered, true);
  assert.equal(sg.analysis.verdict, 'delivered');
  assert.equal(sg.events.length, 11);
  assert.equal(sg.last.time, '2026-10-17T01:09:00.000Z'); // 10:09 Tokyo saati
  assert.equal(sg.events[sg.events.length - 1].time, '2026-10-09T14:56:00.000Z'); // 10:56 New York (EDT)
  assert.equal(sg.analysis.flags.attempts, 2);
  assert.equal(sg.localCarrier, 'Sagawa Express');
  assert.equal(sg.localCarrierUrl, 'http://k2k.sagawa-exp.co.jp/cgi-bin/mall.mmcgi?oku01=564652084194');
  assert.equal(sg.ref2, '6T3DHRZCY70G');
  assert.equal(sg.last.descriptionTr, 'Teslim edildi (imza/kaşe ile).');
  const sgLink = (await handleLookup('https://tracking.sagawa-sgx.com/sgx/trackeng.asp?awb=564652084194')).body.results[0];
  assert.equal(sgLink.provider, 'sagawa');
  // DAI Post: link ya da 20 haneli numara
  const pd = parseInput('https://daipost.com/track?tracknbr=00393580940174033739');
  assert.deepEqual(pd.ids, ['00393580940174033739']);
  assert.equal(pd.hints['00393580940174033739'], 'daipost');
  const dp = (await handleLookup('00393580940174033739')).body.results[0];
  assert.equal(dp.ok, true);
  assert.equal(dp.provider, 'daipost');
  assert.equal(dp.providerName, 'DAI Post');
  assert.equal(dp.events.length, 15);
  assert.equal(dp.last.category, 'Delivery Attempted');           // en yeni olay: bırakılamadı
  assert.equal(dp.last.descriptionTr, 'Paket güvenli şekilde bırakılamadı; teslim alma şekli hakkında bilgi verilecek.');
  assert.equal(dp.events.every((e) => e.descriptionTr), true);    // tüm olaylar Türkçeye çevrildi
  assert.equal(dp.delivered, false);
  assert.equal(dp.estTo.slice(0, 10), '2026-10-13');
  assert.equal(dp.localCarrierUrl, 'https://daipost.com/track?tracknbr=00393580940174033739');
  assert.equal((await handleLookup('00393580940174033700')).body.results[0].notFound, true);

  // Asendia kargosunun yerel kargosu DAI Post ise yerel durum da eklenir
  const al = (await handleLookup('AS015391233US')).body.results[0];
  assert.equal(al.provider, 'asendia');
  assert.equal(al.localCarrier, 'DAI Post');
  assert.equal(al.localTrackingNumber, '00393580940174033739');
  assert.ok(al.local && al.local.ok, 'yerel bilgi eklenmeli');
  assert.equal(al.local.name, 'DAI Post');
  assert.equal(al.local.events.length, 15);
  assert.equal(al.local.last.category, 'Delivery Attempted');
  assert.equal(al.local.url, 'https://daipost.com/track?tracknbr=00393580940174033739');
  assert.equal(as.local, undefined);   // DPD gibi desteklenmeyen yerel kargoda eklenmez

  // La Poste: S10 numarası Asendia'da bulunamazsa La Poste'a düşer
  const lp = (await handleLookup('LX110028346NL')).body.results[0];
  assert.equal(lp.ok, true);
  assert.equal(lp.provider, 'laposte');
  assert.equal(lp.providerName, 'La Poste');
  assert.equal(lp.events.length, 8);
  assert.equal(lp.delivered, false);
  assert.equal(lp.last.category, 'Delayed');
  assert.equal(lp.events.every((e) => e.descriptionTr), true);
  const al2 = (await handleLookup('18391P1007260002670741')).body.results[0];
  assert.equal(al2.provider, 'apc');
  assert.equal(al2.localCarrier, 'La Poste');
  assert.ok(al2.local && al2.local.ok, 'La Poste yerel bilgisi eklenmeli');
  assert.equal(al2.local.name, 'La Poste');
  assert.equal(al2.local.events.length, 8);
  assert.equal(al2.local.last.category, 'Delayed');
  const lpLink = parseInput('https://www.laposte.fr/outils/track-a-parcel?code=LX110028346NL');
  assert.equal(lpLink.hints['LX110028346NL'], 'laposte');

  const none = (await handleLookup('999999999999')).body.results[0];
  assert.equal(none.ok, false);
  assert.match(none.error, /APC, Asendia, Sagawa, DAI Post ve La Poste/);

  // Türkçe çeviri
  assert.equal(a.last.descriptionTr, 'Gecikme var.');
  assert.match(a.last.detailTr, /24 saatten uzun süredir hareket etmedi/);
  assert.equal(as.events.find((e) => e.description === 'Flight Departed').descriptionTr, 'Uçuş kalktı.');
  assert.equal(as.events[as.events.length - 1].descriptionTr, 'Gönderi bilgisi alındı (kargo henüz teslim alınmamış olabilir).');
  assert.ok(a.analysis.points.some((x) => x.text.startsWith('Gümrük: Gümrükten geçti.')));
  const { translate } = require('../lib/translate');
  assert.equal(translate('Delivered.'), 'Teslim edildi.');
  assert.equal(translate('Out for delivery.'), 'Dağıtıma çıktı.');
  assert.equal(translate('Bilinmeyen garip bir mesaj'), null);
  assert.equal(translate(''), null);

  // Boş girdi
  assert.equal((await handleLookup('')).status, 400);
  console.log('Tüm testler geçti');
})().catch((e) => { console.error(e); process.exit(1); });
