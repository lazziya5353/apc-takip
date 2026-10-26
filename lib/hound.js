'use strict';

// Hound Express takip servisi:
//   POST {HOUND_BASE}/Sabueso/ws/deliveryServices/trackOrder
//   başlık: partnerKey (HOUND_PARTNER_KEY ortam değişkeni), gövde: [{ "guideNumber": "HX...", "comments": "es" }]
// Yanıt: [{ guideNumber, currentStatus, resultDetails: [ {dateTime, location, code, description, statusObj:{description_en, is_final, is_problem}} ], ...}]
// Yanıtta alıcı adı, adresi, telefon, e-posta ve vergi no da bulunur. Bu alanlara hiç dokunulmaz,
// sadece durum olayları alınır.

const { offsetMs } = require('./sagawa');

// Olay saatleri saat dilimi içermez ("Oct 21, 2026, 3:44:38 PM"). Hound Express Meksika merkezli
// olduğundan Meksika saati varsayılır. Hareketli bir kargoda doğrulanınca burası düzeltilebilir.
const ZONE = process.env.HOUND_TZ || 'America/Mexico_City';
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function toIso(s) {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(String(s || '').trim());
  if (!m || MONTHS[m[1].toLowerCase()] === undefined) return null;
  let h = +m[4];
  if (m[7]) { h = h % 12; if (/pm/i.test(m[7])) h += 12; }
  const asUtc = Date.UTC(+m[3], MONTHS[m[1].toLowerCase()], +m[2], h, +m[5], +(m[6] || 0));
  let ms = asUtc - offsetMs(asUtc, ZONE);
  ms = asUtc - offsetMs(ms, ZONE);
  return new Date(ms).toISOString();
}

function categoryOf(o) {
  const so = o.statusObj || {};
  const d = `${so.description_en || ''} ${o.description || ''}`;
  if (/devuelt|return/i.test(d)) return 'Returned';
  if (so.is_final && !so.is_problem && /entreg|deliver/i.test(d) && !/no entreg|not deliver|undeliver/i.test(d)) return 'Delivered';
  if (/en reparto|out for delivery|ruta de entrega/i.test(d)) return 'Out for Delivery';
  if (/intento|attempt|no entreg|not deliver|undeliver|ausente/i.test(d)) return 'Delivery Attempted';
  if (/aduana|customs/i.test(d)) return 'Customs';
  if (so.is_problem) return 'Delayed';
  if (/label created|documentad/i.test(d)) return 'Info Received';
  return 'In Transit';
}

// JSON → { number, events } ya da null
function parseHound(data) {
  const item = Array.isArray(data) ? data[0] : data;
  if (!item || !Array.isArray(item.resultDetails) || !item.resultDetails.length) return null;
  const events = [];
  for (const o of item.resultDetails) {
    const iso = toIso(o && o.dateTime);
    if (!iso) continue;
    const so = o.statusObj || {};
    const text = String(so.description_en || o.description || '').replace(/\s+/g, ' ').trim();
    events.push({
      eventDateTimeISOFormat: iso,
      eventCategory: categoryOf(o),
      description: text,
      carrierMetaDescription: '',
      location: o.location || '',
      countryCode: '',
      code: o.code || '',
    });
  }
  if (!events.length) return null;
  return { number: item.guideNumber || null, events };
}

module.exports = { parseHound, toIso, categoryOf };
