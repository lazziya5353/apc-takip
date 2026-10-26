'use strict';

// La Poste (laposte.fr) takip sayfası kendi JSON adresinden veri çeker, giriş ya da anahtar istemez:
//   GET {LAPOSTE_BASE}/ssu/sun/back/suivi-unifie/<numara>?lang=en
// Yanıt: [{ returnCode, shipment: { idShip, product, isFinal, entryDate, event: [...], currentState } }]
// Bilinmeyen numara için HTTP 404 ve { response: { returnCode: 104 } } döner.

// Olay metninden APC biçimindeki kategori.
function categoryOf(label, group) {
  const t = String(label || '');
  if (/could not be delivered|unable to deliver|failed delivery|delivery attempt|not at home|absent|unsuccessful/i.test(t)) return 'Delivery Attempted';
  if (/return(ed)? to (the )?sender|being returned|returned to/i.test(t)) return 'Returned';
  if (/available (for|at)|ready for (pick|collection)|can be collected|pick ?up (point|location)/i.test(t)) return 'Delivery Attempted';
  if (/has been delivered|was delivered|delivered to|handed (over )?to the (addressee|recipient)|distributed/i.test(t) && !/will be delivered|to be delivered/i.test(t)) return 'Delivered';
  if (/out for delivery|being delivered|will be delivered today|on its way to (you|its)\s+(addressee|destination).*today/i.test(t)) return 'Out for Delivery';
  if (/customs/i.test(t)) return 'Customs';
  if (/\berror\b|incident|problem|delay|damaged|rerouted|re-routed/i.test(t) || /^ACHIECA$/i.test(group || '')) return 'Delayed';
  return 'In Transit';
}

// JSON (nesne ya da dizi) → { number, product, entryDate, isFinal, events } ya da null
function parseLaPoste(data) {
  const item = Array.isArray(data) ? data[0] : data;
  const sh = item && item.shipment;
  if (!sh || !Array.isArray(sh.event) || !sh.event.length) return null;
  const events = [];
  for (const e of sh.event) {
    const t = Date.parse(e && e.date);
    if (isNaN(t)) continue;
    const label = String(e.label || '').replace(/\s+/g, ' ').trim();
    events.push({
      eventDateTimeISOFormat: new Date(t).toISOString(),
      eventCategory: categoryOf(label, e.group),
      description: label,
      carrierMetaDescription: '',
      location: e.country || '',
      countryCode: e.country || '',
      code: e.group || '',
    });
  }
  if (!events.length) return null;
  return { number: sh.idShip || (item && item.inputIdShip) || null, product: sh.product || null, entryDate: sh.entryDate || null, isFinal: !!sh.isFinal, events };
}

module.exports = { parseLaPoste, categoryOf };
