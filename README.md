# APC Kargo Takip

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
