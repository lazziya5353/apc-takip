'use strict';

const { translate } = require('./translate');
const { parseSagawa } = require('./sagawa');
const { parseDaiPost } = require('./daipost');
const { parseLaPoste } = require('./laposte');
const { parseHound } = require('./hound');
const { parseCorreos } = require('./correos');

// APC takip API'sine sunucu tarafında bağlanır ve yanıtı sadeleştirir.
// Uç nokta: GET {APC_BASE}/api/track?id=<numara>

const APC_BASE = (process.env.APC_BASE || 'https://tracking.apc-pli.com').replace(/\/+$/, '');
// Asendia (a1.asendiausa.com) takip sayfasının kullandığı uç nokta. trackingKey sayfaya gömülü
// herkese açık anahtardır. Değişirse ASENDIA_KEY ortam değişkeniyle güncellenir.
const ASENDIA_BASE = (process.env.ASENDIA_BASE || 'https://a1reportapi.asendiaprod.com').replace(/\/+$/, '');
const ASENDIA_KEY = process.env.ASENDIA_KEY || 'AE654169-0B14-45F9-8498-A8E464E13D26';
// Asendia sayfası isteğe iki başlık ekliyor: Authorization (Basic ...) ve X-AsendiaOne-Apikey.
// Değerler koda yazılmaz, Netlify'da ortam değişkeni olarak ASENDIA_AUTH ve ASENDIA_APIKEY adıyla tanımlanır.
// Değerlerdeki baştaki/sondaki boşluk ve tırnaklar temizlenir. "Basic " önekini unutursan eklenir.
const cleanEnv = (v) => String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();
let ASENDIA_AUTH = cleanEnv(process.env.ASENDIA_AUTH);
if (ASENDIA_AUTH && !/^basic\s/i.test(ASENDIA_AUTH)) ASENDIA_AUTH = 'Basic ' + ASENDIA_AUTH;
const ASENDIA_APIKEY = cleanEnv(process.env.ASENDIA_APIKEY);
// Hata mesajında gösterilir (değerleri değil, yalnızca tanımlı olup olmadıklarını).
const asendiaSetup = () =>
  `ayar durumu: ASENDIA_AUTH ${ASENDIA_AUTH ? 'tanımlı' : 'YOK'}, ASENDIA_APIKEY ${ASENDIA_APIKEY ? 'tanımlı' : 'YOK'}`;
const SAGAWA_BASE = (process.env.SAGAWA_BASE || 'https://tracking.sagawa-sgx.com').replace(/\/+$/, '');
const LAPOSTE_BASE = (process.env.LAPOSTE_BASE || 'https://www.laposte.fr').replace(/\/+$/, '');
const CORREOS_BASE = (process.env.CORREOS_BASE || 'https://api1.correos.es').replace(/\/+$/, '');
const HOUND_BASE = (process.env.HOUND_BASE || 'https://ws_pods.hound-express.com').replace(/\/+$/, '');
const DAIPOST_BASE = (process.env.DAIPOST_BASE || 'https://daipost.com').replace(/\/+$/, '');
const TIMEOUT_MS = 15000;
const MAX_IDS = 50;
const CONCURRENCY = 4;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

// Kullanıcının yapıştırdığı tek bir parçadan (link ya da numara) takip numarasını çıkarır.
function extractId(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;

  if (/^https?:\/\//i.test(s)) {
    let u;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    const q = {};
    for (const [k, v] of u.searchParams) if (!(k.toLowerCase() in q)) q[k.toLowerCase()] = v;
    const fromQuery = q.id || q.trackingnumber || q.awb || q.tracking || q.tracknbr || q.code || q.rastero || q['tracking-number'];
    if (fromQuery) {
      s = fromQuery;
    } else {
      const segs = u.pathname.split('/').filter(Boolean);
      s = segs[segs.length - 1] || '';
    }
  }

  s = s.trim();
  // Sadece güvenli karakterler: numara dışarıdaki isteğin adresine gömülüyor.
  return /^[A-Za-z0-9_-]{6,64}$/.test(s) ? s : null;
}

// Asendia numaraları evrensel posta (S10) biçimindedir: 2 harf + 9-12 rakam + 2 harf (AS015144682US).
// APC numaraları (18391P..., HX..., H103...) bu kalıba uymaz, böylece hangi sistem olduğu numaradan anlaşılır.
function providerOf(id) {
  return /^[A-Za-z]{2}\d{9,12}[A-Za-z]{2}$/.test(id) || /^AS\d{9,}/i.test(id) ? 'asendia' : 'apc';
}

