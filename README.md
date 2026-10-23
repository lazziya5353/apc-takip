# APC & Asendia & Sagawa Kargo Takip

APC linkini veya takip numarasını yapıştır, son durumu ve local carrier bilgisini getirir.
Bağımlılık yok, Node 18 veya üstü yeterli.

## Çalıştırma

```
node server.js
```

Sonra http://localhost:3000 adresini aç. Port için `PORT=8080 node server.js`.

## Girdi

Her satıra bir link veya numara. Şunlar kabul edilir:

- `https://tracking.apc-pli.com/18391P1008260002682920`
- `18391P1008260002682920` (APC referans no, sayfanın kullandığı numara)
- `H1034370003838201527` (paket numarası, APC bunu kabul ederse çalışır)

Aynı anda en fazla 50 numara sorgulanır.

## Asendia

`AS015144682US` gibi numaralar ya da `a1.asendiausa.com/tracking/?trackingnumber=...` linkleri
otomatik olarak Asendia'ya gider (evrensel posta biçimi: 2 harf + rakamlar + 2 harf). Diğer
her şey APC sayılır. Asendia verisi `a1reportapi.asendiaprod.com` uç noktasından gelir ve
APC ile aynı analizden geçer (gecikme, iş günü, iade). Asendia tahmini teslimat tarihi vermez,
bu yüzden gecikme "gecikme bildirimi" ve iş günü kuralına dayanır. İstek içindeki `trackingKey`
sayfaya gömülü herkese açık anahtardır. Değişirse Netlify'da `ASENDIA_KEY` ortam değişkenini
güncelle.

## Sagawa

`tracking.sagawa-sgx.com` linki ya da 12 haneli AWB numarası Sagawa'dan sorgulanır. Sagawa'nın
ayrı bir API'si yok, sonuç sayfanın HTML'inde geliyor; `lib/sagawa.js` o tabloyu ayrıştırır.
Tablodaki saatler yerel saattir, hareketin ülkesine göre saat dilimi seçilir. 12 haneli numara
APC'nin yerel carrier numarası da olabilir, bu yüzden APC ve Sagawa sırayla denenir.

## Durum özeti

Her kargo için APC'nin hareket geçmişinden otomatik özet çıkar (`analyze` fonksiyonu, `lib/apc.js`):

- **Gecikme var:** son olay "Delayed" ise, tahmini teslimat tarihi geçtiyse ya da 3 iş günü veya daha uzun süredir hareket yoksa
- **İade:** hareketlerde "returned to sender" gibi bir ifade varsa
- **Teslimat denemesi**, **gümrük durumu**, **dağıtımda** bilgisi
- **Gönderi özeti:** çıkış yeri, varış, yolda geçen süre, tahmini teslimat, servis, vergi durumu, local carrier

İade tespiti, iade olaylarının APC'deki tam metni görülmeden yazıldı. Gerçek bir iade kaydı
gördüğünde `RETURN_RE` ifadesini ona göre güncellemek gerekebilir.

## Geçmiş kontroller

Sorguladığın her kargo sağdaki "Geçmiş kontroller" listesine düşer (en fazla 60). Liste o
tarayıcının `localStorage` alanında durur: başka bilgisayarda ya da tarayıcıda görünmez, tarayıcı
verisini silersen gider. Sunucuda hiçbir şey saklanmaz.

- Kayda tıklayınca kargonun detayı açılır.
- **Tekrar kontrol et:** o kargoyu yeniden sorgular. Son hareket değiştiyse "Yeni hareket" işareti çıkar.
- **Hepsini tekrar kontrol et:** listedeki tüm kargoları tek seferde yeniler.
- **Geçmişi temizle:** onay sorup listeyi siler.

## İş günü bilgisi

Her kargoda "Son güncelleme" kutusu, son hareketten bu yana kaç iş günü geçtiğini gösterir
(3 ve üstü sarı, 5 ve üstü kırmızı). İade kaydı varsa ayrıca "İadeye döndü" kutusu iadenin
ilk görüldüğü tarihi ve üzerinden geçen iş gününü verir. Geçmiş listesinde de aynı bilgi var.

- İş günü = Pazartesi-Cuma. Olay gününden sonraki günler sayılır, bugün dahil. Cuma olayı için
  Cumartesi ve Pazar 0, Pazartesi 1 iş günüdür. Aynı gün "Bugün" yazar.
- Günler İstanbul saatine göre alınır. Resmi tatiller düşülmez.
- Değerler ekranda canlı hesaplanır, geçmişteki kayıtlar eskimez.

Gecikme günü: bugünün tarihi ile APC'nin tahmini teslimat tarihinin son günü arasındaki fark.

## Local carrier linki

Local carrier satırında carrier adı ve local takip numarası görünür. Numaraya tıklayınca carrier
sayfası açılır, "Kopyala" ile numara panoya alınır. Numaranın linke otomatik eklendiği carrier'lar
`lib/apc.js` içindeki `CARRIER_LINKS` listesinde (şu an Royal Mail, UPS). Listede olmayan
carrier'larda APC'nin verdiği genel carrier sayfası açılır, numarayı sen yapıştırırsın.
Yeni carrier eklemek için listeye `{ match: /ad/i, url: '...{n}...' }` satırı yeter.
UPS kalıbı doğrulanmadı, çalışmazsa oradaki adresi güncelle.

## Nasıl çalışıyor

APC'nin takip sayfası `GET https://tracking.apc-pli.com/api/track?id=<numara>` çağırıyor.
Tarayıcıdan doğrudan çağırmak CORS'a takıldığı için istek `server.js` üzerinden sunucu
tarafında yapılıyor (`lib/apc.js`). Local carrier (Hermes, Hound Express vb.) adı ve linki
yanıttaki `finalMileCarrier` ve `externalTrackingUrl` alanlarından geliyor. Local carrier'ın
APC'ye ilettiği olaylar da aynı `events` listesinde yer alıyor.

## Netlify

`netlify.toml` ve `netlify/functions/track.js` hazır: `public` klasörü yayınlanır,
`/api/lookup` isteği fonksiyona yönlenir. Ayrı bir ayar gerekmez.

## Test

```
node test/mock-apc.js &
node test/run.js
```

Testler gerçek bir APC yanıtının kaydıyla (`test/fixture.json`) çalışan sahte bir APC
sunucusuna karşı koşar.
