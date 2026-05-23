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

// ─── /api/resolve (Aynı Kalıyor) ─────────────────────────────────────────────
// (Kodun bu kısmı doğruydu, buraya dokunmana gerek yok)

// ─── Proxy endpoint (Gelişmiş) ────────────────────────────────────────────────
app.all('/proxy', async (req, res) => {
    // ... (Proxy kodun aynı kalabilir, sadece broadcast kısmını düzeltiyoruz)
    // Eğer proxy kısmında bir değişiklik yapmadıysan oraya dokunma, sadece aşağıya odaklan.
    // ...
});

// ─── WebSocket Broadcast (DÜZELTİLDİ) ─────────────────────────────────────────
wss.on('connection', (ws) => {
  let currentRoom = null;
  let userId      = uuidv4().slice(0, 6);
  let nickname    = 'Misafir';

  ws.on('message', (raw) => {
    let msg;
    try { 
        msg = JSON.parse(raw); 
    } catch(e) { return; }

    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'join': {
        const { roomId, nick } = msg;
        if (!rooms[roomId]) rooms[roomId] = { url: '', comments: [], users: {}, hostId: null, currentTime: 0, lastAction: null };
        
        currentRoom = roomId; 
        nickname = nick || 'Misafir';
        rooms[roomId].users[userId] = ws; // WS nesnesini kaydet
        if (!rooms[roomId].hostId) rooms[roomId].hostId = userId;
        
        ws.send(JSON.stringify({ type: 'joined', userId, isHost: rooms[roomId].hostId === userId, url: rooms[roomId].url, comments: rooms[roomId].comments, currentTime: rooms[roomId].currentTime || 0, lastAction: rooms[roomId].lastAction || null }));
        broadcast(roomId, { type: 'user_joined', nickname, userCount: Object.keys(rooms[roomId].users).length });
        break;
      }
      case 'set_url': {
        if (!currentRoom || rooms[currentRoom].hostId !== userId) return;
        rooms[currentRoom].url = msg.url; 
        rooms[currentRoom].currentTime = 0; 
        rooms[currentRoom].lastAction = null;
        broadcast(currentRoom, { type: 'url_changed', url: msg.url });
        break;
      }
      case 'comment': {
        if (!currentRoom || !msg.text || !msg.text.trim()) return;
        const comment = { id: uuidv4().slice(0, 8), userId, nickname, text: msg.text.trim(), ts: Date.now() };
        rooms[currentRoom].comments.push(comment);
        if (rooms[currentRoom].comments.length > 200) rooms[currentRoom].comments.splice(0, 1);
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
    }
  });

  ws.on('close', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    delete rooms[currentRoom].users[userId];
    const remaining = Object.keys(rooms[currentRoom].users);
    broadcast(currentRoom, { type: 'user_left', nickname, userCount: remaining.length });
  });
});

// YORUMLARI VE BİLDİRİMLERİ TÜM KULLANICILARA GÖNDEREN GÜVENLİ FONKSİYON
function broadcast(roomId, msg) {
  if (!rooms[roomId]) return;
  const data = JSON.stringify(msg);
  Object.keys(rooms[roomId].users).forEach(uid => {
    const client = rooms[roomId].users[uid];
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`\n🎬 WatchParty çalışıyor → http://localhost:${PORT}\n`));