const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// In-memory room store
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── Create Room ──
  socket.on('create-room', ({ username }, cb) => {
    const roomCode = generateRoomCode();
    rooms.set(roomCode, {
      host: socket.id,
      participants: [{ id: socket.id, username }]
    });
    socket.join(roomCode);
    socket.data = { roomCode, username };
    cb({ success: true, roomCode });
    io.to(roomCode).emit('participants-updated', rooms.get(roomCode).participants);
    console.log(`[room created] ${roomCode} by ${username}`);
  });

  // ── Join Room ──
  socket.on('join-room', ({ roomCode, username }, cb) => {
    const room = rooms.get(roomCode);
    if (!room) {
      return cb({ success: false, error: 'Room not found. Check the code and try again.' });
    }
    if (room.participants.length >= 6) {
      return cb({ success: false, error: 'Room is full (max 6 participants).' });
    }
    room.participants.push({ id: socket.id, username });
    socket.join(roomCode);
    socket.data = { roomCode, username };
    cb({ success: true, roomCode });

    // Notify existing participants about the new joiner
    socket.to(roomCode).emit('user-joined', { id: socket.id, username });
    io.to(roomCode).emit('participants-updated', room.participants);
    console.log(`[join] ${username} → ${roomCode}`);
  });

  // ── WebRTC Signaling ──
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // ── Chat ──
  socket.on('chat-message', (msg) => {
    const { roomCode, username } = socket.data || {};
    if (!roomCode) return;
    io.to(roomCode).emit('chat-message', {
      username,
      text: msg,
      timestamp: Date.now()
    });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const { roomCode, username } = socket.data || {};
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.participants = room.participants.filter(p => p.id !== socket.id);
    if (room.participants.length === 0) {
      rooms.delete(roomCode);
      console.log(`[room deleted] ${roomCode}`);
    } else {
      io.to(roomCode).emit('participants-updated', room.participants);
      io.to(roomCode).emit('user-left', { id: socket.id, username });
    }
    console.log(`[disconnect] ${username} from ${roomCode}`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🎬 WatchParty running on http://localhost:${PORT}`);
});
