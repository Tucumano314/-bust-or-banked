const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms[code]);
  return code;
}

function createRoom(roomCode, socketId, playerName) {
  rooms[roomCode] = {
    players: [{ id: socketId, name: playerName, score: 0, hasBanked: false }],
    pot: 0,
    round: 1,
    currentPlayerIndex: 0,
    started: false,
    lastRoll: null,
    rollCount: 0
  };
}

function getGameState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return null;

  return {
    roomCode,
    pot: room.pot,
    round: room.round,
    currentPlayerIndex: room.currentPlayerIndex,
    started: room.started,
    lastRoll: room.lastRoll,
    rollCount: room.rollCount,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      hasBanked: p.hasBanked
    }))
  };
}

function startNewRound(room) {
  room.round++;
  room.pot = 0;
  room.lastRoll = null;
  room.rollCount = 0;
  room.players.forEach(p => p.hasBanked = false);
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
}

function moveToNextPlayer(room) {
  let attempts = 0;
  const maxAttempts = room.players.length;

  do {
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    attempts++;
  } while (room.players[room.currentPlayerIndex].hasBanked && attempts < maxAttempts);

  const allBanked = room.players.every(p => p.hasBanked);
  if (allBanked) {
    startNewRound(room);
    return true;
  }
  return false;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', ({ name }) => {
    const roomCode = generateRoomCode();
    createRoom(roomCode, socket.id, name);
    socket.join(roomCode);
    socket.roomCode = roomCode;

    const state = getGameState(roomCode);
    socket.emit('roomJoined', { roomCode, state });
  });

  socket.on('joinRoom', ({ roomCode, name }) => {
    const normalizedCode = roomCode.toUpperCase();
    const room = rooms[normalizedCode];

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.players.length >= 8) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    room.players.push({
      id: socket.id,
      name,
      score: 0,
      hasBanked: false
    });

    socket.join(normalizedCode);
    socket.roomCode = normalizedCode;

    const state = getGameState(normalizedCode);
    socket.emit('roomJoined', { roomCode: normalizedCode, state });
    io.to(normalizedCode).emit('gameState', state);
  });

  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.started = true;
    room.round = 1;
    room.pot = 0;
    room.currentPlayerIndex = 0;
    room.lastRoll = null;
    room.rollCount = 0;
    room.players.forEach(p => {
      p.score = 0;
      p.hasBanked = false;
    });

    io.to(roomCode).emit('gameState', getGameState(roomCode));
  });

  socket.on('rollDice', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || !room.started) return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) {
      socket.emit('error', { message: 'Not your turn' });
      return;
    }

    if (currentPlayer.hasBanked) {
      socket.emit('error', { message: 'You have already banked this round' });
      return;
    }

    room.rollCount++;

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum = d1 + d2;

    room.lastRoll = { d1, d2, sum };

    io.to(roomCode).emit('diceRolled', { d1, d2, sum });

    let roundEnded = false;

    if (sum === 7) {
      if (room.rollCount <= 3) {
        room.pot += 70;
        io.to(roomCode).emit('lucky7', { message: 'LUCKY 7! +70 to pot!' });
      } else {
        room.pot = 0;
        startNewRound(room);
        io.to(roomCode).emit('bust', { message: 'BUST! Pot reset to 0' });
        roundEnded = true;
      }
    } else {
      if (room.rollCount > 3 && d1 === d2) {
        room.pot *= 2;
        io.to(roomCode).emit('doubles', { message: 'DOUBLES! Pot doubled!' });
      } else {
        room.pot += sum;
      }
    }

    if (!roundEnded) {
      moveToNextPlayer(room);
    }

    io.to(roomCode).emit('gameState', getGameState(roomCode));
  });

  socket.on('bankNow', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || !room.started) return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) {
      socket.emit('error', { message: 'Not your turn' });
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.hasBanked) return;

    player.score += room.pot;
    player.hasBanked = true;

    moveToNextPlayer(room);

    io.to(roomCode).emit('gameState', getGameState(roomCode));
  });

  socket.on('restartGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const firstPlayer = room.players[0];
    if (firstPlayer.id !== socket.id) {
      socket.emit('error', { message: 'Only the first player can restart' });
      return;
    }

    room.round = 1;
    room.pot = 0;
    room.currentPlayerIndex = 0;
    room.lastRoll = null;
    room.rollCount = 0;
    room.players.forEach(p => {
      p.score = 0;
      p.hasBanked = false;
    });

    io.to(roomCode).emit('gameState', getGameState(roomCode));
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    const roomCode = socket.roomCode;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);

        if (room.players.length === 0) {
          delete rooms[roomCode];
        } else {
          if (room.currentPlayerIndex >= room.players.length) {
            room.currentPlayerIndex = 0;
          }
          io.to(roomCode).emit('gameState', getGameState(roomCode));
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
