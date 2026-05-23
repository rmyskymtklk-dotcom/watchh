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
  } catch {
    return { type: 'proxy', url: rawUrl };
  }
}

// Bir sayfayı fetch edip içindeki video embed iframe src'sini çıkarır
async function scrapeEmbedFromPage(pageUrl) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8',
      'Referer': new URL(pageUrl).origin + '/',
    };
    const resp = await fetch(pageUrl, { headers, redirect: 'follow' });
    const html = await resp.text();

    // Yaygın video embed pattern'leri — sırayla dene
    const patterns = [
      // <iframe src="https://...">
      /[<\s]iframe[^>]+src=["']([^"']*(?:embed|player|watch|video|filembed|vidsrc|rapidvid|doodstream|streamtape|fembed|sibnet|ok\.ru|mail\.ru|my\.mail|veoh|vidmoly|filelions|streamwish|vidhide|voe\.sx|streamhub|vidplay|mp4upload|upstream)[^"']*?)["']/i,
      // data-src ile lazy-load iframe
      /[<\s]iframe[^>]+data-src=["']([^"']*(?:embed|player|video)[^"']*?)["']/i,
      // Herhangi bir dış kaynaklı iframe (son çare)
      /[<\s]iframe[^>]+src=["'](https?:\/\/(?!(?:www\.)?(?:dizican|dizibox|hdfilmcehennemi|facebook|twitter|google|doubleclick|ads))[^"']+)["']/i,
    ];

    for (const pat of patterns) {
      const m = html.match(pat);
      if (m && m[1] && m[1].startsWith('http')) {
        return m[1];
      }
    }
    return null;
  } catch(e) {
    return null;
  }
}

// Bilinen dizi/film sitelerinin sayfasından embed çıkarılabilir mi?
function isScrapeableHost(host) {
  const scrapeableHosts = [
    'dizican.tv', 'dizibox.pro', 'dizibox.me', 'dizibox.biz',
    'hdfilmcehennemi.nl', 'hdfilmcehennemi.com', 'hdfilmcehennemi.de',
    'dizipal.com', 'dizipal.net', 'dizifon.com', 'fullhdfilm.pro',
    'filmmakinesi.com', 'jetfilmizle.com', 'turkcealtyazi.org',
  ];
  return scrapeableHosts.some(h => host.includes(h));
}