// Link yapıştırıldıysa hangi sisteme ait olduğunu sitenin adresinden anlarız.
function hintOf(raw) {
  const m = /^https?:\/\/([^/\s]+)/i.exec(String(raw || '').trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  if (h.includes('sagawa')) return 'sagawa';
  if (h.includes('daipost')) return 'daipost';
  if (h.includes('laposte')) return 'laposte';
  if (h.includes('hound-express')) return 'hound';
  if (h.includes('correos.es')) return 'correos';
  if (h.includes('asendia')) return 'asendia';
  if (h.includes('apc-pli')) return 'apc';
  return null;
}

// Serbest metni (satır, boşluk, virgül ayrımlı) numara listesine çevirir.
function parseInput(text) {
  const parts = String(text || '')
    .split(/[\s,;]+/)
    .filter(Boolean);
  const ids = [];
  const invalid = [];
  const hints = {};
  const seen = new Set();
  for (const p of parts) {
    const id = extractId(p);
    if (!id) {
      invalid.push(p.length > 80 ? p.slice(0, 80) + '…' : p);
    } else {
      const norm = providerOf(id) === 'asendia' ? id.toUpperCase() : id;
      const hint = hintOf(p);
      if (hint && !hints[norm]) hints[norm] = hint;
      if (!seen.has(norm)) {
        seen.add(norm);
        ids.push(norm);
      }
    }
  }
  return { ids, invalid, hints };
}

// İade kaydı tespiti: APC'nin iade olaylarının tam metnini henüz görmedik, bu yüzden
// kategori ve açıklama metinlerinde yaygın ifadeleri arıyoruz.
const RETURN_RE =
  /return(?:ed|ing)?\s+to\s+(?:the\s+)?(?:sender|shipper|origin)|being\s+returned|sent\s+back|\bRTS\b|\biade\b/i;

const fmtDay = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeZone: 'Europe/Istanbul' });

function dayText(iso) {
  const d = new Date(iso);
  return iso && !isNaN(d) ? fmtDay.format(d) : null;
}

function ymd(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
}

