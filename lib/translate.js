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
  // --- Sagawa ---
  [/^preparing for dispatch\.?$/i, 'Gönderiye hazırlanıyor.'],
  [/^on board aircraft\.?$/i, 'Uçağa yüklendi.'],
  [/^estimated arrival date at airport\.?$/i, 'Havalimanına tahmini varış tarihi.'],
  [/^arr+ived at destination airport\.?$/i, 'Varış havalimanına ulaştı.'],
  [/^in transit to our bonded warehouse\.?$/i, 'Gümrüklü depoya taşınıyor.'],
  [/^arrived at destination ?\/ ?customs clearance\.?$/i, 'Varış noktasına ulaştı, gümrük işlemi başladı.'],
  [/^clearance release\.?$/i, 'Gümrükten çıktı.'],
  [/^absence\.?$/i, 'Alıcı evde yoktu, teslimat yapılamadı.'],
  [/^delivered \[stamp\]\.?$/i, 'Teslim edildi (imza/kaşe ile).'],
  // --- La Poste ---
  [/^an error has occurred in the routing of your item\b.*$/i, 'Gönderinin yönlendirilmesinde bir hata oluştu; La Poste gönderiyi yoluna döndürmeye çalışıyor.'],
  [/^your item is transiting through our logistics platforms\b.*$/i, 'Gönderi La Poste lojistik merkezleri arasında teslimata doğru ilerliyor.'],
  [/^your item has just arrived in france\.?$/i, 'Gönderi Fransa\'ya ulaştı.'],
  [/^your item is ready to be forwarded from its foreign territory\b.*$/i, 'Gönderi çıkış ülkesinden yola çıkmaya hazır, taşıyıcıya verilecek.'],
  [/^your item is on its way\.?$/i, 'Gönderi yolda.'],
  [/^your item has been dropped off by the sender with our postal partner\b.*$/i, 'Gönderici, çıkış ülkesindeki posta ortağına gönderiyi teslim etti.'],
  [/^your item has been delivered\b.*$/i, 'Gönderi teslim edildi.'],
  [/^your item is out for delivery\b.*$/i, 'Gönderi dağıtıma çıktı.'],
  // --- DAI Post ---
  [/^we couldn'?t leave your parcel safely\. we'?ll let you know how to collect it\.?$/i, 'Paket güvenli şekilde bırakılamadı; teslim alma şekli hakkında bilgi verilecek.'],
  [/^it'?s happening, your parcel will be delivered today\. get ready!?$/i, 'Paket bugün teslim edilecek.'],
  [/^we'?ve got your parcel and it'?s been sorted for delivery\.?$/i, 'Paket teslim alındı ve dağıtım için ayrıştırıldı.'],
  [/^all clear! your parcel'?s passed customs and is ready for the next leg\.?$/i, 'Paket gümrükten geçti, bir sonraki etaba hazır.'],
  [/^your parcel is being checked by customs\. we'?ll let you know when it'?s cleared\.?$/i, 'Paket gümrükte kontrol ediliyor; işlem bitince bilgi verilecek.'],
  [/^we'?ve collected your parcel from the airline and it'?s being processed\.?$/i, 'Paket havayolundan teslim alındı ve işleniyor.'],
  [/^touchdown! your parcel has landed\.?$/i, 'Paketin uçağı indi.'],
  [/^your parcel'?s left the transfer country and is back on the move\.?$/i, 'Paket aktarma ülkesinden ayrıldı, yola devam ediyor.'],
  [/^parcel arrived in trans-?shipment country\.?$/i, 'Paket aktarma ülkesine ulaştı.'],
  [/^your parcel is in the air and is heading your way\.?$/i, 'Paket havada, varış ülkesine doğru yolda.'],
  [/^we'?ve processed your parcel at our origin facility\. next, on the move to you!?$/i, 'Paket çıkış tesisinde işlendi, yola çıkıyor.'],
  [/^your parcel'?s checked in and being prepared for its journey\.?$/i, 'Paket kabul edildi, sevkiyata hazırlanıyor.'],
  [/^we'?ve received your delivery details\. we'?ll let you know as soon as your parcel is in our hands\.?$/i, 'Gönderi bilgileri alındı; paket teslim alınınca bilgi verilecek.'],
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