app.get('/api/resolve', async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: 'url gerekli' });

  const result = resolveEmbedUrl(raw);

  // Bilinen dizi/film sitesiyse önce embed iframe'ini bulmaya çalış
  if (result.type === 'proxy') {
    try {
      const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
      const host = u.hostname.replace('www.', '');
      if (isScrapeableHost(host)) {
        const embedUrl = await scrapeEmbedFromPage(raw.startsWith('http') ? raw : 'https://' + raw);
        if (embedUrl) {
          console.log('[resolve] Scraped embed:', embedUrl);
          // Bulunan embed URL'sini de resolve et (örn. YouTube embed olabilir)
          const embedResult = resolveEmbedUrl(embedUrl);
          if (embedResult.type === 'embed') return res.json(embedResult);
          // Değilse proxy üzerinden yükle
          return res.json({ type: 'embed', url: '/proxy?url=' + encodeURIComponent(embedUrl) });
        }
        console.log('[resolve] Scrape failed for', raw, '— falling back to full proxy');
      }
    } catch(e) { /* ignore, fall through */ }
  }

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
    const targetHost = parsedTarget.hostname;

    // Bazı siteler için özel Referer/Origin gerekiyor
    const knownReferers = {
      'hdfilmcehennemi': 'https://www.hdfilmcehennemi.nl/',
      'dizibox': 'https://www.dizibox.pro/',
      'dizican': 'https://www.dizican.tv/',
      'filembed': targetOrigin + '/',
      'vidsrc': targetOrigin + '/',
      'embedsito': targetOrigin + '/',
    };
    let referer = targetOrigin + '/';
    for (const [key, val] of Object.entries(knownReferers)) {
      if (targetHost.includes(key)) { referer = val; break; }
    }

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
      'Referer': referer,
      'Origin': targetOrigin,
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Upgrade-Insecure-Requests': '1',
    };

    if (req.headers['range']) fetchHeaders['Range'] = req.headers['range'];
    if (req.headers['cookie']) fetchHeaders['Cookie'] = req.headers['cookie'];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(targetUrl, {
      method: req.method,
      signal: controller.signal,
      headers: fetchHeaders,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      compress: false,
      redirect: 'follow',
    });

    clearTimeout(timer);

    const ct = (response.headers.get('content-type') || '').toLowerCase();

    // Önemli: X-Frame-Options ve CSP'yi kaldır ki iframe içinde açılabilsin
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Set-Cookie başlığını istemciye ilet (bazı siteler auth için kullanıyor)
    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      // SameSite ve Secure bayraklarını kaldır ki proxy üzerinden çalışsın
      const cleanedCookie = setCookieHeader.replace(/;\s*SameSite=[^;]*/gi, '').replace(/;\s*Secure/gi, '');
      res.setHeader('Set-Cookie', cleanedCookie);
    }

    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'transfer-encoding'].forEach(h => {
      if (response.headers.has(h)) res.setHeader(h, response.headers.get(h));
    });
    res.status(response.status);

    // M3U8 playlist — içindeki URL'leri proxy'e yönlendir
    if (ct.includes('mpegurl') || ct.includes('x-mpegurl') || targetUrl.includes('.m3u8')) {
      let text = await response.text();
      let newLines = text.split('\n').map(line => {
        let tLine = line.trim();
        if (!tLine || tLine.startsWith('#')) return line;
        try {
          let absolute = new URL(tLine, parsedTarget).href;
          return '/proxy?url=' + encodeURIComponent(absolute);
        } catch(e) { return line; }
      });
      return res.send(newLines.join('\n'));
    }

    // Binary içerik (video, resim, font vb.) — doğrudan pipe et
    if (!ct.includes('text/html') && !ct.includes('text/javascript') && !ct.includes('application/javascript')) {
      return response.body.pipe(res);
    }

    // JavaScript dosyaları — doğrudan ilet (rewrite etme, bozulur)
    if (ct.includes('text/javascript') || ct.includes('application/javascript')) {
      let jsBody = await response.text();
      return res.send(jsBody);
    }

    // HTML — rewrite edip iframe içinde çalıştır
    let body = await response.text();

    // sandbox ve integrity kaldır
    body = body.replace(/ sandbox=["'][^"']*["']/gi, '');
    body = body.replace(/ integrity=["'][^"']*["']/gi, '');
    // CSP meta tag kaldır
    body = body.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
    // X-Frame-Options meta kaldır
    body = body.replace(/<meta[^>]+http-equiv=["']X-Frame-Options["'][^>]*>/gi, '');

    const interceptorScript = `
    <base href="${targetOrigin}/">
    <meta name="referrer" content="no-referrer">
    <script>
      (function(){
        var toProxy = function(url) {
           if (!url || typeof url !== 'string') return url;
           if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('#') || url.includes('/proxy?url=')) return url;
           try { return '/proxy?url=' + encodeURIComponent(new URL(url, document.baseURI || window.location.href).href); }
           catch(e) { return url; }
        };
        var origFetch = window.fetch;
        window.fetch = function() {
           var args = Array.prototype.slice.call(arguments);
           if (args[0]) {
               if (typeof args[0] === 'string') args[0] = toProxy(args[0]);
               else if (args[0] instanceof Request) args[0] = new Request(toProxy(args[0].url), args[1] || args[0]);
           }
           return origFetch.apply(this, args);
        };
        var origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function() {
           var args = Array.prototype.slice.call(arguments);
           if (args[1] && typeof args[1] === 'string') args[1] = toProxy(args[1]);
           return origOpen.apply(this, args);
        };
        // WebSocket'leri de proxy üzerinden geçir (bazı siteler kullanıyor)
        var OrigWS = window.WebSocket;
        window.WebSocket = function(url, protocols) {
          try {
            var wsUrl = new URL(url);
            var httpUrl = (wsUrl.protocol === 'wss:' ? 'https:' : 'http:') + '//' + wsUrl.host + wsUrl.pathname + wsUrl.search;
            var proxyUrl = '/proxy?url=' + encodeURIComponent(httpUrl);
            // Gerçek WS proxy zor, orijinal dene
            return protocols ? new OrigWS(url, protocols) : new OrigWS(url);
          } catch(e) { return protocols ? new OrigWS(url, protocols) : new OrigWS(url); }
        };
        window.WebSocket.prototype = OrigWS.prototype;
        window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1; window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;
      })();
    </script>`;

    body = body.replace('<head>', '<head>' + interceptorScript);
    if (!body.includes('<head>')) body = interceptorScript + body;

    // href/src URL'lerini proxy'e yönlendir
    body = body.replace(/(href|src|data-src|data-href|action)=["']([^"']+)["']/gi, (match, attr, url) => {
      if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('#') || url.includes('/proxy?url=')) return match;
      let fullUrl = url;
      if (url.startsWith('//')) fullUrl = 'https:' + url;
      else if (url.startsWith('/')) fullUrl = targetOrigin + url;
      else if (!url.startsWith('http')) {
        let pathDir = parsedTarget.pathname;
        if (!pathDir.endsWith('/')) pathDir = pathDir.substring(0, pathDir.lastIndexOf('/') + 1);
        fullUrl = targetOrigin + pathDir + url;
      }
      return `${attr}="/proxy?url=${encodeURIComponent(fullUrl)}"`;
    });

    const syncScript = `
<style>html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:auto!important}iframe,video{max-width:100%!important}</style>
<script>
(function(){
  try {
    var origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        if ((this.tagName === 'IFRAME' || this.tagName === 'SCRIPT') &&
            (name.toLowerCase() === 'src' || name.toLowerCase() === 'data-src') &&
            typeof value === 'string' && value.startsWith('http') &&
            !value.includes('/proxy?url=')) {
            value = '/proxy?url=' + encodeURIComponent(value);
        }
        return origSetAttr.call(this, name, value);
    };
    var origIframeSrc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (origIframeSrc) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
            get: function() { return origIframeSrc.get.call(this); },
            set: function(val) {
                if (typeof val === 'string' && val.startsWith('http') && !val.includes('/proxy?url=')) {
                    val = '/proxy?url=' + encodeURIComponent(val);
                }
                return origIframeSrc.set.call(this, val);
            }
        });
    }
  } catch(e) {}

  var lastWpCmd = null;
  var isViewer = false;

  window.addEventListener('message', function(e){
    var data = e.data;
    if(typeof data === 'string'){ try{ data = JSON.parse(data); }catch(err){ return; } }
    if(!data) return;

    if(data.__watchparty_role){
        isViewer = (data.__watchparty_role === 'viewer');
        var styleId = 'wp-viewer-lock';
        var existing = document.getElementById(styleId);
        if (isViewer && !existing) {
            var s = document.createElement('style');
            s.id = styleId;
            s.innerHTML = 'video, iframe, .vjs-big-play-button, .jw-display-icon-display, .plyr__control--overlaid, .plyr { pointer-events: none !important; }';
            document.head.appendChild(s);
        } else if (!isViewer && existing) {
            existing.remove();
        }
        document.querySelectorAll('iframe').forEach(function(f){
           try{ f.contentWindow.postMessage(JSON.stringify(data), '*'); }catch(err){}
        });
        return;
    }

    if(data.__watchparty_event){
      if(window.parent && window.parent !== window) window.parent.postMessage(JSON.stringify(data), '*');
      return;
    }
    if(data.__watchparty){
      lastWpCmd = data;
      applyCmd(data.action, data.time);
    }
  });

  function triggerCustomPlayers(action) {
      try {
          if (action === 'play') {
              var playBtns = document.querySelectorAll('.vjs-big-play-button, .jw-display-icon-display, .plyr__control--overlaid');
              playBtns.forEach(function(btn) { btn.click(); });
              if(typeof jwplayer === 'function') jwplayer().play();
              if(typeof videojs === 'function') { var vjs = videojs.getPlayers(); for(var k in vjs) { vjs[k].play(); } }
          } else if (action === 'pause') {
              if(typeof jwplayer === 'function') jwplayer().pause();
              if(typeof videojs === 'function') { var vjs2 = videojs.getPlayers(); for(var j in vjs2) { vjs2[j].pause(); } }
          }
      } catch(e) {}
  }

  function applyCmdToVideo(v, action, time) {
      try{
        if(typeof time === 'number' && Math.abs(v.currentTime - time) > 1.5) v.currentTime = time;
        if(action === 'unmute') {
            v.muted = false;
        } else if(action === 'play'){
          var p = v.play();
          if(p && p.catch) p.catch(function(){ v.muted = true; v.play().catch(function(){}); });
        } else if(action === 'pause'){
          try{ v.pause(); }catch(err){ setTimeout(function(){ try{ v.pause(); }catch(_){} }, 50); }
        }
      }catch(err){}
  }

  function applyCmd(action, time){
    if (action === 'unmute') {
        try{ if(typeof jwplayer === 'function') jwplayer().setMute(false); }catch(e){}
        try{ if(typeof videojs === 'function'){ var vjs=videojs.getPlayers(); for(var k in vjs)vjs[k].muted(false); } }catch(e){}
    } else {
        triggerCustomPlayers(action);
    }
    document.querySelectorAll('video').forEach(function(v){ applyCmdToVideo(v, action, time); });
    document.querySelectorAll('iframe').forEach(function(f){
      try{ f.contentWindow.postMessage(JSON.stringify({__watchparty:true, action:action, time:time}), '*'); }catch(err){}
    });
  }

  var lastSent = 0;
  function attachListeners(v){
    if(v.__wpAttached) return;
    v.__wpAttached = true;
    if (lastWpCmd) applyCmdToVideo(v, lastWpCmd.action, lastWpCmd.time);

    ['play','pause','seeked'].forEach(function(evt){
      v.addEventListener(evt, function(){
        var now = Date.now();
        if(now - lastSent < 300) return;
        lastSent = now;
        try{
          if(window.parent && window.parent !== window) {
             window.parent.postMessage(JSON.stringify({ __watchparty_event: true, action: evt === 'seeked' ? 'seek' : evt, time: v.currentTime }), '*');
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
            if(node.querySelectorAll) {
                node.querySelectorAll('video').forEach(attachListeners);
                node.querySelectorAll('iframe').forEach(function(f){
                   var s = f.src || f.getAttribute('data-src');
                   if(s && s.startsWith('http') && !s.includes('/proxy?url=')) {
                       var px = '/proxy?url=' + encodeURIComponent(s);
                       if (f.src) f.src = px;
                       if (f.hasAttribute('data-src')) f.setAttribute('data-src', px);
                   }
                });
            }
          });
        });
      }).observe(document.body || document.documentElement, {childList:true, subtree:true});
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeVideos);
  else observeVideos();
})();
</script>`;

    body = body.includes('</head>') ? body.replace('</head>', syncScript + '</head>') : syncScript + body;
    res.send(body);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).send(`<html><body style="background:#111;color:#ff6b6b;text-align:center;padding:2rem;"><h2>⚠️ Proxy Hatası: Video alınamadı</h2><p style="color:#aaa;font-size:0.9rem;">${err.message}</p></body></html>`);
  }
});

