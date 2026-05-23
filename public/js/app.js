/* ── WatchParty Client ──────────────────────────────────────────── */
(function () {
  'use strict';
  let ws = null, myUserId = null, isHost = false, roomId = null, commentCount = 0, myNick = 'Misafir';

  const $ = id => document.getElementById(id);
  const lobby = $('lobby'), room = $('room'), nickInput = $('nickInput'), createBtn = $('createBtn'), joinBtn = $('joinBtn');
  const roomCodeIn = $('roomCodeInput'), roomCodeDisp = $('roomCodeDisplay'), copyRoomBtn = $('copyRoomBtn');
  const hostControls = $('hostControls'), urlInput = $('urlInput'), loadBtn = $('loadBtn'), videoFrame = $('videoFrame');
  const placeholder = $('placeholder'), frameWarn = $('frameWarning'), openExt = $('openExternal');
  const userCount = $('userCountLabel'), roleLabel = $('roleLabel'), commentList = $('commentList');
  const commentCnt = $('commentCount'), commentInput = $('commentInput'), sendBtn = $('sendBtn');

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  window.addEventListener('DOMContentLoaded', () => {
    const r = new URLSearchParams(location.search).get('room');
    if (r) { roomCodeIn.value = r.toUpperCase(); toast('Oda kodu girildi, takma adını yaz ve Katıl!'); }
  });

  function formatTime(ts) {
    const d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }

  function getNick() { return nickInput.value.trim() || 'Misafir'; }
  function esc(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  createBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/room/create', { method: 'POST' });
      enterRoom((await res.json()).roomId, getNick());
    } catch (e) { toast('Oda oluşturulamadı: ' + e.message); }
  });

  joinBtn.addEventListener('click', () => {
    const code = roomCodeIn.value.trim().toUpperCase();
    if (code.length < 6) return toast('Geçerli bir oda kodu gir');
    enterRoom(code, getNick());
  });

  roomCodeIn.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });
  nickInput.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });

  function enterRoom(id, nick) {
    roomId = id; myNick = nick;
    lobby.classList.add('hidden'); room.classList.remove('hidden');
    roomCodeDisp.textContent = id;
    setHost(false);
    connectWS(id, nick);
  }

  copyRoomBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(`${location.origin}?room=${roomId}`).then(() => toast('✓ Link kopyalandı!'));
  });

  function connectWS(id, nick) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    if (ws) { ws.onclose = null; ws.close(); }
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.addEventListener('open', () => send({ type: 'join', roomId: id, nick }));
    ws.addEventListener('message', e => { try { handleMsg(JSON.parse(e.data)); } catch {} });
    ws.addEventListener('close', () => setTimeout(() => { if (roomId) connectWS(roomId, myNick); }, 2000));
    ws.addEventListener('error', () => ws.close());
    if (window.wsPingInterval) clearInterval(window.wsPingInterval);
    window.wsPingInterval = setInterval(() => { if (ws && ws.readyState === 1) send({ type: 'ping' }); }, 20000);
  }

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function handleMsg(msg) {
    switch (msg.type) {
      case 'joined':
        myUserId = msg.userId; setHost(msg.isHost);
        if (msg.url) loadVideo(msg.url).then(() => { if (!msg.isHost && msg.lastAction) setTimeout(() => syncVideoLocal(msg.lastAction, msg.currentTime), 2000); });
        if (msg.comments) msg.comments.forEach(addComment);
        break;
      case 'you_are_host': setHost(true); toast('⭐ Sen artık host oldun!'); break;
      case 'url_changed': loadVideo(msg.url).then(() => { if (!isHost) setHost(false); }); break;
      case 'video_sync':
        if (!isHost) {
          // İZLEYİCİYE ANINDA BİLDİRİM VERİYORUZ
          let actionText = msg.action === 'play' ? '▶ Host videoyu oynatıyor...' : (msg.action === 'pause' ? '⏸ Host videoyu duraklattı' : '⏩ Host videoyu sardırdı');
          toast(actionText);
          syncVideoLocal(msg.action, msg.time);
        }
        break;
      case 'new_comment': addComment(msg.comment); break;
      case 'user_joined': addSysMsg(`👋 ${msg.nickname} katıldı`); userCount.textContent = msg.userCount + ' izleyici'; break;
      case 'user_left': addSysMsg(`💤 ${msg.nickname} ayrıldı`); userCount.textContent = msg.userCount + ' izleyici'; break;
      case 'error': toast('❌ ' + msg.text); break;
    }
  }

  function setHost(h) {
    isHost = h;
    hostControls.style.display = h ? 'flex' : 'none';
    roleLabel.textContent = h ? 'HOST' : 'İZLEYİCİ';
    roleLabel.style.background = h ? 'var(--accent)' : 'var(--surface2)';
    roleLabel.style.color = h ? '#0a0a0d' : 'var(--muted)';

    let lock = $('videoLock');
    if (!lock) { lock = document.createElement('div'); lock.id = 'videoLock'; videoFrame.parentElement.appendChild(lock); }
    if (h) {
      lock.style.cssText = 'display:none';
    } else {
      lock.style.cssText = 'position:absolute;inset:0;z-index:999;background:transparent;cursor:not-allowed;pointer-events:all;';
      let badge = $('viewerBadge');
      if (!badge) {
        badge = document.createElement('div'); badge.id = 'viewerBadge';
        badge.style.cssText = 'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);background:rgba(10,10,13,0.75);color:var(--muted);font-family:var(--font-head,sans-serif);font-size:0.72rem;padding:0.3rem 0.9rem;border-radius:20px;border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(8px);z-index:1000;pointer-events:none;white-space:nowrap;';
        badge.textContent = '🔒 Video host tarafından kontrol ediliyor';
        videoFrame.parentElement.appendChild(badge);
      }
      badge.style.display = 'block';
    }
    const badge = $('viewerBadge'); if (badge && h) badge.style.display = 'none';
  }

  loadBtn.addEventListener('click', () => {
    if (!isHost) return;
    const raw = urlInput.value.trim(); if (!raw) return toast('Bir link gir');
    const url = raw.startsWith('http') ? raw : 'https://' + raw;
    send({ type: 'set_url', url }); loadVideo(url);
  });

  async function loadVideo(url) {
    if (!url) return;
    placeholder.classList.add('hidden'); frameWarn.classList.add('hidden'); videoFrame.classList.remove('hidden');
    videoFrame.src = 'about:blank';
    showLoadingOverlay(true);
    try {
      const res = await fetch('/api/resolve?url=' + encodeURIComponent(url));
      const data = await res.json();
      showLoadingOverlay(false);
      openExt.href = url;
      videoFrame.src = data.type === 'embed' ? data.url : data.proxyUrl;
    } catch (err) { showLoadingOverlay(false); frameWarn.classList.remove('hidden'); }
  }

  function showLoadingOverlay(show) {
    let ov = $('loadingOverlay');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'loadingOverlay';
      ov.innerHTML = `<div class="spinner"></div><span>Yükleniyor…</span>`;
      ov.style.cssText = `position:absolute;inset:0;background:rgba(10,10,13,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;color:#e8ff47;font-family:'Syne',sans-serif;font-size:0.9rem;z-index:20;backdrop-filter:blur(4px);`;
      const style = document.createElement('style'); style.textContent = `.spinner{width:36px;height:36px;border:3px solid rgba(232,255,71,0.2);border-top-color:#e8ff47;border-radius:50%;animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`;
      document.head.appendChild(style);
      const panel = document.querySelector('.video-panel'); if (panel) panel.appendChild(ov);
    }
    ov.style.display = show ? 'flex' : 'none';
  }

  commentInput.addEventListener('input', () => sendBtn.classList.toggle('active', commentInput.value.trim().length > 0));
  sendBtn.addEventListener('click', sendComment);
  commentInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); } });

  function sendComment() {
    const text = commentInput.value.trim(); if (!text) return;
    send({ type: 'comment', text }); commentInput.value = ''; sendBtn.classList.remove('active');
  }

  function addComment(c) {
    if (commentList.children.length > 200) commentList.removeChild(commentList.firstChild);
    const div = document.createElement('div');
    div.className = 'comment-bubble' + (c.userId === myUserId ? ' own' : '');
    div.innerHTML = `<div class="comment-nick">${esc(c.nickname)}</div><div class="comment-text">${esc(c.text)}</div><div class="comment-time">${formatTime(c.ts)}</div>`;
    commentList.appendChild(div); commentList.scrollTop = commentList.scrollHeight;
    commentCnt.textContent = ++commentCount;
  }
  function addSysMsg(text) {
    const div = document.createElement('div'); div.className = 'sys-msg'; div.textContent = text;
    commentList.appendChild(div); commentList.scrollTop = commentList.scrollHeight;
  }

  window.addEventListener('message', e => {
    if (!isHost) return;
    let data = e.data; if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return; } }
    if (data && data.__watchparty_event) send({ type: 'video_sync', action: data.action, time: data.time || 0 });
  });

  let lastBroadcastTime = -1;
  setInterval(() => {
    if (!isHost || !ws || ws.readyState !== 1) return;
    let currentTime = null;
    try {
      const vid = (videoFrame.contentDocument || videoFrame.contentWindow.document)?.querySelector('video');
      if (vid && !vid.paused && !vid.ended) currentTime = vid.currentTime;
    } catch (_) {}
    if (currentTime !== null && Math.abs(currentTime - lastBroadcastTime) > 2) {
      lastBroadcastTime = currentTime; send({ type: 'video_sync', action: 'seek', time: currentTime });
    }
  }, 3000);

  function syncVideoLocal(action, time) { if (typeof window.triggerSyncLocal === 'function') window.triggerSyncLocal(action, time); }
  window.sendSync = function (action) { send({ type: 'video_sync', action, time: 0 }); syncVideoLocal(action, 0); };

})();

