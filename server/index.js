const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── In-memory store ──────────────────────────────────────────────────────────
const rooms = {};

// ─── URL Dönüştürücü: YouTube/Vimeo/Dailymotion → embed ─────────────────────
function resolveEmbedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    const host = u.hostname.replace('www.', '');

    if (host === 'youtube.com' || host === 'youtu.be') {
      let vid = u.searchParams.get('v');
      if (!vid && host === 'youtu.be') vid = u.pathname.slice(1).split('?')[0];
      if (!vid && u.pathname.startsWith('/shorts/')) vid = u.pathname.split('/shorts/')[1].split('?')[0];
      if (vid) {
        return {
          type: 'embed',
          url: `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0&enablejsapi=1`,
        };
      }
    }

    if (host === 'vimeo.com') {
      const vid = u.pathname.split('/').filter(Boolean)[0];
      if (vid && /^\d+$/.test(vid)) {
        return { type: 'embed', url: `https://player.vimeo.com/video/${vid}?autoplay=1` };
      }
    }

    if (host === 'dailymotion.com') {
      const vid = u.pathname.split('/video/')[1];
      if (vid) return { type: 'embed', url: `https://www.dailymotion.com/embed/video/${vid}?autoplay=1` };
    }

    return { type: 'proxy', url: rawUrl };
  } catch {
    return { type: 'proxy', url: rawUrl };
  }
}

// ─── /api/resolve — istemci URL'yi çözümler ──────────────────────────────────
app.get('/api/resolve', (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: 'url gerekli' });
  const result = resolveEmbedUrl(raw);
  if (result.type === 'proxy') {
    result.proxyUrl = '/proxy?url=' + encodeURIComponent(result.url);
  }
  res.json(result);
});