app.post('/api/room/create', (req, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms[roomId] = { url: '', comments: [], users: {}, hostId: null, currentTime: 0, lastAction: null };
  res.json({ roomId });
});

app.get('/api/room/:roomId', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: 'Oda bulunamadı' });
  res.json({ url: room.url, comments: room.comments, userCount: Object.keys(room.users).length, currentTime: room.currentTime, lastAction: room.lastAction });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Değişkenleri global yerine soket (ws) üzerine tanımlıyoruz
  ws.userId = null;
  ws.roomId = null;
  ws.nickname = 'Misafir';
  
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    
    switch (msg.type) {
      case 'join': {
        const { roomId, nick, userId } = msg;
        
        if (!rooms[roomId]) {
            rooms[roomId] = { url: '', comments: [], users: {}, hostId: null, currentTime: 0, lastAction: null };
        }
        
        ws.roomId = roomId;
        ws.userId = userId || uuidv4().slice(0, 6);
        ws.nickname = nick || 'Misafir';
        
        rooms[roomId].users[ws.userId] = { ws, nickname: ws.nickname };
        
        // Host yoksa VEYA bağlanan kişi eski host ise hostluğu ona ver
        if (!rooms[roomId].hostId || rooms[roomId].hostId === ws.userId) { 
            rooms[roomId].hostId = ws.userId; 
        }
       
        ws.send(JSON.stringify({ 
            type: 'joined', 
            userId: ws.userId, 
            isHost: rooms[roomId].hostId === ws.userId, 
            url: rooms[roomId].url, 
            comments: rooms[roomId].comments, 
            currentTime: rooms[roomId].currentTime || 0, 
            lastAction: rooms[roomId].lastAction || null 
        }));
        
        broadcast(roomId, { type: 'user_joined', nickname: ws.nickname, userCount: Object.keys(rooms[roomId].users).length }, ws.userId);
        break;
      }
      case 'set_url': {
        if (!ws.roomId || rooms[ws.roomId].hostId !== ws.userId) return;
        rooms[ws.roomId].url = msg.url; 
        rooms[ws.roomId].currentTime = 0; 
        rooms[ws.roomId].lastAction = null;
        broadcast(ws.roomId, { type: 'url_changed', url: msg.url });
        break;
      }
      case 'comment': {
        if (!ws.roomId || !msg.text.trim()) return;
        const comment = { id: uuidv4().slice(0, 8), userId: ws.userId, nickname: ws.nickname, text: msg.text.trim(), ts: Date.now() };
        rooms[ws.roomId].comments.push(comment);
        if (rooms[ws.roomId].comments.length > 200) rooms[ws.roomId].comments.splice(0, 1);
        broadcast(ws.roomId, { type: 'new_comment', comment });
        break;
      }
      case 'video_sync': {
        if (!ws.roomId || rooms[ws.roomId].hostId !== ws.userId) return;
        const newTime = typeof msg.time === 'number' ? msg.time : rooms[ws.roomId].currentTime;
        if (msg.action === 'seek' && rooms[ws.roomId].lastAction === 'seek' && Math.abs(newTime - rooms[ws.roomId].currentTime) < 2) break;
        rooms[ws.roomId].currentTime = newTime; 
        rooms[ws.roomId].lastAction = msg.action;
        broadcast(ws.roomId, { type: 'video_sync', action: msg.action, time: newTime }, ws.userId);
        break;
      }
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });
  
  ws.on('close', () => {
    if (!ws.roomId || !rooms[ws.roomId]) return;
    delete rooms[ws.roomId].users[ws.userId];
    
    const remaining = Object.keys(rooms[ws.roomId].users);
    
    // GÜNCELLENDİ: Host odadan düştüğünde anında başkasına devretme, 15 saniye bekle.
    if (rooms[ws.roomId].hostId === ws.userId) {
      setTimeout(() => {
        // 15 saniye geçti ve odaya orijinal host geri dönmediyse devret:
        if (rooms[ws.roomId] && rooms[ws.roomId].hostId === ws.userId && !rooms[ws.roomId].users[ws.userId]) {
            const currentRemaining = Object.keys(rooms[ws.roomId].users);
            if (currentRemaining.length > 0) {
              rooms[ws.roomId].hostId = currentRemaining[0];
              rooms[ws.roomId].users[rooms[ws.roomId].hostId].ws.send(JSON.stringify({ type: 'you_are_host' }));
            } else {
              rooms[ws.roomId].hostId = null; // Oda boşaldı
            }
        }
      }, 15000); // Tolerans süresi (Milisaniye)
    }
    broadcast(ws.roomId, { type: 'user_left', nickname: ws.nickname, userCount: remaining.length });
  });
});

function broadcast(roomId, msg, excludeUserId = null) {
  if (!rooms[roomId]) return;
  const data = JSON.stringify(msg);
  Object.entries(rooms[roomId].users).forEach(([uid, { ws }]) => {
    if (uid !== excludeUserId && ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

// GÜNCELLENDİ: Tarayıcı arka plan uyku süreleri düşünülerek zombi kontrolü 45 saniyeye çıkarıldı.
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(); 
  });
}, 45000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`\n🎬 WatchParty çalışıyor → http://localhost:${PORT}\n`));