window.triggerSyncLocal = function (action, time) {
  const videoFrame = document.getElementById('videoFrame');
  if (!videoFrame || videoFrame.classList.contains('hidden')) return;
  const target = videoFrame.contentWindow;
  if (!target) return;

  const proxyAction = action === 'seek' ? 'play' : action;
  const command = JSON.stringify({ __watchparty: true, action: proxyAction, time: time || 0 });

  // GECİKMELİ ZORLA ÇALIŞTIRMA: Eğer iframe ağır yükleniyorsa diye komutu 3 kere (anında, 1sn ve 2sn sonra) fırlatıyoruz!
  target.postMessage(command, '*');
  setTimeout(() => target.postMessage(command, '*'), 1000);
  setTimeout(() => target.postMessage(command, '*'), 2500);

  // YouTube ve Vimeo API komutları
  if (action === 'seek' || (typeof time === 'number' && time > 0)) {
    target.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [time || 0, true] }), '*');
    target.postMessage(JSON.stringify({ method: 'setCurrentTime', value: time }), '*');
  }
  target.postMessage(JSON.stringify({ event: 'command', func: action !== 'pause' ? 'playVideo' : 'pauseVideo' }), '*');
  target.postMessage(JSON.stringify({ method: action === 'pause' ? 'pause' : 'play' }), '*');

  try {
    const doc = videoFrame.contentDocument || target.document;
    doc.querySelectorAll('video').forEach(v => {
      if (typeof time === 'number' && Math.abs(v.currentTime - time) > 1.5) v.currentTime = time;
      if (action === 'pause') {
        try { v.pause(); } catch (_) { setTimeout(() => { try { v.pause(); } catch (__) {} }, 50); }
      } else { v.play().catch(() => { v.muted = true; v.play(); }); }
    });
  } catch (_) {}
};