/* ── WatchParty Client ──────────────────────────────────────────── */
(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────
  let ws = null;
  let myUserId = null;
  let isHost = false;
  let roomId = null;
  let commentCount = 0;

  // ── DOM refs ─────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const lobby       = $('lobby');
  const room        = $('room');
  const nickInput   = $('nickInput');
  const createBtn   = $('createBtn');
  const joinBtn     = $('joinBtn');
  const roomCodeIn  = $('roomCodeInput');
  const roomCodeDisp = $('roomCodeDisplay');
  const copyRoomBtn = $('copyRoomBtn');
  const hostControls = $('hostControls');
  const urlInput     = $('urlInput');
  const loadBtn      = $('loadBtn');
  const videoFrame   = $('videoFrame');
  const placeholder = $('placeholder');
  const frameWarn   = $('frameWarning');
  const openExt     = $('openExternal');
  const userCount   = $('userCountLabel');
  const roleLabel   = $('roleLabel');
  const commentList = $('commentList');
  const commentCnt  = $('commentCount');
  const commentInput = $('commentInput');
  const sendBtn     = $('sendBtn');

  // ── Helpers ──────────────────────────────────────────────────────
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' +
           d.getMinutes().toString().padStart(2, '0');
  }

  function getNick() {
    return nickInput.value.trim() || 'Misafir';
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Lobby actions ────────────────────────────────────────────────
  createBtn.addEventListener('click', async () => {
    const nick = getNick();
    try {
      const res = await fetch('/api/room/create', { method: 'POST' });
      const data = await res.json();
      enterRoom(data.roomId, nick);
    } catch (e) {
      toast('Oda oluşturulamadı: ' + e.message);
    }
  });

  joinBtn.addEventListener('click', () => {
    const code = roomCodeIn.value.trim().toUpperCase();
    if (code.length < 6) { toast('Geçerli bir oda kodu gir'); return; }
    enterRoom(code, getNick());
  });

  roomCodeIn.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });
  nickInput.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });

  // ── Enter room ───────────────────────────────────────────────────
  function enterRoom(id, nick) {
    roomId = id;
    lobby.classList.add('hidden');
    room.classList.remove('hidden');
    roomCodeDisp.textContent = id;
    connectWS(id, nick);
  }

  // ── Copy room code ───────────────────────────────────────────────
  copyRoomBtn.addEventListener('click', () => {
    const link = `${location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(link).then(() => toast('✓ Link kopyalandı!'));
  });

  // ── Auto-join from URL param ─────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(location.search);
    const r = params.get('room');
    if (r) {
      roomCodeIn.value = r.toUpperCase();
      toast('Oda kodu girildi, takma adını yaz ve Katıl!');
    }
  });

  // ── WebSocket (Kopma ve Görünmezlik Sorunu Çözümü) ─────────────
  function connectWS(id, nick) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    if (ws) { ws.close(); }
    
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => {
      send({ type: 'join', roomId: id, nick });
      console.log("Bağlantı taze lendi ve kuruldu.");
    });

    ws.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleMsg(msg);
    });

    ws.addEventListener('close', () => {
      console.warn("Bağlantı zaman aşımına uğradı, 2 saniye içinde canlandırılıyor...");
      setTimeout(() => {
        if (roomId) connectWS(roomId, getNick());
      }, 2000);
    });

    ws.addEventListener('error', (err) => {
      console.error("Bağlantı hatası:", err);
      ws.close();
    });

    if (window.wsPingInterval) clearInterval(window.wsPingInterval);
    window.wsPingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        send({ type: 'ping' });
      }
    }, 20000);
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // ── Message handler ──────────────────────────────────────────────
  function handleMsg(msg) {
    switch (msg.type) {
      case 'joined':
        myUserId = msg.userId;
        setHost(msg.isHost);
        if (msg.url) {
          loadVideo(msg.url).then(() => {
            // Video yüklendikten sonra mevcut konuma sync et
            if (!msg.isHost && msg.lastAction && msg.currentTime > 0) {
              setTimeout(() => {
                window.triggerSyncLocal(msg.lastAction, msg.currentTime);
              }, 2500); // iframe'in yüklenmesi için bekle
            }
          });
        }
        if (msg.comments) msg.comments.forEach(addComment);
        break;

      case 'you_are_host':
        setHost(true);
        toast('⭐ Sen artık host oldun!');
        break;

      case 'url_changed':
        loadVideo(msg.url);
        break;

      case 'video_sync':
        syncVideoLocal(msg.action, msg.time);
        break;

      case 'new_comment':
        addComment(msg.comment);
        break;

      case 'user_joined':
        addSysMsg(`👋 ${msg.nickname} katıldı`);
        userCount.textContent = msg.userCount + ' izleyici';
        break;

      case 'user_left':
        addSysMsg(`💤 ${msg.nickname} ayrıldı`);
        userCount.textContent = msg.userCount + ' izleyici';
        break;

      case 'error':
        toast('❌ ' + msg.text);
        break;
    }
  }

  // ── Host ve İzleyici Kilidi ───────────────────────────────────────
  function setHost(h) {
    isHost = h;
    hostControls.style.display = h ? 'flex' : 'none';
    roleLabel.textContent = h ? 'HOST' : 'İZLEYİCİ';
    roleLabel.style.background = h ? 'var(--accent)' : 'var(--surface2)';
    roleLabel.style.color = h ? '#0a0a0d' : 'var(--muted)';

    let lock = $('videoLock');
    if (!lock) {
        lock = document.createElement('div');
        lock.id = 'videoLock';
        lock.style.cssText = "position:absolute;inset:0;z-index:10;cursor:not-allowed;background:rgba(0,0,0,0);";
        videoFrame.parentElement.appendChild(lock);
    }
    lock.style.display = h ? 'none' : 'block';
  }

  // ── Load video ───────────────────────────────────────────────────
  loadBtn.addEventListener('click', () => {
    const raw = urlInput.value.trim();
    if (!raw) { toast('Bir link gir'); return; }
    const url = raw.startsWith('http') ? raw : 'https://' + raw;
    send({ type: 'set_url', url });
    loadVideo(url);
  });

  async function loadVideo(url) {
    if (!url) return Promise.resolve();
    placeholder.classList.add('hidden');
    frameWarn.classList.add('hidden');
    videoFrame.classList.remove('hidden');
    videoFrame.src = 'about:blank';
    showLoadingOverlay(true);

    try {
      const res = await fetch('/api/resolve?url=' + encodeURIComponent(url));
      const data = await res.json();
      showLoadingOverlay(false);
      const iframeSrc = data.type === 'embed' ? data.url : data.proxyUrl;
      openExt.href = url;
      videoFrame.src = iframeSrc;
    } catch (err) {
      showLoadingOverlay(false);
      frameWarn.classList.remove('hidden');
    }
  }

  function showLoadingOverlay(show) {
    let ov = document.getElementById('loadingOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'loadingOverlay';
      ov.innerHTML = `<div class="spinner"></div><span>Yükleniyor…</span>`;
      ov.style.cssText = `position:absolute;inset:0;background:rgba(10,10,13,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;color:#e8ff47;font-family:'Syne',sans-serif;font-size:0.9rem;z-index:20;backdrop-filter:blur(4px);`;
      const style = document.createElement('style');
      style.textContent = `.spinner{width:36px;height:36px;border:3px solid rgba(232,255,71,0.2);border-top-color:#e8ff47;border-radius:50%;animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`;
      document.head.appendChild(style);
      const panel = document.querySelector('.video-panel');
      if (panel) panel.appendChild(ov);
    }
    ov.style.display = show ? 'flex' : 'none';
  }

  // ── Comments ve Buton Efekti ──────────────────────────────────────
  commentInput.addEventListener('input', () => {
      if (commentInput.value.trim().length > 0) {
          sendBtn.classList.add('active');
      } else {
          sendBtn.classList.remove('active');
      }
  });

  sendBtn.addEventListener('click', sendComment);
  commentInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); }
  });

  function sendComment() {
    const text = commentInput.value.trim();
    if (!text) return;
    send({ type: 'comment', text });
    commentInput.value = '';
    sendBtn.classList.remove('active');
  }

  function addComment(c) {
    if (commentList.children.length > 100) commentList.removeChild(commentList.firstChild);
    const isOwn = c.userId === myUserId;
    const div = document.createElement('div');
    div.className = 'comment-bubble' + (isOwn ? ' own' : '');
    div.innerHTML = `<div class="comment-nick">${esc(c.nickname)}</div><div class="comment-text">${esc(c.text)}</div><div class="comment-time">${formatTime(c.ts)}</div>`;
    commentList.appendChild(div);
    commentList.scrollTop = commentList.scrollHeight;
    commentCount++;
    commentCnt.textContent = commentCount;
  }

  function addSysMsg(text) {
    const div = document.createElement('div');
    div.className = 'sys-msg';
    div.textContent = text;
    commentList.appendChild(div);
    commentList.scrollTop = commentList.scrollHeight;
  }

  // ── Senkronizasyon Yardımcı Fonksiyonu ──────────────────────────
  window.triggerSyncLocal = function(action, time) {
    const mesaj = action === 'play' ? 'BAŞLATILDI' : action === 'pause' ? 'DURDURULDU' : 'ATLANDI';
    toast(`📢 Host komutu: ${mesaj}`);

    if (!videoFrame || videoFrame.classList.contains('hidden')) return;

    const target = videoFrame.contentWindow;
    if (!target) return;

    // Yöntem 1: Proxy iframe'e köprü protokolü (ana çözüm)
    const wpMsg = JSON.stringify({ __watchparty: true, action, time: time || 0 });
    target.postMessage(wpMsg, '*');

    // Yöntem 2: YouTube embed API (enablejsapi=1 ile yüklendi)
    const ytCmd = action === 'play' ? 'playVideo' : 'pauseVideo';
    target.postMessage(JSON.stringify({ event: 'command', func: ytCmd }), '*');
    if (typeof time === 'number' && time > 0) {
      target.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [time, true] }), '*');
    }

    // Yöntem 3: Vimeo player API
    const vimeoCmd = action === 'play' ? 'play' : 'pause';
    target.postMessage(JSON.stringify({ method: vimeoCmd }), '*');

    // Yöntem 4: Same-origin fallback (proxy sayfasında direkt erişim)
    try {
      const innerDoc = videoFrame.contentDocument || target.document;
      const videos = innerDoc.querySelectorAll('video');
      videos.forEach(v => {
        try {
          if (typeof time === 'number' && time > 0) v.currentTime = time;
          action === 'play' ? v.play().catch(() => {}) : v.pause();
        } catch(e) {}
      });
    } catch (e) { /* CORS engeli — beklenen durum */ }
  };

  // iframe'den gelen video olaylarını host olarak yakala ve yayınla
  window.addEventListener('message', (e) => {
    if (!isHost) return;
    let data = e.data;
    if (!data) return;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return; }
    }
    if (data.__watchparty_event) {
      send({ type: 'video_sync', action: data.action, time: data.time || 0 });
    }
  });

  function syncVideoLocal(action, time) {
    window.triggerSyncLocal(action, time);
  }

  window.addEventListener('sendSyncTrigger', (e) => {
    if (!isHost) return;
    send({ type: 'video_sync', action: e.detail.action, time: e.detail.time || 0 });
  });

})();

// ── Global Senkronizasyon Fonksiyonu ────────────────────
window.sendSync = function(action) {
  console.log("Senkronizasyon butonu tıklandı: " + action);
  const syncEvent = new CustomEvent('sendSyncTrigger', { detail: { action: action } });
  window.dispatchEvent(syncEvent);
  if (typeof window.triggerSyncLocal === 'function') {
      window.triggerSyncLocal(action, 0);
  }
};