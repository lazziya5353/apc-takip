'use strict';

// APC takip API'sine sunucu tarafında bağlanır ve yanıtı sadeleştirir.
// Uç nokta: GET {APC_BASE}/api/track?id=<numara>

const APC_BASE = (process.env.APC_BASE || 'https://tracking.apc-pli.com').replace(/\/+$/, '');
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
    const fromQuery =
      u.searchParams.get('id') ||
      u.searchParams.get('trackingNumber') ||
      u.searchParams.get('tracking');
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

// Serbest metni (satır, boşluk, virgül ayrımlı) numara listesine çevirir.
function parseInput(text) {
  const parts = String(text || '')
    .split(/[\s,;]+/)
    .filter(Boolean);
  const ids = [];
  const invalid = [];
  const seen = new Set();
  for (const p of parts) {
    const id = extractId(p);
    if (!id) {
      invalid.push(p.length > 80 ? p.slice(0, 80) + '…' : p);
    } else if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { ids, invalid };
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
  const returnEv = events.find((e) => RETURN_RE.test(blob(e)) || /return/i.test(e.category));
  const attempts = events.filter(
    (e) => /attempt/i.test(e.category) || /attempt/i.test(e.description)
  ).length;
  const delayEvs = events.filter((e) => /^delayed$/i.test(e.category));
  const nowDelayed = !!last && /^delayed$/i.test(last.category);
  const outForDelivery = !!last && /out for delivery/i.test(last.category);
  const lastAttempted = !!last && /attempt/i.test(last.category);
  const hoursSinceLast =
    last && last.time ? Math.max(0, (now - Date.parse(last.time)) / 36e5) : null;
  const estTo = d.estimatingDeliveryTimeTo ? Date.parse(d.estimatingDeliveryTimeTo) : NaN;
  const overdue = !delivered && !isNaN(estTo) && ymd(now) > ymd(estTo);
  const stalled = !delivered && hoursSinceLast !== null && hoursSinceLast >= 72;
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
    headline = 'Gecikme var.';
  } else if (lastAttempted) {
    verdict = 'attention';
    headline = 'Teslimat denendi, teslim edilemedi.';
  } else {
    verdict = 'ontrack';
    headline = 'Gecikme veya iade belirtisi yok, normal ilerliyor.';
  }

  if (returnEv) {
    add('bad', `İade kaydı: "${returnEv.description}" (${dayText(returnEv.time)}${placeText(returnEv)}).`);
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
    add('warn', `Son hareketten bu yana yaklaşık ${Math.floor(hoursSinceLast / 24)} gün geçti.`);
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
      `Gümrük: ${customsEv.description} (${dayText(customsEv.time)}${placeText(customsEv)}).`
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
    points,
    flags: { delayed, returned: !!returnEv, attempts, overdue, stalled },
    overview: {
      origin: first ? first.location || null : null,
      destination: d.shipToAddress || null,
      dutyPaid: typeof d.isDutyPaid === 'boolean' ? d.isDutyPaid : null,
      daysInTransit,
    },
  };
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
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  const last = events[0] || null;
  const delivered =
    d.hasArrived === true || (last && /^delivered$/i.test(last.category)) || false;
  const hoursSinceLast =
    last && last.time ? Math.max(0, (Date.now() - new Date(last.time).getTime()) / 36e5) : null;

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
    localCarrierUrl: d.externalTrackingUrl || null,
    ref1: d.trackingReference1 || null,
    ref2: d.trackingReference2 || null,
    last,
    hoursSinceLast,
    analysis: analyze(d, events, delivered),
    events,
  };
}

async function fetchTrack(id) {
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
      return { id, ok: false, error: 'APC bu numarayı bulamadı.' };
    }
    if (!res.ok) {
      return { id, ok: false, error: `APC hata döndürdü (HTTP ${res.status}).` };
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { id, ok: false, error: 'APC beklenmeyen bir yanıt verdi.' };
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.events)) {
      return { id, ok: false, error: 'Bu numara için takip verisi yok.' };
    }
    return summarize(id, data);
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'APC zamanında yanıt vermedi.' : 'APC\'ye bağlanılamadı.';
    return { id, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Numaraları sınırlı eşzamanlılıkla sorgular, giriş sırasını korur.
async function trackMany(ids) {
  const list = ids.slice(0, MAX_IDS);
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fetchTrack(list[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  return out;
}

// Ortak istek işleyicisi: sunucu ve Netlify fonksiyonu aynı mantığı kullanır.
async function handleLookup(text) {
  const { ids, invalid } = parseInput(text);
  if (ids.length === 0) {
    return { status: 400, body: { error: 'Geçerli bir APC numarası veya linki bulunamadı.', invalid } };
  }
  const truncated = ids.length > MAX_IDS;
  const results = await trackMany(ids);
  return {
    status: 200,
    body: { checkedAt: new Date().toISOString(), truncated, maxIds: MAX_IDS, invalid, results },
  };
}

module.exports = { extractId, parseInput, summarize, fetchTrack, trackMany, handleLookup, MAX_IDS };
