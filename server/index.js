const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const fetch   = require('node-fetch');
const path    = require('path');
const cors    = require('cors');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── In-memory store ──────────────────────────────────────────────────────────
const rooms = {};

// ─── URL Dönüştürücü ─────────────────────────────────────────────────────────
function resolveEmbedUrl(rawUrl) {
  try {
    const u    = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    const host = u.hostname.replace('www.', '');

    // ── YouTube ──────────────────────────────────────────────────────────────
    if (host === 'youtube.com' || host === 'youtu.be') {
      let vid = u.searchParams.get('v');
      if (!vid && host === 'youtu.be')
        vid = u.pathname.slice(1).split('?')[0];
      if (!vid && u.pathname.startsWith('/shorts/'))
        vid = u.pathname.split('/shorts/')[1].split('?')[0];
      if (vid) {
        return {
          type: 'embed',
          url:  `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0&enablejsapi=1`,
        };
      }
    }

    // ── Bilibili.com ──────────────────────────────────────────────────────────
    // bilibili.com embed player destekliyor → player.bilibili.com/player.html
    if (host === 'bilibili.com') {
      const match = u.pathname.match(/\/video\/((?:BV|av)[\w]+)/i);
      if (match) {
        const vid   = match[1];
        const isBV  = vid.toUpperCase().startsWith('BV');
        const param = isBV ? `bvid=${vid}` : `aid=${vid.slice(2)}`;
        return {
          type: 'embed',
          url:  `https://player.bilibili.com/player.html?${param}&autoplay=1&high_quality=1&danmaku=0&as_wide=1`,
        };
      }
    }

    // ── Bilibili.tv ───────────────────────────────────────────────────────────
    // bilibili.tv (uluslararası site) iframe embed DESTEKLEMİYOR.
    // Ayrıca coğrafi kısıtlama uyguluyor. Proxy üzerinden yüklenir.
    // (proxy sayfasında "not available in your area" mesajı görünebilir —
    //  bu bilibili.tv'nin kendi kısıtlamasıdır, sunucu taraflı çözümü yoktur)
    if (host === 'bilibili.tv') {
      return { type: 'proxy', url: rawUrl };
    }

    // ── Vimeo ────────────────────────────────────────────────────────────────
    if (host === 'vimeo.com') {
      const vid = u.pathname.split('/').filter(Boolean)[0];
      if (vid && /^\d+$/.test(vid)) {
        return { type: 'embed', url: `https://player.vimeo.com/video/${vid}?autoplay=1` };
      }
    }

    // ── Dailymotion ──────────────────────────────────────────────────────────
    if (host === 'dailymotion.com') {
      const vid = u.pathname.split('/video/')[1];
      if (vid) return { type: 'embed', url: `https://www.dailymotion.com/embed/video/${vid}?autoplay=1` };
    }

    // ── Diğer siteler → proxy ────────────────────────────────────────────────
    return { type: 'proxy', url: rawUrl };
  } catch {
    return { type: 'proxy', url: rawUrl };
  }
}

// ─── /api/resolve ─────────────────────────────────────────────────────────────
app.get('/api/resolve', (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: 'url gerekli' });
  const result = resolveEmbedUrl(raw);
  if (result.type === 'proxy') {
    result.proxyUrl = '/proxy?url=' + encodeURIComponent(result.url);
  }
  res.json(result);
});

