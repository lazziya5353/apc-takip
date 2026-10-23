'use strict';

// Kargo firmalarının İngilizce hareket metinlerini Türkçeye çevirir.
// Sadece bilinen kalıplar çevrilir. Tanımadığı metin için null döner, arayüz o zaman orijinali gösterir.
// Yeni bir metin görürsen PATTERNS listesine bir satır ekle: [/regex/i, 'Türkçe karşılık'].
// Çeviride $1, $2 ile regex gruplarına başvurulabilir.

const PATTERNS = [
  // --- Teslimat ---
  [/^delivered\.?$/i, 'Teslim edildi.'],
  [/^delivered,?\s*(left|placed) (at|in|with) (.+?)\.?$/i, 'Teslim edildi ($3 bırakıldı).'],
  [/^out for delivery\.?$/i, 'Dağıtıma çıktı.'],
  [/^your package is on its way for delivery\.?$/i, 'Kargon dağıtım için yolda.'],
  [/^delivery attempted\.?\s*local carrier will try again\.?$/i, 'Teslimat denendi. Yerel kargo firması tekrar deneyecek.'],
  [/^delivery attempted\.?$/i, 'Teslimat denendi.'],
  [/^no one was available to receive your package during the delivery attempt\.?$/i, 'Teslimat denemesi sırasında paketi teslim alacak kimse bulunamadı.'],
  [/^(available|ready) for (pick ?up|collection)\.?$/i, 'Teslim alınmaya hazır (şubede/noktada bekliyor).'],
  [/^(delivery )?exception\.?$/i, 'Teslimatta sorun çıktı.'],
  [/^(undeliverable|unable to deliver)\.?$/i, 'Teslim edilemedi.'],
  [/^address (issue|problem|incorrect|not found)\.?$/i, 'Adres sorunu var.'],
  // --- Yolda ---
  [/^on the way\.?$/i, 'Yolda.'],
  [/^in transit\.?$/i, 'Yolda.'],
  [/^delayed in transit\.?$/i, 'Yolda gecikme var.'],
  [/^delayed\.?$/i, 'Gecikme var.'],
  [/^your package hasn'?t moved in over (\d+) hours? and is now being investigated\.?$/i, 'Paketin $1 saatten uzun süredir hareket etmedi, kargo firması durumu inceliyor.'],
  [/^the package has been received at a carrier'?s processing facility\.?$/i, 'Paket kargo firmasının işlem merkezine ulaştı.'],
  [/^your package is moving between warehouses on its way to you\.?$/i, 'Paketin depolar arasında sana doğru ilerliyor.'],
  [/^your package is traveling to another branch within the same state\.?$/i, 'Paketin aynı eyalet içinde başka bir şubeye gidiyor.'],
  [/^departed apc facility,? on the way\.?$/i, 'APC tesisinden çıktı, yolda.'],
  [/^arrived at apc\.?$/i, 'APC tesisine ulaştı.'],
  [/^order processed and ready for export at apc\.?$/i, 'Sipariş APC\'de işlendi, ihracata hazır.'],
  [/^label created\.?$/i, 'Kargo etiketi oluşturuldu.'],
  [/^shipment information received\.?$/i, 'Gönderi bilgisi alındı (kargo henüz teslim alınmamış olabilir).'],
  [/^(shipment )?data received\.?$/i, 'Gönderi bilgisi alındı.'],
  [/^flight departed\.?$/i, 'Uçuş kalktı.'],
  [/^flight arrived\.?$/i, 'Uçuş indi.'],
  [/^processed by asendia\.?$/i, 'Asendia tarafından işlendi.'],
  [/^sorted by asendia\.?$/i, 'Asendia tarafından ayrıştırıldı.'],
  [/^dispatched by asendia\.?$/i, 'Asendia tarafından sevk edildi.'],
  [/^(arrived|received) at (.+?)( facility| hub| depot)?\.?$/i, '$2 tesisine ulaştı.'],
  [/^departed (.+?)( facility| hub| depot)?\.?$/i, '$1 tesisinden çıktı.'],
  // --- Gümrük ---
  [/^cleared customs\.?$/i, 'Gümrükten geçti.'],
  [/^your package cleared customs and is heading toward its destination\.?$/i, 'Paketin gümrükten geçti, varış noktasına doğru ilerliyor.'],
  [/^(held|delayed) (at|by) customs\.?$/i, 'Gümrükte bekliyor.'],
  [/^customs (hold|delay|clearance (delay|pending))\.?$/i, 'Gümrükte bekliyor.'],
  [/^(import )?customs (inspection|processing)\.?$/i, 'Gümrük işlemi sürüyor.'],
  [/^duties? (due|unpaid|payment required)\.?$/i, 'Gümrük vergisi ödenmesi gerekiyor.'],
  // --- İade ---
  [/^returned to sender\.?$/i, 'Gönderene iade edildi.'],
  [/^return to sender( initiated)?\.?$/i, 'Gönderene iade süreci başladı.'],
  [/^(being )?returned\.?$/i, 'İade ediliyor.'],
];

function translate(text) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  for (const [re, out] of PATTERNS) {
    const m = s.match(re);
    if (m) return out.replace(/\$(\d)/g, (_, i) => (m[i] || '').trim());
  }
  return null;
}

module.exports = { translate };
