const socket = io();

let currentRoomCode = null;
let mySocketId = null;
let gameState = null;

const joinScreen = document.getElementById('joinScreen');
const gameScreen = document.getElementById('gameScreen');
const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCode');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const errorMessage = document.getElementById('errorMessage');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const roundDisplay = document.getElementById('roundDisplay');
const potDisplay = document.getElementById('potDisplay');
const lastRollDisplay = document.getElementById('lastRollDisplay');
const currentPlayerDisplay = document.getElementById('currentPlayerDisplay');
const startGameBtn = document.getElementById('startGameBtn');
const rollBtn = document.getElementById('rollBtn');
const bankBtn = document.getElementById('bankBtn');
const restartBtn = document.getElementById('restartBtn');
const playersList = document.getElementById('playersList');
const bustNotification = document.getElementById('bustNotification');
const diceContainer = document.getElementById('diceContainer');
const dice1 = document.getElementById('dice1');
const dice2 = document.getElementById('dice2');

const spinWheelSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3');
const bustSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2573/2573-preview.mp3');
const buttonClickSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3');
const bankSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2067/2067-preview.mp3');

let lastShakeTime = 0;
let shakeThreshold = 15;
let shakeTimeout = 1000;

createRoomBtn.addEventListener('click', () => {
  buttonClickSound.currentTime = 0;
  buttonClickSound.play().catch(e => console.log('Audio play failed:', e));
  const name = playerNameInput.value.trim();
  if (!name) {
    showError('Please enter your name');
    return;
  }
  socket.emit('createRoom', { name });
});

joinRoomBtn.addEventListener('click', () => {
  buttonClickSound.currentTime = 0;
  buttonClickSound.play().catch(e => console.log('Audio play failed:', e));
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();

  if (!name) {
    showError('Please enter your name');
    return;
  }

  if (!code || code.length !== 4) {
    showError('Please enter a valid 4-letter room code');
    return;
  }

  socket.emit('joinRoom', { roomCode: code, name });
});

startGameBtn.addEventListener('click', () => {
  buttonClickSound.currentTime = 0;
  buttonClickSound.play().catch(e => console.log('Audio play failed:', e));
  socket.emit('startGame', { roomCode: currentRoomCode });
});

rollBtn.addEventListener('click', () => {
  socket.emit('rollDice', { roomCode: currentRoomCode });
});

bankBtn.addEventListener('click', () => {
  bankSound.currentTime = 0;
  bankSound.play().catch(e => console.log('Audio play failed:', e));
  socket.emit('bankNow', { roomCode: currentRoomCode });
});

restartBtn.addEventListener('click', () => {
  buttonClickSound.currentTime = 0;
  buttonClickSound.play().catch(e => console.log('Audio play failed:', e));
  socket.emit('restartGame', { roomCode: currentRoomCode });
});

socket.on('connect', () => {
  mySocketId = socket.id;
});

socket.on('roomJoined', ({ roomCode, state }) => {
  currentRoomCode = roomCode;
  gameState = state;
  joinScreen.classList.remove('active');
  gameScreen.classList.add('active');
  updateUI();
});

socket.on('gameState', (state) => {
  gameState = state;
  updateUI();
});

socket.on('diceRolled', ({ d1, d2, sum }) => {
  animateDiceRoll(d1, d2, sum);
});

socket.on('bust', ({ message }) => {
  bustSound.currentTime = 0;
  bustSound.play().catch(e => console.log('Audio play failed:', e));
  showBustNotification();
});

socket.on('lucky7', ({ message }) => {
  bankSound.currentTime = 0;
  bankSound.play().catch(e => console.log('Audio play failed:', e));
  showNotification(message, 'lucky');
});

socket.on('doubles', ({ message }) => {
  bankSound.currentTime = 0;
  bankSound.play().catch(e => console.log('Audio play failed:', e));
  showNotification(message, 'lucky');
});

socket.on('error', ({ message }) => {
  showError(message);
});

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  setTimeout(() => {
    errorMessage.style.display = 'none';
  }, 3000);
}