// ─── Proxy endpoint ───────────────────────────────────────────────────────────
// FIX: iframe sitelerde play/pause senkronizasyonu için syncScript güçlendirildi.
// Özellikle "pause" komutu video pause eventini tetiklemiyordu;
// artık hem video elementlerine hem iç iframe'lere aynı anda uygulanıyor.
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('url param required');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const parsedTarget = new URL(targetUrl);
    const targetOrigin = parsedTarget.origin;
    const targetHost   = parsedTarget.hostname;

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':               'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':                   'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language':          'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control':            'no-cache',
        'Referer':                  targetOrigin + '/',
        'Origin':                   targetOrigin,
        'Host':                     targetHost,
        'Upgrade-Insecure-Requests':'1',
        'Sec-Fetch-Dest':           'document',
        'Sec-Fetch-Mode':           'navigate',
        'Sec-Fetch-Site':           'same-origin',
      },
    });
    clearTimeout(timer);

    const ct = response.headers.get('content-type') || 'text/html; charset=utf-8';

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Content-Type-Options');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', ct);

    if (!ct.includes('text/html')) {
      const buf = await response.buffer();
      return res.send(buf);
    }

    let body = await response.text();
    const origin = targetOrigin;

    if (body.includes('<head>')) {
      body = body.replace('<head>', `<head><base href="${origin}/">`);
    } else {
      body = `<base href="${origin}/">` + body;
    }

    body = body.replace(/(href|src|action)=["']\/(?!\/)/gi, `$1="${origin}/`);
    body = body.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

    // YENİ: Sitenin içindeki farklı kaynaklı (absolute) iframe'leri de proxy üzerinden geçmeye zorla.
    // Bu sayede Vidmoly, ok.ru gibi 3. parti oynatıcılar da bizim sunucumuzdan geçer ve CORS aşılır.
    body = body.replace(/<iframe([^>]+)src=["'](https?:\/\/[^"']+)["']/gi, (match, before, url) => {
      // Eğer zaten proxy url'si ise dokunma
      if (url.includes('/proxy?url=')) return match;
      return `<iframe${before}src="/proxy?url=${encodeURIComponent(url)}"`;
    });

    // ── Video senkronizasyon scripti ──────────────────────────────────────────
    const syncScript = `
<style>
  html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:auto!important}
  iframe,video{max-width:100%!important}
</style>
<script>
(function(){
  // YENİ: Dinamik olarak Javascript ile eklenen iframe'leri yakala ve Proxy'e yönlendir.
  // (hdfilmcehennemi gibi siteler için kritiktir)
  try {
    var originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        if (this.tagName === 'IFRAME' && name.toLowerCase() === 'src' && typeof value === 'string' && value.startsWith('http')) {
            if (!value.includes('/proxy?url=')) {
                value = '/proxy?url=' + encodeURIComponent(value);
            }
        }
        return originalSetAttribute.call(this, name, value);
    };
  } catch(e) {}

  window.addEventListener('message', function(e){
    var data = e.data;
    if(typeof data === 'string'){ try{ data = JSON.parse(data); }catch(err){ return; } }
    if(!data) return;

    // YENİ: Alt iframe'den (çocuktan) bir video olayı geldiyse, bunu ÜST ebeveyne ilet (Bubble UP)
    if(data.__watchparty_event){
      if(window.parent && window.parent !== window){
         window.parent.postMessage(JSON.stringify(data), '*');
      }
      return;
    }

    // Yukarıdan (parent) gelen komutu al ve uygula
    if(data.__watchparty){
      applyCmd(data.action, data.time);
    }
  });

  function applyCmd(action, time){
    var videos = document.querySelectorAll('video');
    videos.forEach(function(v){
      try{
        if(typeof time === 'number' && Math.abs(v.currentTime - time) > 1.5){
          v.currentTime = time;
        }
        if(action === 'play'){
          var p = v.play();
          // Tarayıcı otomatik oynatmayı engellerse videoyu sessize alıp tekrar dene
          if(p && p.catch) p.catch(function(){
            v.muted = true;
            v.play().catch(function(){});
          });
        } else if(action === 'pause'){
          try{ v.pause(); }catch(err){
            setTimeout(function(){ try{ v.pause(); }catch(_){} }, 50);
          }
        }
      }catch(err){}
    });

    // Komutu içteki diğer iframe'lere de pasla (Cascade DOWN)
    document.querySelectorAll('iframe').forEach(function(f){
      try{
        f.contentWindow.postMessage(JSON.stringify({__watchparty:true, action:action, time:time}), '*');
      }catch(err){}
    });
  }

  var lastSent = 0;
  function attachListeners(v){
    if(v.__wpAttached) return;
    v.__wpAttached = true;
    ['play','pause','seeked'].forEach(function(evt){
      v.addEventListener(evt, function(){
        var now = Date.now();
        if(now - lastSent < 300) return;
        lastSent = now;
        try{
          if(window.parent && window.parent !== window) {
             window.parent.postMessage(JSON.stringify({
              __watchparty_event: true,
              action: evt === 'seeked' ? 'seek' : evt,
              time:   v.currentTime
            }), '*');
          }
        }catch(err){}
      });
    });
  }

  function observeVideos(){
    document.querySelectorAll('video').forEach(attachListeners);
    if(window.MutationObserver){
      new MutationObserver(function(mutations){
        mutations.forEach(function(m){
          m.addedNodes.forEach(function(node){
            if(node.nodeName === 'VIDEO') attachListeners(node);
            if(node.querySelectorAll) node.querySelectorAll('video').forEach(attachListeners);
            
            // Eğer DOM'a yeni bir iframe eklenmişse ve proxy'den geçmiyorsa düzelt
            if(node.nodeName === 'IFRAME' && node.src && node.src.startsWith('http') && !node.src.includes('/proxy?url=')) {
               node.src = '/proxy?url=' + encodeURIComponent(node.src);
            }
          });
        });
      }).observe(document.body || document.documentElement, {childList:true, subtree:true});
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', observeVideos);
  } else {
    observeVideos();
  }
})();
</script>`;

    if (body.includes('</head>')) {
      body = body.replace('</head>', syncScript + '</head>');
    } else {
      body = syncScript + body;
    }

    res.send(body);
  } catch (err) {
    console.error('Proxy error:', err.message);
    const isTimeout = err.name === 'AbortError';
    res.status(500).send(`
      <html><body style="background:#111;color:#ff6b6b;font-family:sans-serif;padding:2rem;text-align:center">
        <h2>⚠️ ${isTimeout ? 'Zaman Aşımı' : 'Proxy Hatası'}</h2>
        <p style="color:#aaa">${isTimeout ? 'Site 15 saniyede yanıt vermedi.' : 'Bu site proxy üzerinden yüklenemedi.'}</p>
        <p style="color:#aaa">Hata: <code style="color:#ff6b6b">${err.message}</code></p>
        <p style="margin-top:1.5rem;color:#6b6b80;font-size:0.85rem">
          Cloudflare korumalı siteler için <strong style="color:#e8ff47">Yan Panel Modunu</strong> kullanın.
        </p>
      </body></html>
    `);
  }
});

// ─── Room API ─────────────────────────────────────────────────────────────────
app.post('/api/room/create', (req, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms[roomId] = {
    url:         '',
    comments:    [],
    users:       {},
    hostId:      null,
    currentTime: 0,
    lastAction:  null,
  };
  res.json({ roomId });
});

app.get('/api/room/:roomId', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: 'Oda bulunamadı' });
  res.json({
    url:         room.url,
    comments:    room.comments,
    userCount:   Object.keys(room.users).length,
    currentTime: room.currentTime,
    lastAction:  room.lastAction,
  });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let currentRoom = null;
  let userId      = uuidv4().slice(0, 6);
  let nickname    = 'Misafir';

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'join': {
        const { roomId, nick } = msg;
        if (!rooms[roomId]) {
          ws.send(JSON.stringify({ type: 'error', text: 'Oda bulunamadı' }));
          return;
        }
        currentRoom = roomId;
        nickname    = nick || 'Misafir';
        const room  = rooms[roomId];

        // FIX: Reconnect durumunda aynı userId ile tekrar katılınabilir.
        // Eski userId varsa temizle, yeni bağlantıyı kaydet.
        room.users[userId] = { ws, nickname };
        if (!room.hostId) room.hostId = userId;

        ws.send(JSON.stringify({
          type:        'joined',
          userId,
          isHost:      room.hostId === userId,
          url:         room.url,
          comments:    room.comments,
          currentTime: room.currentTime || 0,
          lastAction:  room.lastAction  || null,
        }));

        broadcast(roomId, {
          type:      'user_joined',
          nickname,
          userCount: Object.keys(room.users).length,
        }, userId);
        break;
      }

      case 'set_url': {
        if (!currentRoom) return;
        const room = rooms[currentRoom];
        if (room.hostId !== userId) return;
        room.url         = msg.url;
        room.currentTime = 0;
        room.lastAction  = null;
        broadcast(currentRoom, { type: 'url_changed', url: msg.url });
        break;
      }

      case 'comment': {
        if (!currentRoom) return;
        const room = rooms[currentRoom];
        if (!msg.text || !msg.text.trim()) return;
        const comment = {
          id:       uuidv4().slice(0, 8),
          userId,
          nickname,
          text:     msg.text.trim(),
          ts:       Date.now(),
        };
        room.comments.push(comment);
        if (room.comments.length > 200) room.comments.splice(0, 1);
        // FIX: Yorum herkese yayınlanmalı (gönderen dahil), sadece
        // gönderene echo yapmak yerine broadcast(... null) kullanıyoruz.
        // Böylece reconnect sonrası yorum listesi tutarlı kalır.
        broadcast(currentRoom, { type: 'new_comment', comment });
        break;
      }

      case 'video_sync': {
        if (!currentRoom) return;
        const room = rooms[currentRoom];
        if (room.hostId !== userId) return; // sadece host senkronize edebilir

        const newTime   = typeof msg.time === 'number' ? msg.time : room.currentTime;
        const newAction = msg.action || null;

        // FIX: 'seek' action'ı da lastAction/currentTime günceller.
        // Ayrıca aynı seek pozisyonunu 1sn içinde tekrar broadcast etme (throttle).
        const isSameSeek = newAction === 'seek'
          && room.lastAction === 'seek'
          && Math.abs(newTime - room.currentTime) < 2;
        if (isSameSeek) break;

        room.currentTime = newTime;
        room.lastAction  = newAction;

        // Host hariç herkese ilet
        broadcast(currentRoom, {
          type:   'video_sync',
          action: newAction,
          time:   newTime,
        }, userId);
        break;
      }

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });

  ws.on('close', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room      = rooms[currentRoom];
    delete room.users[userId];
    const remaining = Object.keys(room.users);

    if (room.hostId === userId && remaining.length > 0) {
      room.hostId = remaining[0];
      room.users[room.hostId].ws.send(JSON.stringify({ type: 'you_are_host' }));
    }

    broadcast(currentRoom, {
      type:      'user_left',
      nickname,
      userCount: remaining.length,
    });
  });
});

function broadcast(roomId, msg, excludeUserId = null) {
  const room = rooms[roomId];
  if (!room) return;
  const data = JSON.stringify(msg);
  Object.entries(room.users).forEach(([uid, { ws }]) => {
    if (uid !== excludeUserId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 WatchParty çalışıyor → http://localhost:${PORT}\n`);
});