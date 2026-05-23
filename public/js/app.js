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
  
  // DOM elementlerini güvenli bir şekilde al
  function getEl(id) { return document.getElementById(id); }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; 
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  // --- TAM EKRAN DÜZELTMESİ ---
  function setupFullscreen() {
    const frame = getEl('videoFrame');
    if (!frame) return;
    
    // Çift tıklama ile tam ekran (Frame bazlı)
    frame.addEventListener('dblclick', () => toggleFS(frame));

    let fsBtn = document.getElementById('wp-fs-btn');
    if (!fsBtn) {
        fsBtn = document.createElement('button');
        fsBtn.id = 'wp-fs-btn';
        fsBtn.innerHTML = '⛶';
        fsBtn.style.cssText = 'position:absolute; bottom:12px; right:12px; z-index:9999; background:rgba(0,0,0,0.5); color:white; border:none; border-radius:8px; width:40px; height:40px; cursor:pointer;';
        frame.parentElement.appendChild(fsBtn);
        fsBtn.onclick = (e) => { e.stopPropagation(); toggleFS(frame); };
    }
  }

  function toggleFS(element) {
    if (!document.fullscreenElement) {
        element.requestFullscreen().catch(() => element.classList.add('wp-video-fullscreen'));
    } else {
        document.exitFullscreen();
        element.classList.remove('wp-video-fullscreen');
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    setupFullscreen();
    const r = new URLSearchParams(location.search).get('room');
    if (r && getEl('roomCodeInput')) { 
        getEl('roomCodeInput').value = r.toUpperCase(); 
    }
  });

  // --- WebSocket İletişimi ---
  function connectWS(id, nick) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', roomId: id, nick }));
    
    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            handleMsg(msg);
        } catch(err) { console.error("Mesaj parse hatası:", err); }
    };
  }

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function handleMsg(msg) {
    console.log("Gelen mesaj:", msg); // Hata ayıklama için
    switch (msg.type) {
      case 'joined':
        myUserId = msg.userId; 
        isHost = msg.isHost;
        getEl('lobby').classList.add('hidden');
        getEl('room').classList.remove('hidden');
        if (msg.comments) msg.comments.forEach(addComment);
        break;
      case 'new_comment': 
        addComment(msg.comment); 
        break;
      case 'user_joined': 
        addSysMsg(`👋 ${msg.nickname} katıldı`); 
        if(getEl('userCountLabel')) getEl('userCountLabel').textContent = msg.userCount + ' izleyici'; 
        break;
      case 'user_left': 
        addSysMsg(`💤 ${msg.nickname} ayrıldı`); 
        if(getEl('userCountLabel')) getEl('userCountLabel').textContent = msg.userCount + ' izleyici'; 
        break;
      case 'video_sync':
        syncVideoLocal(msg.action, msg.time);
        break;
    }
  }

  // --- Yorum İşleme ---
  function addComment(c) {
    const list = getEl('commentList');
    if (!list) return;
    const div = document.createElement('div');
    div.className = 'comment-bubble' + (c.userId === myUserId ? ' own' : '');
    div.innerHTML = `<div class="comment-nick">${esc(c.nickname)}</div><div class="comment-text">${esc(c.text)}</div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }
  
  function addSysMsg(text) {
    const list = getEl('commentList');
    if (!list) return;
    const div = document.createElement('div'); 
    div.className = 'sys-msg'; 
    div.textContent = text;
    list.appendChild(div);
  }

  function esc(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // Host/İzleyici işlemleri...
  window.enterRoom = (id, nick) => { myNick = nick; connectWS(id, nick); };
  window.sendComment = () => {
      const input = getEl('commentInput');
      if(input && input.value.trim()) {
          send({ type: 'comment', text: input.value.trim() });
          input.value = '';
      }
  };
})();