// ─── Proxy endpoint: CSP / X-Frame-Options başlıklarını temizler ─────────────
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('url param required');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': new URL(targetUrl).origin,
      },
    });
    clearTimeout(timer);

    const ct = response.headers.get('content-type') || 'text/html; charset=utf-8';
    res.setHeader('Content-Type', ct);

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Content-Type-Options');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!ct.includes('text/html')) {
      response.body.pipe(res);
      return;
    }

    let body = await response.text();
    const origin = new URL(targetUrl).origin;

    if (body.includes('<head>')) {
      body = body.replace('<head>', `<head><base href="${origin}/">`);
    } else {
      body = `<base href="${origin}/">` + body;
    }

    body = body.replace(/(href|src|action)=["']\/(?!\/)/gi, `$1="${origin}/`);
    body = body.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

    // ── Zorunlu CSS + Video Köprü Script Enjeksiyonu ──
    const injectedAssets = `
    <style>
        html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; height: 100% !important; overflow: auto !important; }
        iframe, video { max-width: 100% !important; }
    </style>
    <script>
    (function() {
      window.addEventListener('message', function(e) {
        var data = e.data;
        if (!data) return;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch(err) { return; }
        }
        if (data.__watchparty) {
          handleCmd(data);
        }
      });

      // GÜNCELLENEN AGRESİF handleCmd FONKSİYONU
      function handleCmd(data) {
        var action = data.action;
        var time   = data.time;

        function tryAction() {
          var videos = document.querySelectorAll('video');
          if (videos.length === 0) {
             // Video henüz DOM'da yoksa veya geç yükleniyorsa 500ms sonra tekrar dene
             return setTimeout(tryAction, 500);
          }
          
          videos.forEach(function(v) {
            try {
              // Zaman senkronizasyonu (1.5 saniyeden fazla sapma varsa)
              if (typeof time === 'number' && Math.abs(v.currentTime - time) > 1.5) {
                v.currentTime = time;
              }
              
              if (action === 'play') {
                var p = v.play();
                if (p && p.catch) {
                  p.catch(function() {
                    // Tarayıcı otomatik oynatmayı engellerse sessize alıp tekrar dene
                    v.muted = true; 
                    v.play().catch(function(e){ console.log("Oynatma başarısız:", e); });
                  });
                }
              } else if (action === 'pause') {
                v.pause();
              }
            } catch(err) {}
          });

          // İç iframe'lere (varsa) komutu ilet
          var innerFrames = document.querySelectorAll('iframe');
          innerFrames.forEach(function(f) {
            try {
              f.contentWindow.postMessage(JSON.stringify({ __watchparty: true, action: action, time: time }), '*');
              var ytCmd = action === 'play' ? 'playVideo' : 'pauseVideo';
              f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: ytCmd }), '*');
            } catch(err) {}
          });
        }
        tryAction();
      }

      document.addEventListener('DOMContentLoaded', observeVideos);
      if (document.readyState !== 'loading') observeVideos();

      function observeVideos() {
        document.querySelectorAll('video').forEach(attachListeners);
        if (window.MutationObserver) {
          var obs = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
              m.addedNodes.forEach(function(node) {
                if (node.nodeName === 'VIDEO') attachListeners(node);
                if (node.querySelectorAll) node.querySelectorAll('video').forEach(attachListeners);
              });
            });
          });
          obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        }
      }

      var lastSent = 0;
      function attachListeners(v) {
        if (v.__wpAttached) return;
        v.__wpAttached = true;
        ['play','pause','seeked'].forEach(function(evt) {
          v.addEventListener(evt, function() {
            var now = Date.now();
            if (now - lastSent < 300) return;
            lastSent = now;
            try {
              window.parent.postMessage(JSON.stringify({
                __watchparty_event: true,
                action: evt === 'play' ? 'play' : (evt === 'pause' ? 'pause' : 'seek'),
                time: v.currentTime
              }), '*');
            } catch(err) {}
          });
        });
      }
    })();
    </script>`;

    if (body.includes('</head>')) {
      body = body.replace('</head>', injectedAssets + '</head>');
    } else {
      body = injectedAssets + body;
    }

    res.send(body);
  } catch (err) {
    console.error('Proxy error:', err.message);
    const isTimeout = err.name === 'AbortError';
    res.status(500).send(`<html><body style="background:#111;color:#ff6b6b;font-family:sans-serif;padding:2rem;text-align:center"><h2>⚠️ Hata</h2></body></html>`);
  }
});

// ─── Room API ─────────────────────────────────────────────────────────────────
app.post('/api/room/create', (req, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms[roomId] = { url: '', comments: [], users: {}, hostId: null };
  res.json({ roomId });
});

app.get('/api/room/:roomId', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: 'Oda bulunamadı' });
  res.json({ url: room.url, comments: room.comments, userCount: Object.keys(room.users).length });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let currentRoom = null;
  let userId = uuidv4().slice(0, 6);
  let nickname = 'Misafir';

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join': {
        const { roomId, nick } = msg;
        if (!rooms[roomId]) return;
        currentRoom = roomId;
        nickname = nick || 'Misafir';
        const room = rooms[roomId];
        room.users[userId] = { ws, nickname };
        if (!room.hostId) room.hostId = userId;
        ws.send(JSON.stringify({
          type: 'joined',
          userId,
          isHost: room.hostId === userId,
          url: room.url,
          comments: room.comments,
          currentTime: room.currentTime || 0,
          lastAction: room.lastAction || null,
        }));
        broadcast(roomId, { type: 'user_joined', nickname, userCount: Object.keys(room.users).length }, userId);
        break;
      }
      case 'set_url': {
        if (!currentRoom || rooms[currentRoom].hostId !== userId) return;
        rooms[currentRoom].url = msg.url;
        broadcast(currentRoom, { type: 'url_changed', url: msg.url });
        break;
      }
      case 'comment': {
        if (!currentRoom) return;
        const comment = { id: uuidv4().slice(0, 8), userId, nickname, text: msg.text, ts: Date.now() };
        rooms[currentRoom].comments.push(comment);
        broadcast(currentRoom, { type: 'new_comment', comment });
        break;
      }
      case 'video_sync': {
        if (!currentRoom || rooms[currentRoom].hostId !== userId) return;
        rooms[currentRoom].currentTime = msg.time;
        rooms[currentRoom].lastAction = msg.action;
        broadcast(currentRoom, { type: 'video_sync', action: msg.action, time: msg.time });
        break;
      }
      case 'ping': ws.send(JSON.stringify({ type: 'pong' })); break;
    }
  });

  ws.on('close', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    delete room.users[userId];
    const remaining = Object.keys(room.users);
    if (room.hostId === userId && remaining.length > 0) {
      room.hostId = remaining[0];
      room.users[room.hostId].ws.send(JSON.stringify({ type: 'you_are_host' }));
    }
    broadcast(currentRoom, { type: 'user_left', nickname, userCount: remaining.length });
  });
});

function broadcast(roomId, msg, excludeUserId = null) {
  const room = rooms[roomId];
  if (!room) return;
  const data = JSON.stringify(msg);
  Object.entries(room.users).forEach(([uid, { ws }]) => {
    if (uid !== excludeUserId && ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => { console.log(`WatchParty yayında! Port: ${PORT}`); });