function updateUI() {
  if (!gameState) return;

  roomCodeDisplay.textContent = gameState.roomCode;
  roundDisplay.textContent = gameState.round;
  potDisplay.textContent = gameState.pot;

  if (diceContainer) {
    diceContainer.style.display = 'none';
  }

  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  if (currentPlayer) {
    const isMyTurn = currentPlayer.id === mySocketId;
    currentPlayerDisplay.textContent = isMyTurn ? "Your turn!" : `${currentPlayer.name}'s turn`;
    currentPlayerDisplay.className = isMyTurn ? 'current-player-name my-turn' : 'current-player-name';
  }

  const isFirstPlayer = gameState.players[0]?.id === mySocketId;
  const gameNotStarted = !gameState.started;
  startGameBtn.style.display = (isFirstPlayer && gameNotStarted) ? 'block' : 'none';
  restartBtn.style.display = (isFirstPlayer && gameState.started) ? 'block' : 'none';

  const myPlayer = gameState.players.find(p => p.id === mySocketId);
  const isMyTurn = currentPlayer?.id === mySocketId;
  const canRoll = isMyTurn && gameState.started && !myPlayer?.hasBanked;
  const canBank = isMyTurn && myPlayer && !myPlayer.hasBanked && gameState.started && gameState.pot > 0;

  rollBtn.disabled = !canRoll;
  bankBtn.disabled = !canBank;

  renderPlayers();
}

function renderPlayers() {
  if (!gameState) return;

  playersList.innerHTML = gameState.players.map((player, index) => {
    const isCurrentPlayer = index === gameState.currentPlayerIndex;
    const isMe = player.id === mySocketId;
    const bankedText = player.hasBanked ? 'Banked' : '–';

    return `
      <div class="player-row ${isCurrentPlayer ? 'current' : ''} ${isMe ? 'me' : ''}">
        <div class="player-info">
          <span class="player-name">${player.name}${isMe ? ' (You)' : ''}</span>
          ${isCurrentPlayer && gameState.started ? '<span class="turn-indicator">⬅</span>' : ''}
        </div>
        <div class="player-stats">
          <span class="player-score">${player.score}</span>
          <span class="player-banked ${player.hasBanked ? 'banked' : ''}">${bankedText}</span>
        </div>
      </div>
    `;
  }).join('');
}

function animateDiceRoll(d1, d2, sum) {
  console.log('🎲 animateDiceRoll called:', { d1, d2, sum });

  if (!diceContainer || !dice1 || !dice2) {
    console.error('❌ Dice elements not found!');
    showDiceResult(d1, d2, sum);
    return;
  }

  console.log('✅ Starting dice animation...');

  lastRollDisplay.style.display = 'none';
  diceContainer.style.display = 'flex';

  dice1.src = 'https://i.imgur.com/Z8qGC4w.gif';
  dice2.src = 'https://i.imgur.com/Z8qGC4w.gif';

  spinWheelSound.currentTime = 0;
  spinWheelSound.volume = 0.5;
  spinWheelSound.loop = true;
  const playPromise = spinWheelSound.play();
  if (playPromise) {
    playPromise.catch(e => console.log('🔇 Audio play failed:', e));
  }

  setTimeout(() => {
    console.log('🛑 Stopping sound and showing result');
    spinWheelSound.pause();
    spinWheelSound.currentTime = 0;
    spinWheelSound.loop = false;

    diceContainer.style.display = 'none';
    lastRollDisplay.style.display = 'flex';
    showDiceResult(d1, d2, sum);
  }, 1500);
}

function showDiceResult(d1, d2, sum) {
  lastRollDisplay.innerHTML = `
    <div class="dice-result">
      <span class="dice-number">${d1}</span>
      <span class="dice-plus">+</span>
      <span class="dice-number">${d2}</span>
      <span class="dice-equals">=</span>
      <span class="dice-sum ${sum === 7 ? 'bust-sum' : ''}">${sum}</span>
    </div>
  `;
}

function showBustNotification() {
  bustNotification.classList.add('show');

  setTimeout(() => {
    bustNotification.classList.remove('show');
  }, 2000);
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => notification.classList.add('show'), 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 2500);
}

function handleShake(event) {
  const current = new Date().getTime();

  if (current - lastShakeTime < shakeTimeout) {
    return;
  }

  const acceleration = event.accelerationIncludingGravity;
  if (!acceleration) return;

  const x = Math.abs(acceleration.x || 0);
  const y = Math.abs(acceleration.y || 0);
  const z = Math.abs(acceleration.z || 0);

  if (x > shakeThreshold || y > shakeThreshold || z > shakeThreshold) {
    lastShakeTime = current;

    if (rollBtn && !rollBtn.disabled && rollBtn.offsetParent !== null) {
      console.log('📱 Shake detected! Rolling dice...');
      rollBtn.click();
    }
  }
}

function requestMotionPermission() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(permissionState => {
        if (permissionState === 'granted') {
          window.addEventListener('devicemotion', handleShake);
          console.log('✅ Motion permission granted');
        }
      })
      .catch(console.error);
  } else {
    window.addEventListener('devicemotion', handleShake);
    console.log('✅ Motion listener added');
  }
}

if (gameScreen) {
  gameScreen.addEventListener('click', () => {
    requestMotionPermission();
  }, { once: true });
}
