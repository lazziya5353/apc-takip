'use strict';

// Correos (İspanya) takip sayfası kendi JSON adresini kullanır, anahtar ya da giriş istemez:
//   GET {CORREOS_BASE}/digital-services/searchengines/api/v1/envios?text=<numara>&language=EN
// Yanıt: { shipment: [ { shipmentCode, events: [ {eventDate "dd/mm/yyyy", eventTime "hh:mm:ss", phase, desPhase, summaryText, extendedText} ] } ] }
// Olay saatleri İspanya yerel saatidir.

const { offsetMs } = require('./sagawa');
const ZONE = 'Europe/Madrid';

function toIso(d, t) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d || '').trim());
  const k = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(t || '00:00:00').trim());
  if (!m || !k) return null;
  const asUtc = Date.UTC(+m[3], +m[2] - 1, +m[1], +k[1], +k[2], +(k[3] || 0));
  let ms = asUtc - offsetMs(asUtc, ZONE);
  ms = asUtc - offsetMs(ms, ZONE);
  return new Date(ms).toISOString();
}

function categoryOf(e) {
  const t = `${e.summaryText || ''} ${e.extendedText || ''}`;
  if (/return(ed)? to (the )?sender|being returned|devuel/i.test(t)) return 'Returned';
  if (/\bdelivered\b|entregado/i.test(t) && !/not delivered|to be delivered|attempt/i.test(t)) return 'Delivered';
  if (/attempt|absent|unsuccessful|could not be delivered|available for collection|disposal|pick ?up/i.test(t)) return 'Delivery Attempted';
  if (/in delivery|out for delivery|on its way to be delivered/i.test(t)) return 'Out for Delivery';
  if (/customs|aduana/i.test(t)) return 'Customs';
  if (/incident|delay|damaged|problem/i.test(t)) return 'Delayed';
  if (String(e.phase) === '1') return 'Info Received';
  return 'In Transit';
}

// JSON → { number, events } ya da null
function parseCorreos(data) {
  const sh = data && Array.isArray(data.shipment) ? data.shipment[0] : null;
  if (!sh || !Array.isArray(sh.events) || !sh.events.length) return null;
  const events = [];
  for (const e of sh.events) {
    const iso = toIso(e && e.eventDate, e && e.eventTime);
    if (!iso) continue;
    events.push({
      eventDateTimeISOFormat: iso,
      eventCategory: categoryOf(e),
      description: String(e.summaryText || e.desPhase || '').replace(/\s+/g, ' ').trim(),
      carrierMetaDescription: String(e.extendedText || '').replace(/\s+/g, ' ').trim(),
      location: '',
      countryCode: 'ES',
      code: e.phase != null ? String(e.phase) : '',
    });
  }
  if (!events.length) return null;
  return { number: sh.shipmentCode || null, events };
}

module.exports = { parseCorreos, toIso, categoryOf };
