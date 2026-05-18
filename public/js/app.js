/* ── WatchParty Client ──────────────────────────────────────────── */
(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────
  let ws = null;
  let myUserId = null;
  let isHost = false;
  let roomId = null;
  let commentCount = 0;
  // Reconnect sırasında takma adı kaybetmemek için sakla
  let myNick = 'Misafir';

  // ── DOM refs ─────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const lobby        = $('lobby');
  const room         = $('room');
  const nickInput    = $('nickInput');
  const createBtn    = $('createBtn');
  const joinBtn      = $('joinBtn');
  const roomCodeIn   = $('roomCodeInput');
  const roomCodeDisp = $('roomCodeDisplay');
  const copyRoomBtn  = $('copyRoomBtn');
  const hostControls = $('hostControls');
  const urlInput     = $('urlInput');
  const loadBtn      = $('loadBtn');
  const videoFrame   = $('videoFrame');
  const placeholder  = $('placeholder');
  const frameWarn    = $('frameWarning');
  const openExt      = $('openExternal');
  const userCount    = $('userCountLabel');
  const roleLabel    = $('roleLabel');
  const commentList  = $('commentList');
  const commentCnt   = $('commentCount');
  const commentInput = $('commentInput');
  const sendBtn      = $('sendBtn');

  // ── Helpers ──────────────────────────────────────────────────────
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  // ── Auto-join from URL param ─────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(location.search);
    const r = params.get('room');
    if (r) {
      roomCodeIn.value = r.toUpperCase();
      toast('Oda kodu girildi, takma adını yaz ve Katıl!');
    }
  });

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
    myNick = nick;
    lobby.classList.add('hidden');
    room.classList.remove('hidden');
    roomCodeDisp.textContent = id;
    // FIX: "joined" mesajı gelmeden önce rol belirsiz kalmasın.
    // Herkesi başlangıçta izleyici olarak işaretle; sunucu "joined" ile gerçek
    // rolü bildirecek. Böylece host kontrolleri yanlışlıkla görünmez.
    setHost(false);
    connectWS(id, nick);
  }

  // ── Copy room code ───────────────────────────────────────────────
  copyRoomBtn.addEventListener('click', () => {
    const link = `${location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(link).then(() => toast('✓ Link kopyalandı!'));
  });

  // ── WebSocket ─────────────────────────────────────────────────────
  function connectWS(id, nick) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    if (ws) { ws.onclose = null; ws.close(); } // eski bağlantıyı sessizce kapat

    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => {
      send({ type: 'join', roomId: id, nick });
      console.log('WS bağlantısı kuruldu.');
    });

    ws.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleMsg(msg);
    });

    ws.addEventListener('close', () => {
      console.warn('WS koptu, 2sn sonra yeniden bağlanılıyor…');
      setTimeout(() => {
        if (roomId) connectWS(roomId, myNick); // kayıtlı nick ile reconnect
      }, 2000);
    });

    ws.addEventListener('error', () => ws.close());

    if (window.wsPingInterval) clearInterval(window.wsPingInterval);
    window.wsPingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) send({ type: 'ping' });
    }, 20000);
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // ── Message handler ──────────────────────────────────────────────
  function handleMsg(msg) {
    switch (msg.type) {
      case 'joined':
        // FIX: reconnect sonrası myUserId güncellenmeli
        myUserId = msg.userId;
        setHost(msg.isHost);
        if (msg.url) {
          loadVideo(msg.url).then(() => {
            if (!msg.isHost && msg.lastAction && msg.currentTime > 0) {
              setTimeout(() => syncVideoLocal(msg.lastAction, msg.currentTime), 2500);
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
        // FIX: Video yüklendikten sonra izleyici kilidini yeniden uygula
        // (loadVideo içinde videoFrame.classList manipülasyonu lock'u bozabilir)
        loadVideo(msg.url).then(() => {
          if (!isHost) setHost(false); // kilit ve rozeti tekrar aktif et
        });
        break;

      case 'video_sync':
        if (!isHost) syncVideoLocal(msg.action, msg.time);
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

  // ── Host / İzleyici kilidi ────────────────────────────────────────
  // FIX: İzleyicide videoyu tamamen kilitlemek için pointer-events:none
  // kullanıyoruz; eski "tıkla başlat" mantığı kaldırıldı.
  function setHost(h) {
    isHost = h;
    hostControls.style.display = h ? 'flex' : 'none';
    roleLabel.textContent = h ? 'HOST' : 'İZLEYİCİ';
    roleLabel.style.background = h ? 'var(--accent)' : 'var(--surface2)';
    roleLabel.style.color = h ? '#0a0a0d' : 'var(--muted)';

    // Şeffaf ama tıklanamaz kilit katmanı (orijinal CSS'teki #videoLock ile uyumlu)
    let lock = $('videoLock');
    if (!lock) {
      lock = document.createElement('div');
      lock.id = 'videoLock';
      videoFrame.parentElement.appendChild(lock);
    }

    if (h) {
      // Host: kilit tamamen devre dışı
      lock.style.cssText = 'display:none';
    } else {
      // İzleyici: şeffaf, tıklama geçirmez overlay — video kontrolleri engellenmiş
      lock.style.cssText = [
        'position:absolute',
        'inset:0',
        'z-index:999',
        'background:transparent',
        'cursor:not-allowed',
        'pointer-events:all',
      ].join(';');

      // Kullanıcıya bilgi vermek için küçük rozet
      let badge = $('viewerBadge');
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'viewerBadge';
        badge.style.cssText = [
          'position:absolute',
          'bottom:12px',
          'left:50%',
          'transform:translateX(-50%)',
          'background:rgba(10,10,13,0.75)',
          'color:var(--muted)',
          'font-family:var(--font-head,sans-serif)',
          'font-size:0.72rem',
          'padding:0.3rem 0.9rem',
          'border-radius:20px',
          'border:1px solid rgba(255,255,255,0.08)',
          'backdrop-filter:blur(8px)',
          'z-index:1000',
          'pointer-events:none',
          'white-space:nowrap',
        ].join(';');
        badge.textContent = '🔒 Video host tarafından kontrol ediliyor';
        videoFrame.parentElement.appendChild(badge);
      }
      badge.style.display = 'block';
    }

    // Host rozeti gizle
    const badge = $('viewerBadge');
    if (badge && h) badge.style.display = 'none';
  }

  // ── Load video ───────────────────────────────────────────────────
  // Sadece host URL yükleyebilir; izleyici için loadBtn zaten gizli
  loadBtn.addEventListener('click', () => {
    if (!isHost) return;
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

    return Promise.resolve();
  }

  function showLoadingOverlay(show) {
    let ov = $('loadingOverlay');
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

  // ── Comments ──────────────────────────────────────────────────────
  commentInput.addEventListener('input', () => {
    sendBtn.classList.toggle('active', commentInput.value.trim().length > 0);
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

  // FIX: addComment artık myUserId'yi closure yerine her çağrıda okur
  function addComment(c) {
    if (commentList.children.length > 200) commentList.removeChild(commentList.firstChild);
    const isOwn = c.userId === myUserId;
    const div = document.createElement('div');
    div.className = 'comment-bubble' + (isOwn ? ' own' : '');
    div.innerHTML =
      `<div class="comment-nick">${esc(c.nickname)}</div>` +
      `<div class="comment-text">${esc(c.text)}</div>` +
      `<div class="comment-time">${formatTime(c.ts)}</div>`;
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

  // ── Video sync ────────────────────────────────────────────────────
  // Yöntem A: Proxy iframe → host parent'a gönderdiği event'leri sunucuya ilet
  window.addEventListener('message', e => {
    if (!isHost) return;
    let data = e.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return; } }
    if (!data || !data.__watchparty_event) return;
    send({ type: 'video_sync', action: data.action, time: data.time || 0 });
  });

  // Yöntem B: Host'un video konumunu periyodik olarak sunucuya gönder
  // (proxy'nin iç içe iframe'lerinden event gelmediği durumlarda güvenli fallback)
  // Her 3 saniyede bir, same-origin iframe'den currentTime oku ve sunucuya bas.
  let lastBroadcastTime = -1;
  setInterval(() => {
    if (!isHost || !ws || ws.readyState !== WebSocket.OPEN) return;
    let currentTime = null;
    // Önce same-origin video elementini dene
    try {
      const doc = videoFrame.contentDocument || videoFrame.contentWindow.document;
      const vid = doc && doc.querySelector('video');
      if (vid && !vid.paused && !vid.ended) currentTime = vid.currentTime;
    } catch (_) {}
    // Değer değiştiyse sunucuya gönder (sadece oynarken, her seferinde değil)
    if (currentTime !== null && Math.abs(currentTime - lastBroadcastTime) > 2) {
      lastBroadcastTime = currentTime;
      send({ type: 'video_sync', action: 'seek', time: currentTime });
    }
    // iframe'e getStatus sor (proxy sayfası cevaplarsa Yöntem A devreye girer)
    try {
      videoFrame.contentWindow && videoFrame.contentWindow.postMessage(
        JSON.stringify({ __watchparty: true, getStatus: true }), '*'
      );
    } catch (_) {}
  }, 3000);

  function syncVideoLocal(action, time) {
    if (typeof window.triggerSyncLocal === 'function') {
      window.triggerSyncLocal(action, time);
    }
  }

  // Public API (sync butonları için)
  window.sendSync = function (action) {
    send({ type: 'video_sync', action, time: 0 });
    syncVideoLocal(action, 0);
  };

})();

// ── Global Senkronizasyon (Universal) ────────────────────────────────────────
window.triggerSyncLocal = function (action, time) {
  const videoFrame = document.getElementById('videoFrame');
  if (!videoFrame || videoFrame.classList.contains('hidden')) return;
  const target = videoFrame.contentWindow;
  if (!target) return;

  // Yöntem 1: Proxy iframe köprü protokolü
  // 'seek' → önce konuma git, sonra oynat (play gibi davran izleyicide)
  const proxyAction = action === 'seek' ? 'play' : action;
  target.postMessage(JSON.stringify({ __watchparty: true, action: proxyAction, time: time || 0 }), '*');

  // Yöntem 2: YouTube enablejsapi
  if (action === 'seek' || (typeof time === 'number' && time > 0)) {
    target.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [time || 0, true] }), '*');
  }
  if (action !== 'pause') {
    target.postMessage(JSON.stringify({ event: 'command', func: 'playVideo' }), '*');
  } else {
    target.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo' }), '*');
  }

  // Yöntem 3: Vimeo player API
  if (typeof time === 'number' && time > 0) {
    target.postMessage(JSON.stringify({ method: 'setCurrentTime', value: time }), '*');
  }
  target.postMessage(JSON.stringify({ method: action === 'pause' ? 'pause' : 'play' }), '*');

  // Yöntem 4: Same-origin direkt erişim
  try {
    const doc = videoFrame.contentDocument || target.document;
    doc.querySelectorAll('video').forEach(v => {
      if (typeof time === 'number' && Math.abs(v.currentTime - time) > 1.5) v.currentTime = time;
      if (action === 'pause') {
        try { v.pause(); } catch (_) { setTimeout(() => { try { v.pause(); } catch (__) {} }, 50); }
      } else {
        v.play().catch(() => { v.muted = true; v.play(); });
      }
    });
  } catch (_) { /* CORS — beklenen */ }
};