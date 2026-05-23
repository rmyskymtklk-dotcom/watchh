/* ── WatchParty Client ──────────────────────────────────────────── */
(function () {
  'use strict';
 
  let ws = null;
  let myUserId = null;
  let isHost = false;
  let roomId = null;
  let commentCount = 0;
  let myNick = 'Misafir';
  const $ = id => document.getElementById(id);
  const lobby = $('lobby');
  const room = $('room');
  const nickInput = $('nickInput');
  const createBtn = $('createBtn');
  const joinBtn = $('joinBtn');
  const roomCodeIn = $('roomCodeInput');
  const roomCodeDisp = $('roomCodeDisplay');
  const copyRoomBtn = $('copyRoomBtn');
  const hostControls = $('hostControls');
  const urlInput = $('urlInput');
  const loadBtn = $('loadBtn');
  const videoFrame = $('videoFrame');
  const placeholder = $('placeholder');
  const frameWarn = $('frameWarning');
  const openExt = $('openExternal');
  const userCount = $('userCountLabel');
  const roleLabel = $('roleLabel');
  const commentList = $('commentList');
  const commentCnt = $('commentCount');
  const commentInput = $('commentInput');
  const sendBtn = $('sendBtn');
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }
  // --- TAM EKRAN (FULLSCREEN) ÇÖZÜMÜ ---
  // Sadece .video-panel'i büyütür, sayfanın geri kalanını etkilemez.

  function setupFullscreen() {
    const trySetup = () => {
      const panel = document.querySelector('.video-panel');
      if (!panel) return;

      if (!document.getElementById('wp-fs-style')) {
        const style = document.createElement('style');
        style.id = 'wp-fs-style';
        style.innerHTML = `
          .wp-css-fullscreen {
            position: fixed !important;
            top: 0 !important; left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            height: 100dvh !important;
            z-index: 99999 !important;
            background: #000 !important;
            border-radius: 0 !important;
          }
          .video-panel #videoFrame {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
          }
        `;
        document.head.appendChild(style);
      }

      panel.addEventListener('dblclick', () => toggleFS(panel));

      let fsBtn = document.getElementById('wp-fs-btn');
      if (!fsBtn) {
        fsBtn = document.createElement('button');
        fsBtn.id = 'wp-fs-btn';
        fsBtn.title = 'Tam Ekran';
        fsBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';
        fsBtn.style.cssText = 'position:absolute; bottom:12px; right:12px; z-index:1000; background:rgba(10,10,13,0.75); color:var(--text); border:1px solid rgba(255,255,255,0.08); border-radius:8px; width:40px; height:40px; cursor:pointer; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px); transition:all 0.2s ease;';
        fsBtn.onmouseover = () => { fsBtn.style.color = '#0a0a0d'; fsBtn.style.background = 'var(--accent)'; };
        fsBtn.onmouseout  = () => { fsBtn.style.color = 'var(--text)'; fsBtn.style.background = 'rgba(10,10,13,0.75)'; };
        fsBtn.onclick = (e) => { e.stopPropagation(); toggleFS(panel); };
        panel.appendChild(fsBtn);
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.classList.contains('wp-css-fullscreen')) {
          panel.classList.remove('wp-css-fullscreen');
          updateFsIcon(fsBtn, false);
        }
      });
      document.addEventListener('fullscreenchange', () => {
        updateFsIcon(fsBtn, !!document.fullscreenElement);
      });
    };

    // #room henüz gizliyse görünür olana kadar bekle
    const roomEl = document.getElementById('room');
    if (roomEl && roomEl.classList.contains('hidden')) {
      const obs = new MutationObserver(() => {
        if (!roomEl.classList.contains('hidden')) { obs.disconnect(); trySetup(); }
      });
      obs.observe(roomEl, { attributes: true, attributeFilter: ['class'] });
    } else {
      trySetup();
    }
  }

  function updateFsIcon(btn, isFullscreen) {
    if (!btn) return;
    if (isFullscreen) {
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>';
    } else {
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';
    }
  }

  function toggleFS(panel) {
    const fsBtn = document.getElementById('wp-fs-btn');
    const isNativeFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const isCssFS = panel.classList.contains('wp-css-fullscreen');

    if (!isNativeFS && !isCssFS) {
      if (panel.requestFullscreen) {
        panel.requestFullscreen().then(() => {
          updateFsIcon(fsBtn, true);
        }).catch(() => {
          panel.classList.add('wp-css-fullscreen');
          updateFsIcon(fsBtn, true);
        });
      } else if (panel.webkitRequestFullscreen) {
        panel.webkitRequestFullscreen();
        updateFsIcon(fsBtn, true);
      } else {
        panel.classList.add('wp-css-fullscreen');
        updateFsIcon(fsBtn, true);
      }
    } else {
      if (isNativeFS) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
      if (isCssFS) panel.classList.remove('wp-css-fullscreen');
      updateFsIcon(fsBtn, false);
    }
  }
  // ------------------------------------------
  window.addEventListener('DOMContentLoaded', () => {
    const r = new URLSearchParams(location.search).get('room');
    if (r && roomCodeIn) {
        roomCodeIn.value = r.toUpperCase();
        toast('Oda kodu girildi, takma adını yaz ve Katıl!');
    }
    setupFullscreen();
  });
  function formatTime(ts) {
    const d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }
  function getNick() {
      return (nickInput && nickInput.value.trim()) ? nickInput.value.trim() : 'Misafir';
  }
 
  function esc(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  if(createBtn) createBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/room/create', { method: 'POST' });
      const data = await res.json();
      enterRoom(data.roomId, getNick());
    } catch (e) {
        toast('Oda oluşturulamadı: ' + e.message);
    }
  });
  if(joinBtn) joinBtn.addEventListener('click', () => {
    if(!roomCodeIn) return;
    const code = roomCodeIn.value.trim().toUpperCase();
    if (code.length < 6) return toast('Geçerli bir oda kodu gir');
    enterRoom(code, getNick());
  });
  if(roomCodeIn) roomCodeIn.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });
  if(nickInput) nickInput.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });
  function enterRoom(id, nick) {
    roomId = id;
    myNick = nick;
    if(lobby) lobby.classList.add('hidden');
    if(room) room.classList.remove('hidden');
    if(roomCodeDisp) roomCodeDisp.textContent = id;
    setHost(false);
    connectWS(id, nick);
  }
  if(copyRoomBtn) copyRoomBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(`${location.origin}?room=${roomId}`).then(() => toast('✓ Link kopyalandı!'));
  });
  function connectWS(id, nick) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    if (ws) { ws.onclose = null; ws.close(); }
    ws = new WebSocket(`${proto}://${location.host}`);
   
    ws.addEventListener('open', () => send({ type: 'join', roomId: id, nick }));
   
    // SESSİZCE YUTULAN HATA BURADA ÇÖZÜLDÜ: Artık tüm veriler güvenli alınıyor
    ws.addEventListener('message', e => {
        let msg;
        try {
            msg = JSON.parse(e.data);
        } catch(err) { return; }
       
        try {
            handleMsg(msg);
        } catch(err) {
            console.error('Mesaj işleme hatası:', err);
        }
    });
   
    ws.addEventListener('close', () => setTimeout(() => { if (roomId) connectWS(roomId, myNick); }, 2000));
    ws.addEventListener('error', () => ws.close());
   
    if (window.wsPingInterval) clearInterval(window.wsPingInterval);
    window.wsPingInterval = setInterval(() => { if (ws && ws.readyState === 1) send({ type: 'ping' }); }, 20000);
  }
  function send(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  function handleMsg(msg) {
    switch (msg.type) {
      case 'joined':
        myUserId = msg.userId;
        setHost(msg.isHost);
        if (msg.url) {
            loadVideo(msg.url).then(() => {
                if (!msg.isHost && msg.lastAction) {
                    setTimeout(() => syncVideoLocal(msg.lastAction, msg.currentTime), 2000);
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
        loadVideo(msg.url).then(() => { if (!isHost) setHost(false); });
        break;
      case 'video_sync':
        if (!isHost) {
          let actionText = msg.action === 'play' ? '▶ Host videoyu oynatıyor...' : (msg.action === 'pause' ? '⏸ Host videoyu duraklattı' : '⏩ Host videoyu sardırdı');
          toast(actionText);
          syncVideoLocal(msg.action, msg.time);
        }
        break;
      case 'new_comment':
        addComment(msg.comment);
        break;
      case 'user_joined':
        addSysMsg(`👋 ${msg.nickname} katıldı`);
        if(userCount) userCount.textContent = msg.userCount + ' izleyici';
        break;
      case 'user_left':
        addSysMsg(`💤 ${msg.nickname} ayrıldı`);
        if(userCount) userCount.textContent = msg.userCount + ' izleyici';
        break;
      case 'error':
        toast('❌ ' + msg.text);
        break;
    }
  }
  function setHost(h) {
    isHost = h;
    if(hostControls) hostControls.style.display = h ? 'flex' : 'none';
    if(roleLabel) {
        roleLabel.textContent = h ? 'HOST' : 'İZLEYİCİ';
        roleLabel.style.background = h ? 'var(--accent)' : 'var(--surface2)';
        roleLabel.style.color = h ? '#0a0a0d' : 'var(--muted)';
    }
    try {
      const target = document.getElementById('videoFrame');
      if (target && target.contentWindow) {
          target.contentWindow.postMessage(JSON.stringify({ __watchparty_role: h ? 'host' : 'viewer' }), '*');
      }
    } catch(e) {}
    let badge = $('viewerBadge');
    if (!h) {
      if (!badge) {
        badge = document.createElement('div'); badge.id = 'viewerBadge';
        badge.style.cssText = 'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);background:rgba(10,10,13,0.75);color:var(--muted);font-family:var(--font-head,sans-serif);font-size:0.72rem;padding:0.3rem 0.9rem;border-radius:20px;border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(8px);z-index:1000;pointer-events:none;white-space:nowrap;';
        badge.textContent = '🔒 Video host tarafından kontrol ediliyor';
        if(videoFrame && videoFrame.parentElement) videoFrame.parentElement.appendChild(badge);
      }
      if(badge) badge.style.display = 'block';
    } else {
      if (badge) badge.style.display = 'none';
    }
  }
  if(loadBtn) loadBtn.addEventListener('click', () => {
    if (!isHost) return;
    if(!urlInput) return;
    const raw = urlInput.value.trim();
    if (!raw) return toast('Bir link gir');
    const url = raw.startsWith('http') ? raw : 'https://' + raw;
    send({ type: 'set_url', url });
    loadVideo(url);
  });
  async function loadVideo(url) {
    if (!url) return;
    if(placeholder) placeholder.classList.add('hidden');
    if(frameWarn) frameWarn.classList.add('hidden');
    if(videoFrame) {
        videoFrame.classList.remove('hidden');
        videoFrame.src = 'about:blank';
    }
    showLoadingOverlay(true);
   
    try {
      const res = await fetch('/api/resolve?url=' + encodeURIComponent(url));
      const data = await res.json();
      showLoadingOverlay(false);
      if(openExt) openExt.href = url;
      if(videoFrame) {
          videoFrame.src = data.type === 'embed' ? data.url : data.proxyUrl;
          videoFrame.onload = () => {
              try { videoFrame.contentWindow.postMessage(JSON.stringify({ __watchparty_role: isHost ? 'host' : 'viewer' }), '*'); } catch(e) {}
          };
      }
    } catch (err) {
        showLoadingOverlay(false);
        if(frameWarn) frameWarn.classList.remove('hidden');
    }
  }
  function showLoadingOverlay(show) {
    let ov = $('loadingOverlay');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'loadingOverlay';
      ov.innerHTML = `<div class="spinner"></div><span>Yükleniyor…</span>`;
      ov.style.cssText = `position:absolute;inset:0;background:rgba(10,10,13,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;color:#e8ff47;font-family:'Syne',sans-serif;font-size:0.9rem;z-index:20;backdrop-filter:blur(4px);`;
      const style = document.createElement('style'); style.textContent = `.spinner{width:36px;height:36px;border:3px solid rgba(232,255,71,0.2);border-top-color:#e8ff47;border-radius:50%;animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`;
      document.head.appendChild(style);
      const panel = document.querySelector('.video-panel');
      if (panel) panel.appendChild(ov);
    }
    ov.style.display = show ? 'flex' : 'none';
  }
  if(commentInput) commentInput.addEventListener('input', () => {
      if(sendBtn) sendBtn.classList.toggle('active', commentInput.value.trim().length > 0);
  });
  if(sendBtn) sendBtn.addEventListener('click', sendComment);
  if(commentInput) commentInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); }
  });
  function sendComment() {
    if(!commentInput) return;
    const text = commentInput.value.trim();
    if (!text) return;
    send({ type: 'comment', text });
    commentInput.value = '';
    if(sendBtn) sendBtn.classList.remove('active');
  }
  function addComment(c) {
    if (!commentList) return;
    if (commentList.children.length > 200) commentList.removeChild(commentList.firstChild);
    const div = document.createElement('div');
    div.className = 'comment-bubble' + (c.userId === myUserId ? ' own' : '');
    div.innerHTML = `<div class="comment-nick">${esc(c.nickname)}</div><div class="comment-text">${esc(c.text)}</div><div class="comment-time">${formatTime(c.ts)}</div>`;
    commentList.appendChild(div);
    commentList.scrollTop = commentList.scrollHeight;
    commentCount++;
    if(commentCnt) commentCnt.textContent = commentCount;
  }
 
  function addSysMsg(text) {
    if (!commentList) return;
    const div = document.createElement('div');
    div.className = 'sys-msg';
    div.textContent = text;
    commentList.appendChild(div);
    commentList.scrollTop = commentList.scrollHeight;
  }
  window.addEventListener('message', e => {
    if (!isHost) return;
    let data = e.data;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { return; }
    }
    if (data && data.__watchparty_event) {
        send({ type: 'video_sync', action: data.action, time: data.time || 0 });
    }
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
      lastBroadcastTime = currentTime;
      send({ type: 'video_sync', action: 'seek', time: currentTime });
    }
  }, 3000);
  function syncVideoLocal(action, time) {
    if (typeof window.triggerSyncLocal === 'function') window.triggerSyncLocal(action, time);
   
    if (action === 'play' && !isHost) {
        let unmuteBtn = document.getElementById('wp-unmute-btn');
        if (!unmuteBtn) {
            unmuteBtn = document.createElement('button');
            unmuteBtn.id = 'wp-unmute-btn';
            unmuteBtn.innerHTML = '🔊 Sesi Aç (Tıkla)';
            unmuteBtn.style.cssText = 'position:absolute; top:20px; left:50%; transform:translateX(-50%); z-index:9999; padding:12px 24px; background:var(--accent); color:#0a0a0d; border:none; border-radius:24px; font-weight:800; font-family:var(--font-head); cursor:pointer; box-shadow:0 8px 32px rgba(0,0,0,0.6); font-size:0.9rem; animation:bubbleIn 0.3s ease;';
            unmuteBtn.onclick = (e) => {
                e.stopPropagation();
                const vf = document.getElementById('videoFrame');
                if(vf && vf.contentWindow) {
                    vf.contentWindow.postMessage(JSON.stringify({ __watchparty: true, action: 'unmute' }), '*');
                }
                unmuteBtn.style.display = 'none';
                toast('🔊 Ses açıldı!');
            };
            const panel = document.querySelector('.video-panel');
            if(panel) panel.appendChild(unmuteBtn);
        } else {
            unmuteBtn.style.display = 'block';
        }
    }
  }
 
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
  const proxyAction = action === 'seek' ? 'play' : action;
  const command = JSON.stringify({ __watchparty: true, action: proxyAction, time: time || 0 });
  target.postMessage(command, '*');
  setTimeout(() => target.postMessage(command, '*'), 1000);
  setTimeout(() => target.postMessage(command, '*'), 2500);
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
      } else if (action === 'play') {
        v.play().catch(() => { v.muted = true; v.play(); });
      }
    });
  } catch (_) {}
};