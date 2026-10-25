'use strict';

// DAI Post (daipost.com) takip sayfası Next.js ile sunucuda çizilir, ayrı bir API yok.
// Sonuç, sayfanın içine gömülü "flight" verisinde durur: self.__next_f.push([1,"..."]) parçaları,
// içinde "trackingresponse":[{tracknbr, trackingevent:[...], estimatedDeliveryDate, eddstatus}].
// Sayfa: GET {DAIPOST_BASE}/track?tracknbr=<numara>

const { offsetMs } = require('./sagawa');

// Sayfadaki "flight" parçalarını birleştirip düz metin yapar.
function flightText(html) {
  let out = '';
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try { out += JSON.parse(m[1]); } catch { /* bozuk parça atlanır */ }
  }
  return out;
}

// "trackingresponse": den sonraki dengeli [...] parçasını bulur.
function extractArray(text, key) {
  const k = text.indexOf(`"${key}":`);
  if (k < 0) return null;
  const start = text.indexOf('[', k);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { // metin içindeki parantezler sayılmasın
      i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// Olay saatleri, olayın olduğu ülkenin yerel saatidir (sayfada "Local time" yazar).
const ZONES = {
  AU: 'Australia/Sydney', NZ: 'Pacific/Auckland', JP: 'Asia/Tokyo', CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong',
  SG: 'Asia/Singapore', KR: 'Asia/Seoul', TW: 'Asia/Taipei', US: 'America/New_York', CA: 'America/Toronto',
  GB: 'Europe/London', IE: 'Europe/Dublin', DE: 'Europe/Berlin', FR: 'Europe/Paris', NL: 'Europe/Amsterdam',
  TR: 'Europe/Istanbul', AE: 'Asia/Dubai', IN: 'Asia/Kolkata',
};

function toIso(local, country) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(local || ''));
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const zone = ZONES[String(country || '').toUpperCase()] || 'UTC';
  let ms = asUtc - offsetMs(asUtc, zone);
  ms = asUtc - offsetMs(ms, zone);
  return new Date(ms).toISOString();
}

// Olay kodları ve açıklamalarından APC biçimindeki kategori.
function categoryOf(code, desc) {
  const d = String(desc || '');
  if (/couldn.?t leave|unable to deliver|undeliver|attempt|missed|not home/i.test(d)) return 'Delivery Attempted';
  if (/return/i.test(d)) return 'Returned';
  if (/\bdelivered\b/i.test(d) && !/will be delivered|to be delivered|being delivered/i.test(d)) return 'Delivered';
  if (/will be delivered today|out for delivery|on its way to you/i.test(d)) return 'Out for Delivery';
  if (/customs/i.test(d)) return 'Customs';
  if (/delay|problem|issue|exception|held up/i.test(d)) return 'Delayed';
  return 'In Transit';
}

function cleanVal(v) {
  return v === '$undefined' || v == null ? '' : String(v);
}

// "2026-10-11 to 2026-10-13" → [baş, son] ISO tarihleri
function parseEdd(s) {
  const parts = String(s || '').split(/\s+to\s+/i).map((x) => x.trim()).filter(Boolean);
  const ok = (x) => /^\d{4}-\d{2}-\d{2}/.test(x);
  if (!parts.length || !parts.every(ok) || parts.length > 2) return [null, null];
  const iso = (x) => `${x.slice(0, 10)}T00:00:00.000Z`;
  return [iso(parts[0]), iso(parts[parts.length - 1])];
}

// HTML → { number, events:[APC biçiminde olaylar], estFrom, estTo, eddStatus } ya da null
function parseDaiPost(html) {
  const text = flightText(html);
  const arr = extractArray(text, 'trackingresponse');
  const item = Array.isArray(arr) ? arr.find((x) => x && Array.isArray(x.trackingevent) && x.trackingevent.length) : null;
  if (!item) return null;
  const events = [];
  for (const e of item.trackingevent) {
    const country = cleanVal(e.country);
    const iso = toIso(e.eventdate, country);
    if (!iso) continue;
    const desc = cleanVal(e.description).replace(/[’‘]/g, "'").trim();
    const place = [cleanVal(e.city), country].filter(Boolean).join(', ');
    events.push({
      eventDateTimeISOFormat: iso,
      eventCategory: categoryOf(cleanVal(e.code), desc),
      description: desc,
      carrierMetaDescription: '',
      location: place,
      countryCode: country,
      code: cleanVal(e.code),
    });
  }
  if (!events.length) return null;
  const [estFrom, estTo] = parseEdd(item.estimatedDeliveryDate);
  return { number: cleanVal(item.tracknbr), events, estFrom, estTo, eddStatus: cleanVal(item.eddstatus) };
}

module.exports = { parseDaiPost, flightText, extractArray, toIso, categoryOf };