// İş günü hesabı: olayın tarihinden SONRAKİ günlerden hafta içi (Pzt-Cum) olanları, bugün dahil sayar.
// Örnek: Cuma günü olan olay için Cumartesi 0, Pazartesi 1, sonraki Cuma 5 iş günü eder.
// Resmi tatiller sayılmaz (hafta içine denk gelen tatil de iş günü sayılır). Günler İstanbul takvimine göre.
// Aynı hesap public/index.html içinde de var, ikisi aynı kalmalı.
function businessDaysSince(fromMs, toMs = Date.now()) {
  const start = Date.parse(ymd(fromMs));
  const end = Date.parse(ymd(toMs));
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  let n = 0;
  for (let t = start + 864e5, i = 0; t <= end && i < 4000; t += 864e5, i++) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

function placeText(e) {
  return e.location ? `, ${e.location}` : '';
}

// Hareket geçmişinden Türkçe bir durum özeti çıkarır (gecikme, iade, teslimat denemesi, gümrük).
function analyze(d, events, delivered) {
  const now = Date.now();
  const last = events[0] || null;
  const first = events[events.length - 1] || null;
  const points = [];
  const add = (level, text) => points.push({ level, text });

  const blob = (e) => `${e.category} ${e.description} ${e.detail}`;
  // returnEv: en yeni iade olayı, returnFirst: iadenin ilk başladığı olay (en eski).
  const returnEvs = events.filter((e) => RETURN_RE.test(blob(e)) || /return/i.test(e.category));
  const returnEv = returnEvs[0];
  const returnFirst = returnEvs[returnEvs.length - 1];
  const attempts = events.filter(
    (e) => /attempt/i.test(e.category) || /attempt/i.test(e.description)
  ).length;
  const delayEvs = events.filter((e) => /^delayed$/i.test(e.category));
  const nowDelayed = !!last && /^delayed$/i.test(last.category);
  const outForDelivery = !!last && /out for delivery/i.test(last.category);
  const lastAttempted = !!last && /attempt/i.test(last.category);
  const hoursSinceLast =
    last && last.time ? Math.max(0, (now - Date.parse(last.time)) / 36e5) : null;
  // Hafta sonları kargo hareket etmediği için hareketsizlik iş gününe göre ölçülür.
  const bdSinceLast = last && last.time ? businessDaysSince(Date.parse(last.time), now) : null;
  const estTo = d.estimatingDeliveryTimeTo ? Date.parse(d.estimatingDeliveryTimeTo) : NaN;
  const overdue = !delivered && !isNaN(estTo) && ymd(now) > ymd(estTo);
  // Kaç gün gecikmiş: bugün ile tahmini teslimatın son günü arasındaki takvim günü farkı.
  const overdueDays = overdue ? Math.round((Date.parse(ymd(now)) - Date.parse(ymd(estTo))) / 864e5) : 0;
  const stalled = !delivered && bdSinceLast !== null && bdSinceLast >= 3;
  const delayed = nowDelayed || overdue || stalled;

  let verdict;
  let headline;
  if (!last) {
    verdict = 'unknown';
    headline = 'Henüz hareket kaydı yok.';
  } else if (returnEv) {
    verdict = 'returned';
    headline = 'İade kaydı var.';
  } else if (delivered) {
    verdict = 'delivered';
    headline = 'Teslim edildi.';
  } else if (delayed) {
    verdict = 'delayed';
    // Gün sayıları arayüzde canlı hesaplanır (geçmiş kayıtlarda eskimesin diye metne gömülmez).
    headline = overdue
      ? 'Gecikme var: tahmini teslimat tarihi geçti.'
      : stalled
        ? 'Gecikme var: uzun süredir hareket yok.'
        : 'Gecikme var: kargo firması gecikme bildirdi.';
  } else if (lastAttempted) {
    verdict = 'attention';
    headline = 'Teslimat denendi, teslim edilemedi.';
  } else {
    verdict = 'ontrack';
    headline = 'Gecikme veya iade belirtisi bulunmuyor; gönderi normal şekilde ilerliyor.';
  }

  if (returnFirst) {
    add('bad', `İade kaydı: "${returnFirst.descriptionTr || returnFirst.description}" (${dayText(returnFirst.time)}${placeText(returnFirst)}).`);
  }
  if (delivered && last) {
    add('ok', `Teslim kaydı: ${dayText(last.time)}${placeText(last)}.`);
  }
  if (nowDelayed) {
    add('bad', `Kargo firması gecikme bildirdi (${dayText(last.time)}).`);
  } else if (delayEvs.length) {
    add('info', `Daha önce gecikme kaydı vardı (${dayText(delayEvs[0].time)}), sonrasında hareket var.`);
  }
  if (overdue) {
    add('bad', `Tahmini teslimat tarihi (${dayText(d.estimatingDeliveryTimeTo)}) geçti.`);
  }
  if (stalled && !nowDelayed) {
    add('warn', `Son güncellemeden bu yana 3 iş gününden fazla geçti (${dayText(last.time)}).`);
  }
  if (attempts > 0 && !delivered) {
    add('warn', `Teslimat ${attempts} kez denendi, teslim edilemedi.`);
  }
  if (outForDelivery) {
    add('info', 'Kargo dağıtımda.');
  }
  const customsEv = events.find((e) => /^customs$/i.test(e.category));
  if (customsEv) {
    const cleared = /clear|release/i.test(`${customsEv.description} ${customsEv.detail}`);
    add(
      cleared ? 'ok' : 'warn',
      `Gümrük: ${customsEv.descriptionTr || customsEv.description} (${dayText(customsEv.time)}${placeText(customsEv)}).`
    );
  }
  if (!delivered && !returnEv && !overdue && d.estimatingDeliveryTimeFrom && d.estimatingDeliveryTimeTo) {
    add(
      'info',
      `Tahmini teslimat: ${dayText(d.estimatingDeliveryTimeFrom)} – ${dayText(d.estimatingDeliveryTimeTo)}.`
    );
  }

  const endMs = delivered && last && last.time ? Date.parse(last.time) : now;
  const daysInTransit =
    first && first.time ? Math.max(0, Math.floor((endMs - Date.parse(first.time)) / 864e5)) : null;

  return {
    verdict,
    headline,
    delayDays: overdue ? overdueDays : null,
    bdSinceLast,
    returned: returnFirst
      ? { time: returnFirst.time, description: returnFirst.description, location: returnFirst.location }
      : null,
    points,
    flags: { delayed, returned: !!returnEv, attempts, overdue, stalled, nowDelayed },
    overview: {
      origin: first ? first.location || null : null,
      destination: d.shipToAddress || null,
      dutyPaid: typeof d.isDutyPaid === 'boolean' ? d.isDutyPaid : null,
      daysInTransit,
    },
  };
}

// Local carrier sayfasına, takip numarası hazır doldurulmuş link üretir.
// Listede yalnızca numaranın adreste çalıştığını bildiğimiz carrier'lar var. Diğerlerinde
// APC'nin verdiği genel carrier linki kullanılır ve numara elle yapıştırılır.
const CARRIER_LINKS = [
  // Sagawa Express (Japonya): Sagawa Global sayfasındaki "LOCAL TRACKING" linkinin kalıbı.
  { match: /dai ?post/i, url: 'https://daipost.com/track?tracknbr={n}' },
  { match: /la ?poste|colissimo/i, url: 'https://www.laposte.fr/outils/suivre-vos-envois?code={n}' },
  { match: /^correos\b|correos (españa|spain)/i, url: 'https://www.correos.es/es/en/tools/tracker/items/details?tracking-number={n}' },
  { match: /hound/i, url: 'https://www.hound-express.com/tracking.html?rastero={n}', prefilled: false }, // sayfa rastero parametresini kutuya doldurmuyor, numara elle yapıştırılır
  { match: /sagawa/i, url: 'http://k2k.sagawa-exp.co.jp/cgi-bin/mall.mmcgi?oku01={n}' },
  // Royal Mail: kullanıcının açtığı takip linkinin kalıbı.
  { match: /royal\s*mail/i, url: 'https://www.royalmail.com/track-your-item#/tracking-results/{n}' },
  // UPS: bu kalıp DOĞRULANMADI. Çalışmazsa sadece bu satırdaki adresi güncelle.
  { match: /^ups\b|united parcel/i, url: 'https://www.ups.com/track?tracknum={n}' },
];

function carrierLink(carrier, number, apcUrl) {
  const hit = carrier && number ? CARRIER_LINKS.find((c) => c.match.test(carrier)) : null;
  if (hit) {
    return { url: hit.url.replace('{n}', encodeURIComponent(number)), prefilled: hit.prefilled !== false };
  }
  return { url: apcUrl || null, prefilled: false };
}

function summarize(id, d) {
  const events = (Array.isArray(d.events) ? d.events : [])
    .map((e) => ({
      time: e.eventDateTimeISOFormat || null,
      description: e.description || '',
      detail: e.carrierMetaDescription || '',
      location: e.location || '',
      country: e.countryCode || '',
      category: e.eventCategory || '',
    }))
    .map((e) => ({ ...e, descriptionTr: translate(e.description), detailTr: translate(e.detail) }))
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  const last = events[0] || null;
  const delivered =
    d.hasArrived === true || (last && /^delivered$/i.test(last.category)) || false;
  const hoursSinceLast =
    last && last.time ? Math.max(0, (Date.now() - new Date(last.time).getTime()) / 36e5) : null;

  const localNumber = d.carrierTrackingNumber || d.packageNumber || null;
  const link = carrierLink(d.finalMileCarrier, localNumber, d.externalTrackingUrl);

  return {
    id,
    ok: true,
    packageNumber: d.packageNumber || null,
    carrierTrackingNumber: d.carrierTrackingNumber || null,
    service: d.serviceName || null,
    shipTo: d.shipToAddress || null,
    shipDate: d.shipDate || null,
    delivered,
    isEnRoute: d.isEnRoute === true,
    estFrom: d.estimatingDeliveryTimeFrom || null,
    estTo: d.estimatingDeliveryTimeTo || null,
    localCarrier: d.finalMileCarrier || null,
    localTrackingNumber: localNumber,
    localCarrierUrl: link.url,
    localCarrierPrefilled: link.prefilled,
    ref1: d.trackingReference1 || null,
    ref2: d.trackingReference2 || null,
    last,
    hoursSinceLast,
    analysis: analyze(d, events, delivered),
    events,
  };
}

async function fetchApc(id) {
  const url = `${APC_BASE}/api/track?id=${encodeURIComponent(id)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        referer: `${APC_BASE}/${encodeURIComponent(id)}`,
        'user-agent': UA,
      },
      signal: ctrl.signal,
    });

    if (res.status === 404 || res.status === 204) {
      return { id, ok: false, notFound: true, error: 'Bu numara APC sisteminde bulunamadı.' };
    }
    if (!res.ok) {
      return { id, ok: false, notFound: res.status === 500, error: `APC hata döndürdü (HTTP ${res.status}).` };
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { id, ok: false, error: 'APC beklenmeyen bir yanıt verdi.' };
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.events)) {
      return { id, ok: false, notFound: true, error: 'Bu numara için takip verisi yok.' };
    }
    return summarize(id, data);
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'APC zamanında yanıt vermedi.' : 'APC\'ye bağlanılamadı.';
    return { id, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Asendia yanıtını APC yanıtının şekline çevirir, böylece analiz ve arayüz aynı kalır.
function fromAsendia(id, data) {
  const sum = data.trackingBrandedSummary || {};
  const detail = Array.isArray(data.trackingBrandedDetail) ? data.trackingBrandedDetail : [];
  const events = detail.map((e) => {
    const loc = e.eventLocationDetails || {};
    const desc = e.eventDescription || '';
    let category = 'In Transit';
    if (/delivered/i.test(desc) && !/attempt|not\s+delivered|undeliver/i.test(desc)) category = 'Delivered';
    else if (/delay/i.test(desc) || e.eventCode === 'DIT') category = 'Delayed';
    return {
      eventDateTimeISOFormat: e.eventOn || null,
      description: desc,
      carrierMetaDescription: e.eventSource ? `Kaynak: ${e.eventSource}` : '',
      location: [loc.addressLine1, loc.city, loc.province].filter(Boolean).join(', ') || loc.countryName || '',
      countryCode: loc.countryIso2 || '',
      eventCategory: category,
    };
  });
  const link = typeof sum.finalMileTrackingLink === 'string' ? sum.finalMileTrackingLink : '';
  let finalMile = null;
  if (link) {
    try {
      const host = new URL(link).hostname.replace(/^(www|tracking|track)\./, '');
      finalMile = /dpd/i.test(host) ? 'DPD' + (sum.destinationCountry ? ' ' + sum.destinationCountry : '') : (/daipost/i.test(host) ? 'DAI Post' : /laposte/i.test(host) ? 'La Poste' : host);
    } catch {
      finalMile = null;
    }
  }
  const out = summarize(id, {
    packageNumber: sum.trackingNumberCustomerCarrierOriginal || id,
    carrierTrackingNumber: sum.trackingNumberVendor || null,
    serviceName: sum.service || null,
    shipToAddress: sum.destinationCountry || null,
    isDutyPaid: /\bDDP\b/i.test(sum.service || '') ? true : (/\bDAP\b|\bDDU\b/i.test(sum.service || '') ? false : undefined),
    finalMileCarrier: finalMile,
    externalTrackingUrl: /^https?:\/\//i.test(link) ? link : null,
    trackingReference2: sum.trackingNumberCustomer || null,
    events,
  });
  out.provider = 'asendia';
  out.providerName = 'Asendia';
  out.progress = sum.trackingProgress || null;
  out.lastMileMessage = sum.lastMileMessage || data.trackingServiceMessage || '';
  return out;
}

async function fetchAsendia(id) {
  const url = `${ASENDIA_BASE}/api/A1/TrackingBranded/Tracking?trackingKey=${encodeURIComponent(ASENDIA_KEY)}&trackingNumber=${encodeURIComponent(id)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/json',
        ...(ASENDIA_AUTH ? { authorization: ASENDIA_AUTH } : {}),
        ...(ASENDIA_APIKEY ? { 'x-asendiaone-apikey': ASENDIA_APIKEY } : {}),
        origin: 'https://a1.asendiausa.com',
        referer: 'https://a1.asendiausa.com/',
        'user-agent': UA,
      },
      signal: ctrl.signal,
    });
    if (res.status === 404 || res.status === 204) return { id, ok: false, notFound: true, error: 'Bu numara Asendia sisteminde bulunamadı.' };
    if (res.status === 401 || res.status === 403) {
      return { id, ok: false, error: 'Asendia yetki istedi (HTTP ' + res.status + '), ' + asendiaSetup() + '.' };
    }
    if (!res.ok) return { id, ok: false, error: `Asendia hata döndürdü (HTTP ${res.status}).` };
    let data;
    try {
      data = JSON.parse(await res.text());
    } catch {
      return { id, ok: false, error: 'Asendia beklenmeyen bir yanıt verdi.' };
    }
    const bodyCode = data && (data.responseStatusCode || (data.responseStatus && data.responseStatus.responseStatusCode));
    if (bodyCode === 401 || bodyCode === 403) {
      return { id, ok: false, error: 'Asendia yetki istedi (HTTP ' + bodyCode + '), ' + asendiaSetup() + '.' };
    }
    if (!data || !Array.isArray(data.trackingBrandedDetail) || data.trackingBrandedDetail.length === 0) {
      return { id, ok: false, notFound: true, error: 'Asendia bu numara için takip verisi bulamadı.' };
    }
    return fromAsendia(id, data);
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'Asendia zamanında yanıt vermedi.' : "Asendia'ya bağlanılamadı.";
    return { id, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSagawa(id) {
  const url = `${SAGAWA_BASE}/sgx/trackeng.asp?enc=ENG&cat=AWB&awb=${encodeURIComponent(id)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: 'text/html,*/*', 'accept-language': 'en-US,en;q=0.9', 'user-agent': UA },
      signal: ctrl.signal,
    });
    if (res.status === 404) return { id, ok: false, notFound: true, error: 'Bu numara Sagawa sisteminde bulunamadı.' };
    if (!res.ok) return { id, ok: false, error: `Sagawa hata döndürdü (HTTP ${res.status}).` };
    const parsed = parseSagawa(await res.text());
    if (!parsed) return { id, ok: false, notFound: true, error: 'Sagawa bu numara için takip verisi bulamadı.' };
    const out = summarize(id, {
      packageNumber: parsed.awb || id,
      carrierTrackingNumber: parsed.localNumber || null,
      finalMileCarrier: 'Sagawa Express',
      externalTrackingUrl: null,
      shipToAddress: parsed.dest || null,
      trackingReference2: parsed.ref || null,
      events: parsed.events,
    });
    out.provider = 'sagawa';
    out.providerName = 'Sagawa';
    return out;
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'Sagawa zamanında yanıt vermedi.' : "Sagawa'ya bağlanılamadı.";
    return { id, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDaiPost(id) {
  const url = `${DAIPOST_BASE}/track?tracknbr=${encodeURIComponent(id)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: 'text/html,*/*', 'accept-language': 'en-US,en;q=0.9', 'user-agent': UA },
      signal: ctrl.signal,
    });
    if (res.status === 404) return { id, ok: false, notFound: true, error: 'Bu numara DAI Post sisteminde bulunamadı.' };
    if (!res.ok) return { id, ok: false, error: `DAI Post hata döndürdü (HTTP ${res.status}).` };
    const parsed = parseDaiPost(await res.text());
    if (!parsed) return { id, ok: false, notFound: true, error: 'DAI Post bu numara için takip verisi bulamadı.' };
    const out = summarize(id, {
      packageNumber: parsed.number || id,
      carrierTrackingNumber: parsed.number || id,
      finalMileCarrier: 'DAI Post',
      externalTrackingUrl: null,
      estimatingDeliveryTimeFrom: parsed.estFrom,
      estimatingDeliveryTimeTo: parsed.estTo,
      events: parsed.events,
    });
    out.provider = 'daipost';
    out.providerName = 'DAI Post';
    return out;
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'DAI Post zamanında yanıt vermedi.' : "DAI Post'a bağlanılamadı.";
    return { id, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLaPoste(id) {
  const url = `${LAPOSTE_BASE}/ssu/sun/back/suivi-unifie/${encodeURIComponent(id)}?lang=en`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'accept-language': 'en-US,en;q=0.9', 'user-agent': UA },
      signal: ctrl.signal,
    });
    if (res.status === 404) return { id, ok: false, notFound: true, error: 'Bu numara La Poste sisteminde bulunamadı.' };
    if (!res.ok) return { id, ok: false, error: `La Poste hata döndürdü (HTTP ${res.status}).` };
    let data;
    try { data = await res.json(); } catch { return { id, ok: false, error: 'La Poste beklenmeyen bir yanıt verdi.' }; }
    const parsed = parseLaPoste(data);
    if (!parsed) return { id, ok: false, notFound: true, error: 'La Poste bu numara için takip verisi bulamadı.' };
    const out = summarize(id, {
      packageNumber: parsed.number || id,
      carrierTrackingNumber: parsed.number || id,
      finalMileCarrier: 'La Poste',
      externalTrackingUrl: null,
      estimatingDeliveryTimeFrom: null,
      estimatingDeliveryTimeTo: null,
      events: parsed.events,
    });
    out.provider = 'laposte';
    out.providerName = 'La Poste';
    return out;
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'La Poste zamanında yanıt vermedi.' : "La Poste'a bağlanılamadı.";
    return { id, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCorreos(id) {
  const url = `${CORREOS_BASE}/digital-services/searchengines/api/v1/envios?text=${encodeURIComponent(id)}&language=EN`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'accept-language': 'en-US,en;q=0.9', 'user-agent': UA },
      signal: ctrl.signal,
    });
    if (res.status === 404) return { id, ok: false, notFound: true, error: 'Bu numara Correos sisteminde bulunamadı.' };
    if (!res.ok) return { id, ok: false, error: `Correos hata döndürdü (HTTP ${res.status}).` };
    let data;
    try { data = await res.json(); } catch { return { id, ok: false, error: 'Correos beklenmeyen bir yanıt verdi.' }; }
    const parsed = parseCorreos(data);
    if (!parsed) return { id, ok: false, notFound: true, error: 'Correos bu numara için takip verisi bulamadı.' };
    const out = summarize(id, {
      packageNumber: parsed.number || id,
      carrierTrackingNumber: parsed.number || id,
      finalMileCarrier: 'Correos',
      externalTrackingUrl: null,
      estimatingDeliveryTimeFrom: null,
      estimatingDeliveryTimeTo: null,
      events: parsed.events,
    });
    out.provider = 'correos';
    out.providerName = 'Correos';
    return out;
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'Correos zamanında yanıt vermedi.' : "Correos'a bağlanılamadı.";
    return { id, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Hound Express: partnerKey ortam değişkeninden (HOUND_PARTNER_KEY) okunur, kodda tutulmaz.
// Anahtar yoksa sorgu yapılmaz ve sonuç "bulunamadı" sayılır, diğer sistemler etkilenmez.
async function fetchHound(id) {
  const key = process.env.HOUND_PARTNER_KEY;
  if (!key) return { id, ok: false, notFound: true, notConfigured: true, error: 'Hound Express anahtarı (HOUND_PARTNER_KEY) tanımlı değil.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${HOUND_BASE}/Sabueso/ws/deliveryServices/trackOrder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', partnerKey: key, 'user-agent': UA },
      body: JSON.stringify([{ guideNumber: id, comments: 'es' }]),
      signal: ctrl.signal,
    });
    if (res.status === 404) return { id, ok: false, notFound: true, error: 'Bu numara Hound Express sisteminde bulunamadı.' };
    if (res.status === 401 || res.status === 403) return { id, ok: false, error: 'Hound Express anahtarı kabul edilmedi.' };
    if (!res.ok) return { id, ok: false, error: `Hound Express hata döndürdü (HTTP ${res.status}).` };
    let data;
    try { data = await res.json(); } catch { return { id, ok: false, notFound: true, error: 'Hound Express bu numara için takip verisi bulamadı.' }; }
    const parsed = parseHound(data);
    if (!parsed) return { id, ok: false, notFound: true, error: 'Hound Express bu numara için takip verisi bulamadı.' };
    const out = summarize(id, {
      packageNumber: parsed.number || id,
      carrierTrackingNumber: parsed.number || id,
      finalMileCarrier: 'Hound Express',
      externalTrackingUrl: null,
      estimatingDeliveryTimeFrom: null,
      estimatingDeliveryTimeTo: null,
      events: parsed.events,
    });
    out.provider = 'hound';
    out.providerName = 'Hound Express';
    return out;
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'Hound Express zamanında yanıt vermedi.' : "Hound Express'e bağlanılamadı.";
    return { id, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

const PROVIDERS = {
  apc: { name: 'APC', run: (id) => fetchApc(id) },
  asendia: { name: 'Asendia', run: (id) => fetchAsendia(id) },
  sagawa: { name: 'Sagawa', run: (id) => fetchSagawa(id) },
  daipost: { name: 'DAI Post', run: (id) => fetchDaiPost(id) },
  laposte: { name: 'La Poste', run: (id) => fetchLaPoste(id) },
  hound: { name: 'Hound Express', run: (id) => fetchHound(id) },
  correos: { name: 'Correos', run: (id) => fetchCorreos(id) },
};

// Hangi sisteme hangi sırayla soracağımız: link varsa onun sitesi, değilse numara biçimi.
// Sadece 12 rakam hem APC (yerel carrier no) hem Sagawa olabilir: ikisi de denenir.
function providerOrder(id, hint) {
  let first;
  if (hint && PROVIDERS[hint]) first = hint;
  else if (providerOf(id) === 'asendia') first = 'asendia';
  else if (/^\d{20}$/.test(id)) first = 'daipost';
  else if (/^\d{12}$/.test(id)) first = 'apc';
  else first = 'apc';
  const rest = Object.keys(PROVIDERS).filter((k) => k !== first);
  if (/^\d{12}$/.test(id) && first === 'apc') rest.sort((a) => (a === 'sagawa' ? -1 : 1));
  if (/^[A-Za-z]{2}\d{9,12}[A-Za-z]{2}$/.test(id) && !hint) rest.sort((a) => (a === 'laposte' ? -1 : 1));
  return [first, ...rest];
}

// Asıl kargonun (Asendia, APC...) yerel kargosu bizim de sorgulayabildiğimiz bir sistemse
// (şimdilik DAI Post), yerel kargonun son durumu da çekilip sonuca eklenir: r.local
const LOCAL_CARRIERS = [{ match: /dai ?post/i, key: 'daipost' }, { match: /la ?poste|colissimo/i, key: 'laposte' }, { match: /hound/i, key: 'hound' }, { match: /^correos\b|correos (españa|spain)/i, key: 'correos' }];

async function attachLocal(r) {
  try {
    const lc = r.localCarrier && LOCAL_CARRIERS.find((c) => c.match.test(r.localCarrier));
    const num = r.localTrackingNumber;
    if (!lc || r.provider === lc.key || !num || !/^[A-Za-z0-9_-]{6,64}$/.test(num)) return r;
    const l = await PROVIDERS[lc.key].run(num);
    const name = PROVIDERS[lc.key].name;
    if (l.notConfigured) return r; // anahtar yoksa yerel kutu hiç eklenmez
    if (!l.ok) {
      r.local = { provider: lc.key, name, number: num, ok: false, notFound: !!l.notFound, error: l.error };
      return r;
    }
    r.local = {
      provider: lc.key, name, number: num, ok: true,
      delivered: l.delivered, verdict: l.analysis.verdict, headline: l.analysis.headline,
      estFrom: l.estFrom, estTo: l.estTo, last: l.last, events: l.events, url: l.localCarrierUrl,
    };
  } catch { /* yerel bilgi eklenemese de asıl sonuç bozulmaz */ }
  return r;
}

// Önce en olası sisteme sorar. Bulamazsa ya da hata verirse sıradakini dener.
async function fetchTrack(id, hint) {
  const order = providerOrder(id, hint);
  const errors = [];
  for (const key of order) {
    const r = await PROVIDERS[key].run(id);
    if (r.ok) {
      if (!r.provider) { r.provider = key; r.providerName = PROVIDERS[key].name; }
      return attachLocal(r);
    }
    errors.push(r);
  }
  const real = errors.find((e) => !e.notFound);
  if (real && errors[0] === real) return real; // en olası sistem gerçek bir hata verdi (yetki, bağlantı)
  if (real) return { id, ok: false, error: real.error };
  return { id, ok: false, notFound: true, error: "Numara APC, Asendia, Sagawa, DAI Post, La Poste, Hound Express ve Correos'ta bulunamadı. Numarayı kontrol et." };
}

// Numaraları sınırlı eşzamanlılıkla sorgular, giriş sırasını korur.
async function trackMany(ids, hints = {}) {
  const list = ids.slice(0, MAX_IDS);
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fetchTrack(list[i], hints[list[i]]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  return out;
}

// Ortak istek işleyicisi: sunucu ve Netlify fonksiyonu aynı mantığı kullanır.
async function handleLookup(text) {
  const { ids, invalid, hints } = parseInput(text);
  if (ids.length === 0) {
    return { status: 400, body: { error: 'Geçerli bir takip numarası veya bağlantı bulunamadı.', invalid } };
  }
  const truncated = ids.length > MAX_IDS;
  const results = await trackMany(ids, hints);
  return {
    status: 200,
    body: { checkedAt: new Date().toISOString(), truncated, maxIds: MAX_IDS, invalid, results },
  };
}

module.exports = {
  extractId, parseInput, providerOf, hintOf, providerOrder, fromAsendia, summarize, carrierLink, businessDaysSince, fetchTrack, trackMany,
  handleLookup, MAX_IDS,
};
