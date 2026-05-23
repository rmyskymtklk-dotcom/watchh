(function () {
  'use strict';
  let ws = null, isHost = false, roomId = null;
  const $ = id => document.getElementById(id);

  function connectWS(id, nick) {
    ws = new WebSocket(`ws://${location.host}`);
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'joined') {
            isHost = msg.isHost;
            $('lobby').classList.add('hidden');
            $('room').classList.remove('hidden');
        } else if (msg.type === 'new_comment') {
            addComment(msg.comment);
        } else if (msg.type === 'user_joined') {
            addSysMsg(msg.nickname + ' katıldı');
        }
    };
  }

  function addComment(c) {
    const list = $('commentList');
    if(!list) return;
    const div = document.createElement('div');
    div.className = 'comment-bubble';
    div.innerHTML = `<div class="comment-nick">${c.nickname}</div><div class="comment-text">${c.text}</div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  function addSysMsg(text) {
    const list = $('commentList');
    if(!list) return;
    const div = document.createElement('div');
    div.className = 'sys-msg';
    div.textContent = text;
    list.appendChild(div);
  }

  window.addEventListener('DOMContentLoaded', () => {
    const frame = $('videoFrame');
    // Tam Ekran Butonu
    const btn = document.createElement('button');
    btn.innerHTML = '⛶';
    btn.style.cssText = 'position:absolute; bottom:10px; right:10px; z-index:9999;';
    btn.onclick = () => {
        if (!document.fullscreenElement) frame.requestFullscreen();
        else document.exitFullscreen();
    };
    frame.parentElement.appendChild(btn);
  });

  window.enterRoom = (id, nick) => connectWS(id, nick);
  window.sendComment = () => {
      const input = $('commentInput');
      if(input && input.value.trim()) {
          ws.send(JSON.stringify({ type: 'comment', nick: $('nickInput').value, text: input.value }));
          input.value = '';
      }
  };
})();