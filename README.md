# GTA World Türkiye Launcher

GTA World Türkiye sunucusuna tek tıkla bağlanmak için hazırlanmış masaüstü launcher.

## Özellikler
- Tek tıkla FiveM'i açıp sunucuya bağlanma
- Sunucu durumu, anlık oyuncu sayısı, günlük ve tüm zamanların en yüksek oyuncu sayısı
- Forum, UCP ve Facebrowser durum kontrolü
- Yeni oyuncular için hesap açma ve başvuru rehberi
- Discord Rich Presence (launcher ve oyun içi durum)
- Otomatik güncelleme

## İndirme ve kurulum
1. [Releases](../../releases/latest) sayfasından `GTA-World-Türkiye-Launcher-Setup-vX.X.X.exe` dosyasını indirin.
2. Dosyayı çalıştırıp kurulum adımlarını izleyin. Yönetici izni gerekmez, launcher kullanıcı klasörünüze kurulur. Masaüstü ve Başlat menüsü kısayolu oluşturulur.
3. Kaldırmak için Windows **Ayarlar → Uygulamalar** bölümünden "GTA World Türkiye Launcher" seçilir.

Tarayıcınız dosyayı "yaygın olarak indirilmiyor" diye işaretleyebilir. Dosyanın bu depodan geldiğini aşağıdaki yöntemle doğruladıktan sonra **Sakla / Keep** seçeneğiyle indirebilirsiniz.

### Dosyanın bu depodan geldiğini doğrulama
Her sürümde kurulum dosyasının SHA256 özeti (`SHA256.txt`) yayınlanır. Aşağıdaki powershell kodunda Türkiye'yi kabul etmezse Turkiye olarak yazın. İndirdiğiniz dosya için PowerShell'de şunu çalıştırıp sonucu karşılaştırabilirsiniz:

```powershell
Get-FileHash .\GTA-World-Türkiye-Launcher-Setup-vX.X.X.exe -Algorithm SHA256
```

Kurulum dosyası, bu depodaki kodtan GitHub Actions ile otomatik derlenir (`.github/workflows/build.yml`), derleme kayıtları herkese açıktır.

### Windows uyarısı
Dosya henüz dijital olarak imzalı değilse Windows "Bilinmeyen yayıncı" uyarısı gösterebilir. Dosyayı yukarıdaki yöntemle doğruladıktan sonra **Ek bilgi → Yine de çalıştır** ile açabilirsiniz.

## Güncelleme
Launcher her açılışta GitHub'daki en son sürümü kontrol eder. Yeni sürüm varsa indirir, kurar ve kendini yeniden başlatır. Durum, sağ alttaki sürüm yazısının yanındaki ışıkta görünür (yeşil: güncel, kırmızı: güncelleme geliyor). Yeni sürüm yayınlamak için `vX.Y.Z` biçiminde bir etiket atmak yeterlidir, sürüm numarası etiketten alınır.

## Kaynaktan derleme
Node.js 20 veya üstü gerekir.

```
npm install
npm start          # geliştirme modunda çalıştır
npm run build      # dist/ içinde kurulum dosyasını üretir (Windows'ta)
```

## Ayarlar
Adresler ve davranışlar `index.html` içindeki `CONFIG` bölümünde, Discord RPC ayarları `main.js` başındaki `CFG` bölümünde, güncelleme deposu `package.json` içindeki `build.publish` bölümünde bulunur.

## Kayıt dosyası
Sorun çıkarsa launcher olayları `%APPDATA%\gtaworld-tr-launcher\launcher.log` dosyasına yazılır.