'use strict';

// Sagawa Global (SGX) takip sayfası sonucu doğrudan HTML içinde verir, ayrı bir API yok.
// Sayfa: GET {SAGAWA_BASE}/sgx/trackeng.asp?enc=ENG&cat=AWB&awb=<numara>
// Burada o HTML'den gönderi bilgisi ve hareket tablosu çıkarılır.

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<\/(tr|p|div|li|h\d)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m))
    .replace(/ /g, ' ');
}

// Tabloda saat dilimi yok, yerel saat yazıyor. Hareketin ülkesine göre dilim seçilir.
function zoneFor(place) {
  const p = String(place || '').toUpperCase();
  if (/JAPAN|TOKYO|NARITA|OSAKA|KANSAI|HANEDA/.test(p)) return 'Asia/Tokyo';
  if (/LOS ANGELES|SAN FRANCISCO|SEATTLE/.test(p)) return 'America/Los_Angeles';
  if (/CHICAGO|DALLAS|HOUSTON/.test(p)) return 'America/Chicago';
  if (/U\.?S\.?A|UNITED STATES|NEW YORK|NEWARK|JFK/.test(p)) return 'America/New_York';
  if (/HONG ?KONG/.test(p)) return 'Asia/Hong_Kong';
  if (/CHINA|SHANGHAI|BEIJING|GUANGZHOU|SHENZHEN/.test(p)) return 'Asia/Shanghai';
  if (/KOREA|SEOUL|INCHEON/.test(p)) return 'Asia/Seoul';
  if (/SINGAPORE/.test(p)) return 'Asia/Singapore';
  if (/TAIWAN|TAIPEI/.test(p)) return 'Asia/Taipei';
  if (/THAILAND|BANGKOK/.test(p)) return 'Asia/Bangkok';
  return 'UTC';
}

function offsetMs(utcMs, zone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const o = {};
  for (const p of f.formatToParts(new Date(utcMs))) o[p.type] = p.value;
  return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - utcMs;
}

// "20261009" + "1056" + yer → UTC ISO metni
function toIso(d8, t4, place) {
  const asUtc = Date.UTC(+d8.slice(0, 4), +d8.slice(4, 6) - 1, +d8.slice(6, 8), +t4.slice(0, 2), +t4.slice(2, 4));
  if (isNaN(asUtc)) return null;
  const zone = zoneFor(place);
  let ms = asUtc - offsetMs(asUtc, zone);
  ms = asUtc - offsetMs(ms, zone);
  return new Date(ms).toISOString();
}

function categoryOf(desc) {
  if (/^delivered/i.test(desc)) return 'Delivered';
  if (/absence|not at home|attempt/i.test(desc)) return 'Delivery Attempted';
  if (/out for delivery/i.test(desc)) return 'Out for Delivery';
  if (/customs|clearance/i.test(desc)) return 'Customs';
  if (/return/i.test(desc)) return 'Returned';
  if (/delay|hold/i.test(desc)) return 'Delayed';
  return 'In Transit';
}

// HTML → { awb, ref, origin, dest, events:[APC biçiminde olaylar], localNumber } ya da null
function parseSagawa(html) {
  const text = htmlToText(html);
  const info = (label) => {
    const m = text.match(new RegExp(label + '#?\\s*:\\s*([^\\s\\t\\n]+)', 'i'));
    return m ? m[1] : null;
  };
  const events = [];
  // Önce hücreler (sekme) ile ayır. "Delivered  [STAMP]" gibi çift boşluklu metinler bölünmesin.
  // Hiç satır çıkmazsa çift boşlukla ayırmayı da dene.
  const patterns = [
    /(\d{8})[ ]+(\d{4})[ ]*\t+[ ]*([^\t\n]+?)[ ]*\t+[ ]*([^\t\n]*)/g,
    /(\d{8})[ \t]+(\d{4})[ \t]*(?:\t+|\s{2,})([^\t\n]+?)[ \t]*(?:\t+|\s{2,})([^\t\n]*)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const place = m[4].trim();
      const desc = m[3].trim().replace(/\s+/g, ' ');
      const iso = toIso(m[1], m[2], place);
      if (!iso) continue;
      events.push({
        eventDateTimeISOFormat: iso,
        eventCategory: categoryOf(desc),
        description: desc,
        location: place,
        countryCode: '',
      });
    }
    if (events.length) break;
  }
  if (!events.length) return null;
  const local = text.match(/LOCAL TRACKING#\s*\t*\s*([A-Za-z0-9-]+)/i);
  return {
    awb: info('AWB'),
    ref: info('REF'),
    origin: info('ORIGIN'),
    dest: info('DEST'),
    localNumber: local ? local[1] : null,
    events,
  };
}

module.exports = { parseSagawa, htmlToText, toIso, offsetMs };
