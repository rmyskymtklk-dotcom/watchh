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

const rooms = {};

// ─── URL Dönüştürücü ──────────────────────────────────────────────────────────
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

    // Bilibili TV Desteği
    if (host === 'bilibili.tv') {
      const vid = u.pathname.split('/').pop();
      if (vid) {
        return { type: 'embed', url: `https://www.bilibili.tv/en/space/video/embed/${vid}` };
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

app.get('/api/resolve', (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: 'url gerekli' });
  const result = resolveEmbedUrl(raw);
  if (result.type === 'proxy') result.proxyUrl = '/proxy?url=' + encodeURIComponent(result.url);
  res.json(result);
});

// ─── Proxy Endpoint ───────────────────────────────────────────────────────────
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('url gerekli');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': new URL(targetUrl).origin,
      },
    });
    clearTimeout(timer);

    const ct = response.headers.get('content-type') || 'text/html';
    res.setHeader('Content-Type', ct);
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");

    if (!ct.includes('text/html')) {
      response.body.pipe(res);
      return;
    }

    let body = await response.text();
    const origin = new URL(targetUrl).origin;

    if (body.includes('<head>')) {
      body = body.replace('<head>', `<head><base href="${origin}/">`);
    }

    // Agresif Video Köprü Scripti
    const injectedAssets = `
    <style>html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: auto; }</style>
    <script>
    (function() {
      window.addEventListener('message', function(e) {
        var data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data.__watchparty) handleCmd(data);
      });

      function handleCmd(data) {
        var action = data.action;
        var time = data.time;
        var attempts = 0;

        function tryAction() {
          var vids = document.querySelectorAll('video');
          if (vids.length === 0 && attempts < 10) {
            attempts++;
            return setTimeout(tryAction, 1000);
          }
          vids.forEach(function(v) {
            if (time && Math.abs(v.currentTime - time) > 1.5) v.currentTime = time;
            if (action === 'play') v.play().catch(function() { v.muted = true; v.play(); });
            else if (action === 'pause') v.pause();
          });
        }
        tryAction();
      }
    })();
    </script>`;

    body = body.replace('</body>', injectedAssets + '</body>');
    res.send(body);
  } catch (err) {
    res.status(500).send('Proxy Hatası');
  }
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
      case 'join':
        const { roomId, nick } = msg;
        if (!rooms[roomId]) return;
        currentRoom = roomId;
        nickname = nick || 'Misafir';
        rooms[roomId].users[userId] = { ws, nickname };
        if (!rooms[roomId].hostId) rooms[roomId].hostId = userId;
        ws.send(JSON.stringify({ type: 'joined', userId, isHost: rooms[roomId].hostId === userId, url: rooms[roomId].url, comments: rooms[roomId].comments }));
        break;

      case 'set_url':
        if (currentRoom && rooms[currentRoom].hostId === userId) {
          rooms[currentRoom].url = msg.url;
          broadcast(currentRoom, { type: 'url_changed', url: msg.url });
        }
        break;

      case 'video_sync':
        if (currentRoom && rooms[currentRoom].hostId === userId) {
          rooms[currentRoom].currentTime = msg.time;
          rooms[currentRoom].lastAction = msg.action;
          broadcast(currentRoom, { type: 'video_sync', action: msg.action, time: msg.time }, userId);
        }
        break;

      case 'comment':
        if (currentRoom) {
          const comment = { id: uuidv4().slice(0, 8), userId, nickname, text: msg.text, ts: Date.now() };
          rooms[currentRoom].comments.push(comment);
          broadcast(currentRoom, { type: 'new_comment', comment });
        }
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].users[userId];
      if (rooms[currentRoom].hostId === userId) {
        const remaining = Object.keys(rooms[currentRoom].users);
        if (remaining.length > 0) {
          rooms[currentRoom].hostId = remaining[0];
          rooms[currentRoom].users[rooms[currentRoom].hostId].ws.send(JSON.stringify({ type: 'you_are_host' }));
        }
      }
    }
  });
});

function broadcast(roomId, msg, excludeUserId = null) {
  const room = rooms[roomId];
  if (!room) return;
  const data = JSON.stringify(msg);
  Object.entries(room.users).forEach(([uid, u]) => {
    if (uid !== excludeUserId && u.ws.readyState === WebSocket.OPEN) u.ws.send(data);
  });
}

app.post('/api/room/create', (req, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms[roomId] = { url: '', comments: [], users: {}, hostId: null };
  res.json({ roomId });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`WatchParty aktif: ${PORT}`));