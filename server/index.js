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

function resolveEmbedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    const host = u.hostname.replace('www.', '');
    if (host === 'youtube.com' || host === 'youtu.be') {
      let vid = u.searchParams.get('v');
      if (!vid && host === 'youtu.be') vid = u.pathname.slice(1).split('?')[0];
      if (!vid && u.pathname.startsWith('/shorts/')) vid = u.pathname.split('/shorts/')[1].split('?')[0];
      if (vid) return { type: 'embed', url: `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0&enablejsapi=1` };
    }
    if (host === 'bilibili.com') {
      const match = u.pathname.match(/\/video\/((?:BV|av)[\w]+)/i);
      if (match) {
        const vid = match[1];
        const param = vid.toUpperCase().startsWith('BV') ? `bvid=${vid}` : `aid=${vid.slice(2)}`;
        return { type: 'embed', url: `https://player.bilibili.com/player.html?${param}&autoplay=1&high_quality=1&danmaku=0&as_wide=1` };
      }
    }
    if (host === 'bilibili.tv') return { type: 'proxy', url: rawUrl };
    if (host === 'vimeo.com') {
      const vid = u.pathname.split('/').filter(Boolean)[0];
      if (vid && /^\d+$/.test(vid)) return { type: 'embed', url: `https://player.vimeo.com/video/${vid}?autoplay=1` };
    }
    if (host === 'dailymotion.com') {
      const vid = u.pathname.split('/video/')[1];
      if (vid) return { type: 'embed', url: `https://www.dailymotion.com/embed/video/${vid}?autoplay=1` };
    }
    return { type: 'proxy', url: rawUrl };
  } catch { return { type: 'proxy', url: rawUrl }; }
}

app.get('/api/resolve', (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: 'url gerekli' });
  const result = resolveEmbedUrl(raw);
  if (result.type === 'proxy') result.proxyUrl = '/proxy?url=' + encodeURIComponent(result.url);
  res.json(result);
});

app.all('/proxy', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,authorization,range,accept');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('url param required');
  try {
    const parsedTarget = new URL(targetUrl);
    const targetOrigin = parsedTarget.origin;
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: { 'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0', 'Referer': targetOrigin + '/' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      compress: false 
    });
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    res.removeHeader('X-Frame-Options');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'transfer-encoding'].forEach(h => {
      if (response.headers.has(h)) res.setHeader(h, response.headers.get(h));
    });
    res.status(response.status);
    if (!ct.includes('text/html')) return response.body.pipe(res);
    let body = await response.text();
    body = body.replace(/ sandbox=["'][^"']*["']/gi, '').replace(/ integrity=["'][^"']*["']/gi, '');
    const interceptor = `<head><meta name="referrer" content="no-referrer"><script>(function(){ var toP = function(u){ try{ return '/proxy?url=' + encodeURIComponent(new URL(u, document.baseURI).href); } catch(e){ return u; } }; var oF = window.fetch; window.fetch = function(){ var a = Array.prototype.slice.call(arguments); if(a[0] && typeof a[0] === 'string') a[0] = toP(a[0]); return oF.apply(this, a); }; })();</script>`;
    body = body.replace(/<head>/i, interceptor);
    body = body.replace(/(href|src|data-src|data-href)=["']([^"']+)["']/gi, (match, attr, url) => {
        if (url.includes('/proxy?url=')) return match;
        let fullUrl = url.startsWith('http') ? url : (url.startsWith('//') ? 'https:' + url : (url.startsWith('/') ? targetOrigin + url : targetOrigin + '/' + url));
        return `${attr}="/proxy?url=${encodeURIComponent(fullUrl)}"`;
    });
    res.send(body);
  } catch (err) { res.status(500).send('Hata'); }
});

wss.on('connection', (ws) => {
  let currentRoom = null;
  let userId = uuidv4().slice(0, 6);
  ws.on('message', (raw) => {
    let msg = JSON.parse(raw);
    if (msg.type === 'join') {
        currentRoom = msg.roomId;
        if(!rooms[currentRoom]) rooms[currentRoom] = { users:{}, comments:[], url:'' };
        rooms[currentRoom].users[userId] = ws;
        if(!rooms[currentRoom].hostId) rooms[currentRoom].hostId = userId;
        ws.send(JSON.stringify({ type: 'joined', userId, isHost: rooms[currentRoom].hostId === userId, comments: rooms[currentRoom].comments }));
    } else {
        if(msg.type === 'comment') rooms[currentRoom].comments.push({ nickname: msg.nick, text: msg.text });
        Object.values(rooms[currentRoom].users).forEach(c => c.send(JSON.stringify(msg)));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`\n🎬 WatchParty çalışıyor → http://localhost:${PORT}\n`));