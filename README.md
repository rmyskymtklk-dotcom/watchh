# 🎬 WatchParty

Arkadaşınla aynı anda film & dizi izleme uygulaması.  
Node.js + Express + WebSocket • Proxy ile CSP/iframe engeli aşımı • Canlı yorum sistemi

---

## 🚀 Kurulum

### 1. Gereksinimler
- [Node.js](https://nodejs.org/) 18+ yüklü olmalı

### 2. Bağımlılıkları kur
```bash
cd watchparty
npm install
```

### 3. Çalıştır
```bash
# Geliştirme (otomatik restart):
npm run dev

# veya normal:
npm start
```

Tarayıcıda aç: **http://localhost:3000**

---

## 🎮 Nasıl Kullanılır?

### Oda Oluşturma (Sen)
1. Takma adını gir
2. **"Oda Oluştur"** butonuna tıkla
3. Sağ üstteki **oda kodu**nu kopyala ve arkadaşına gönder
4. Film linkini (hdfilmcehennemi, vs.) üstteki alana yapıştır → **Yükle**

### Odaya Katılma (Arkadaşın)
1. `http://localhost:3000?room=ODAKODU` linkini açar
   (veya kodu manuel girer)
2. Takma adını yazar → **Katıl**

---

## ⚙️ Teknik Detaylar

### Proxy (`/proxy?url=...`)
Bazı siteler (hdfilmcehennemi, vb.) iframe içinde yüklenmeyi engelleyen headerlar gönderir:
- `X-Frame-Options: DENY/SAMEORIGIN`
- `Content-Security-Policy: frame-ancestors 'self'`

Server bu headerları kaldırıp isteği proxy eder.

> **Not:** Bazı siteler çok agresif Cloudflare koruması kullanır. Bu durumda:
> - Chrome eklentisi: [Ignore X-Frame-Options](https://chrome.google.com/webstore/detail/ignore-x-frame-headers/gleekbfjekiniecknbkamfmkohkpodhe)
> - Veya Firefox: `xframeoptions` about:config ayarı

### WebSocket Olayları
| Olay | Açıklama |
|------|-----------|
| `join` | Odaya katılma |
| `set_url` | Host film URL'si değiştirir |
| `url_changed` | Tüm kullanıcılara yayınlanır |
| `comment` | Yorum gönderme |
| `new_comment` | Yorum herkese iletilir |
| `user_joined/left` | Kullanıcı bildirimleri |

---

## 📁 Proje Yapısı

```
watchparty/
├── server/
│   └── index.js          # Express + WebSocket sunucu
├── public/
│   ├── index.html        # Ana sayfa
│   ├── css/
│   │   └── style.css     # Stiller
│   └── js/
│       └── app.js        # İstemci JS
├── package.json
└── README.md
```

---

## 🔧 VS Code ile Geliştirme

1. `watchparty` klasörünü VS Code'da aç
2. Terminal → `npm run dev`
3. Değişiklikler otomatik yenilenir (nodemon)

**Önerilen eklentiler:**
- ESLint
- Prettier
- REST Client (API test için)
