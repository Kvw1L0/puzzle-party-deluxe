// Puzzle Party Deluxe — Unified Application Engine
const colors = ['#2563eb', '#06b6d4', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#f97316'];
const avatars = ['🦊', '🐼', '🐸', '🦁', '🐙', '🐨', '🐯', '🐵', '🐧', '🦄', '🐝', '🐳', '🚀', '⚡', '💎', '🔥'];

const modes = {
  pattern: { title: 'Patrón de color', hint: 'Lleva cada ficha a su lugar por color.' },
  numbers: { title: 'Números en orden', hint: 'Ordena los números del 1 en adelante.' },
  memory: { title: 'Memoria visual', hint: 'Reconstruye el patrón de memoria.' },
  image: { title: 'Imagen personalizada', hint: 'Reconstruye la imagen original.' },
  brand: { title: 'Modo marca', hint: 'Revela el mensaje oculto.' }
};

const initialTarget = size => Array.from({ length: size * size }, (_, i) => i === size * size - 1 ? null : i);

let state = {
  mode: 'pattern',
  title: 'Patrón de color',
  size: 3,
  target: initialTarget(3),
  board: [],
  moves: 0,
  seconds: 0,
  running: false,
  featured: null,
  image: null,
  scores: [],
  remotePlayers: {},
  status: 'setup', // 'setup' | 'lobby' | 'playing' | 'finished'
  pin: '',
  roomOpen: false,
  startedAt: null,
  background: null,
  soundOn: false
};

let player = sessionStorage.getItem('puzzle-deluxe-id') ? (localStorage.getItem('puzzle-deluxe-player') || '') : '';
let playerIcon = localStorage.getItem('puzzle-deluxe-avatar') || avatars[0];
let playerId = sessionStorage.getItem('puzzle-deluxe-id') || `guest-${Math.random().toString(36).slice(2, 10)}`;

let tick = null;
let db = null;
let user = null;
let cloudReady = false;
let activePlayerStart = null;
let joinError = '';
let lastCelebratedPlayer = null;

// Web Audio API
let audioCtx = null;
let musicLoop = null;
let musicGain = null;
let musicStep = 0;

const $ = selector => document.querySelector(selector);
const page = () => document.body.dataset.page || 'play';
const eventRef = () => db.collection('events').doc('principal');
const playersRef = () => eventRef().collection('players');
const tileCount = () => state.size * state.size;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playSlideSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  } catch (e) {}
}

function playVictorySound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const startTime = ctx.currentTime + idx * 0.12;
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.2, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.45);
    });
  } catch (e) {}
}

function neighbours(index) {
  const n = state.size;
  const row = Math.floor(index / n);
  const col = index % n;
  return [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]
    .filter(([r, c]) => r >= 0 && r < n && c >= 0 && c < n)
    .map(([r, c]) => r * n + c);
}

// Genera un tablero garantizadamente resoluble ejecutando movimientos legales aleatorios
function shuffle() {
  const board = [...state.target];
  let empty = tileCount() - 1;
  let last = -1;
  const movesCount = Math.max(90, tileCount() * 22);
  for (let i = 0; i < movesCount; i++) {
    const choices = neighbours(empty).filter(idx => idx !== last);
    const next = choices[Math.floor(Math.random() * choices.length)];
    [board[empty], board[next]] = [board[next], board[empty]];
    last = empty;
    empty = next;
  }
  return board;
}

function format(seconds = 0) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const dec = Math.floor((seconds % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${dec}`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function joinUrl() {
  return `${location.origin}/?pin=${encodeURIComponent(state.pin || '')}`;
}

function tileStyle(value) {
  if (value === null) return '';
  if (state.mode === 'numbers') {
    return 'background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); border-color: rgba(251, 191, 36, 0.4);';
  }
  if (state.mode === 'image' && state.image) {
    const n = state.size;
    const col = value % n;
    const row = Math.floor(value / n);
    return `background-image:url("${state.image}");background-position:${n === 1 ? 0 : (col / (n - 1)) * 100}% ${n === 1 ? 0 : (row / (n - 1)) * 100}%;background-size:${n * 100}% ${n * 100}%;background-repeat:no-repeat;`;
  }
  if (state.mode === 'brand') {
    const brandColors = ['#6366f1', '#6366f1', '#8b5cf6', '#06b6d4', '#06b6d4', '#f59e0b', '#f59e0b', '#ec4899'];
    return `background: ${brandColors[value % brandColors.length]};`;
  }
  return `background: ${colors[value % colors.length]};`;
}

function tileText(value) {
  if (value === null) return '';
  if (state.mode === 'numbers') return value + 1;
  if (state.mode === 'brand') return ['P', 'U', 'Z', 'Z', 'L', 'E', '!', '★'][value % 8];
  return '';
}

function makeTile(value, interactive = false, index = null) {
  const el = document.createElement(interactive ? 'button' : 'div');
  const isEmpty = value === null;
  const isCorrect = !isEmpty && state.target && index !== null && value === state.target[index];

  el.className = `tile ${isEmpty ? 'empty' : ''} ${isCorrect ? 'is-correct' : ''}`;
  el.style.cssText = tileStyle(value);
  el.textContent = tileText(value);

  if (interactive) {
    el.disabled = isEmpty || state.status !== 'playing' || state.completed;
    el.onclick = () => move(value);
  }
  return el;
}

function featuredPlayer() {
  if (state.featured && state.remotePlayers?.[state.featured]) {
    return state.remotePlayers[state.featured];
  }
  const firstId = Object.keys(state.remotePlayers || {})[0];
  if (firstId) return state.remotePlayers[firstId];
  return { name: 'Aún sin seleccionar', avatar: '🎮', board: state.target, moves: 0, seconds: 0 };
}

function renderQr() {
  const url = joinUrl();
  const tvQr = $('#tvQrImage');
  const adminQr = $('#adminQr');
  const fallback = state.pin ? `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=8&data=${encodeURIComponent(url)}` : '';

  [tvQr, adminQr].forEach(img => {
    if (!img) return;
    if (!state.pin) { img.src = ''; return; }
    img.src = fallback;
    if (typeof QRCode !== 'undefined' && typeof QRCode.toDataURL === 'function') {
      try {
        QRCode.toDataURL(url, { margin: 2, width: 600, color: { dark: '#0b0d1e', light: '#ffffff' } }, (err, dataUrl) => {
          if (!err && dataUrl) img.src = dataUrl;
        });
      } catch (e) {}
    }
  });

  const joinLinkEl = $('#joinLink');
  if (joinLinkEl) joinLinkEl.textContent = location.host;
}

function renderBoard() {
  const boardEl = $('#puzzleBoard');
  if (boardEl) {
    boardEl.style.gridTemplateColumns = `repeat(${state.size}, 1fr)`;
    boardEl.innerHTML = '';
    state.board.forEach((val, idx) => boardEl.append(makeTile(val, true, idx)));
  }

  const targetEl = $('#targetBoard');
  if (targetEl) {
    targetEl.style.gridTemplateColumns = `repeat(${state.size}, 1fr)`;
    targetEl.innerHTML = '';
    state.target.forEach(val => {
      const item = document.createElement('div');
      item.className = `target-tile ${val === null ? 'empty' : ''}`;
      item.style.cssText = tileStyle(val);
      item.textContent = tileText(val);
      targetEl.append(item);
    });
  }

  if ($('#moves')) $('#moves').textContent = state.moves;
  if ($('#timer')) $('#timer').textContent = format(state.seconds);
  renderLive();
}

function renderLive() {
  const featured = featuredPlayer();
  const values = featured.board?.length ? featured.board : state.target;

  [$('#livePreview'), $('#screenBoard')].forEach(board => {
    if (!board) return;
    board.style.gridTemplateColumns = `repeat(${state.size}, 1fr)`;
    board.innerHTML = '';
    values.forEach((val, idx) => board.append(makeTile(val, false, idx)));
  });

  if ($('#featuredName')) $('#featuredName').textContent = featured.name || 'Sin seleccionar';
  if ($('#screenPlayer')) {
    $('#screenPlayer').innerHTML = `<span class="text-3xl">${featured.avatar || '🦊'}</span> <span>${escapeHtml(featured.name || 'Sin seleccionar')}</span>`;
  }
  if ($('#screenClock')) $('#screenClock').textContent = format(state.seconds || featured.seconds || 0);
  if ($('#screenMoves')) $('#screenMoves').textContent = featured.moves || 0;

  const correctCount = values.reduce((acc, val, idx) => acc + (val !== null && val === state.target[idx] ? 1 : 0), 0);
  const totalPlayable = tileCount() - 1;
  const pct = Math.round((correctCount / totalPlayable) * 100);

  if ($('#screenProgress')) $('#screenProgress').textContent = `${pct}%`;
  if ($('#screenProgressBar')) $('#screenProgressBar').style.width = `${pct}%`;
  if ($('#screenMode')) $('#screenMode').textContent = `${state.title} (${state.size}×${state.size})`;
  if ($('#liveGameTitle')) $('#liveGameTitle').textContent = `${state.title} (${state.size}×${state.size})`;

  renderRankings();
  renderRoomInfo();
}

function renderPlayers() {
  const entries = Object.entries(state.remotePlayers || {});

  // Actualizar Lobby en TV
  const tvGrid = $('#tvPlayersGrid');
  const tvEmpty = $('#tvEmptyMessage');
  if (tvGrid) {
    if (entries.length === 0) {
      if (tvEmpty) tvEmpty.style.display = 'block';
    } else {
      if (tvEmpty) tvEmpty.style.display = 'none';
      tvGrid.querySelectorAll('.player-chip').forEach(el => el.remove());
      entries.forEach(([id, p]) => {
        const chip = document.createElement('div');
        chip.className = 'player-chip flex items-center gap-2 bg-white/10 border border-white/20 px-3.5 py-2 rounded-2xl shadow-lg animate-pop-in backdrop-blur-md';
        chip.innerHTML = `
          <span class="text-2xl">${p.avatar || '🦊'}</span>
          <span class="font-outfit font-black text-sm text-white">${escapeHtml(p.name || 'Jugador')}</span>
          ${p.status === 'terminó' ? '<span class="text-[10px] bg-emerald-400/20 text-emerald-300 font-bold px-1.5 py-0.5 rounded-full">✓ LISTO</span>' : ''}
        `;
        tvGrid.append(chip);
      });
    }
  }

  if ($('#tvLobbyCount')) $('#tvLobbyCount').textContent = entries.length;
  if ($('#roomPlayerCount')) $('#roomPlayerCount').textContent = `${entries.length} en sala`;

  // Actualizar Admin List
  const list = $('#playerList');
  if (list) {
    const query = $('#playerSearch')?.value.toLowerCase() || '';
    list.innerHTML = '';
    const filtered = entries.filter(([, p]) => (p.name || '').toLowerCase().includes(query));
    if (filtered.length === 0) {
      list.innerHTML = '<p class="text-xs text-slate-400 italic text-center py-10">No hay participantes que coincidan.</p>';
    } else {
      filtered.forEach(([id, p]) => {
        const isSelected = id === state.featured;
        const row = document.createElement('div');
        row.className = `flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${isSelected ? 'bg-amber-400/20 border-amber-400 shadow-lg' : 'bg-white/5 border-white/10 hover:bg-white/10'}`;
        row.innerHTML = `
          <div class="flex items-center gap-3">
            <span class="text-2xl">${p.avatar || '🦊'}</span>
            <div>
              <b class="text-sm font-bold text-white block">${escapeHtml(p.name || 'Jugador')}</b>
              <span class="text-[11px] text-slate-400">${p.moves || 0} mov. · ${format(p.seconds || 0)}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${p.status === 'terminó' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-white/10 text-slate-300'}">
              ${p.status || 'conectado'}
            </span>
            <button class="text-xs px-2.5 py-1 rounded-lg ${isSelected ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-white/10 text-slate-300 hover:text-white'}">
              ${isSelected ? '★ En TV' : 'Destacar'}
            </button>
          </div>
        `;
        row.onclick = () => {
          state.featured = id;
          persist();
          renderAll();
        };
        list.append(row);
      });
    }
  }

  if ($('#playerCount')) $('#playerCount').textContent = `${entries.length} conectados`;

  const select = $('#spotlightSelect');
  if (select) {
    select.innerHTML = '<option value="">Selecciona jugador destacado</option>';
    entries.forEach(([id, p]) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${p.avatar || '🦊'} ${p.name || 'Jugador'}`;
      select.append(opt);
    });
    select.value = state.featured || '';
  }
}

function renderRankings() {
  const scores = Object.values(state.remotePlayers || {})
    .filter(p => p.status === 'terminó')
    .sort((a, b) => (a.seconds - b.seconds) || (a.moves - b.moves));

  const medalEmojis = ['🥇', '🥈', '🥉'];

  const html = scores.map((p, idx) => {
    const medal = idx < 3 ? medalEmojis[idx] : `#${idx + 1}`;
    return `
      <div class="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md shadow-sm">
        <div class="flex items-center gap-3">
          <span class="font-outfit font-black text-lg text-amber-300 w-6 text-center">${medal}</span>
          <span class="text-2xl">${p.avatar || '🦊'}</span>
          <div>
            <b class="text-sm font-bold text-white block">${escapeHtml(p.name || 'Jugador')}</b>
            <span class="text-[11px] text-slate-400">${p.moves || 0} movimientos</span>
          </div>
        </div>
        <strong class="font-mono text-base font-black text-amber-300">${format(p.seconds || 0)}</strong>
      </div>
    `;
  }).join('') || '<p class="text-xs text-slate-400 text-center py-6 italic">Aún no hay resultados en el podio.</p>';

  if ($('#leaderboard')) $('#leaderboard').innerHTML = html;
  if ($('#screenRanking')) $('#screenRanking').innerHTML = html;
}

function checkCelebration() {
  if (page() !== 'screen') return;
  const finishedPlayers = Object.entries(state.remotePlayers || {})
    .filter(([, p]) => p.status === 'terminó' && p.completed);

  if (finishedPlayers.length === 0) return;

  const [topId, topPlayer] = finishedPlayers[0];
  if (lastCelebratedPlayer !== topId) {
    lastCelebratedPlayer = topId;
    celebrateWinner(topPlayer);
  }
}

function celebrateWinner(playerData) {
  const overlay = $('#tvOverlayCompleted');
  if (!overlay) return;

  if ($('#tvWinnerAvatar')) $('#tvWinnerAvatar').textContent = playerData.avatar || '🦊';
  if ($('#tvWinnerName')) $('#tvWinnerName').textContent = playerData.name || 'JUGADOR';
  if ($('#tvWinnerTime')) $('#tvWinnerTime').textContent = format(playerData.seconds || 0);
  if ($('#tvWinnerMoves')) $('#tvWinnerMoves').textContent = playerData.moves || 0;

  overlay.classList.remove('hidden');
  overlay.classList.add('flex');

  playVictorySound();
  if (typeof confetti === 'function') {
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
    setTimeout(() => confetti({ particleCount: 80, spread: 100, origin: { y: 0.4 } }), 500);
  }

  // Ocultar después de 4.5 segundos para continuar viendo el ranking
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }, 4500);
}

function renderRoomInfo() {
  if (state.background) {
    document.body.style.backgroundImage = `url("${state.background}")`;
  }

  const pinText = state.pin || '------';
  ['#screenPin', '#adminPin', '#waitPin', '#tvLivePin'].forEach(sel => {
    if ($(sel)) $(sel).textContent = pinText;
  });

  // Switch de vistas en Pantalla TV
  const tvLobby = $('#tvViewLobby');
  const tvGame = $('#tvViewGame');
  if (tvLobby && tvGame) {
    const isPlaying = state.status === 'playing' || state.status === 'finished';
    tvLobby.classList.toggle('hidden', isPlaying);
    tvGame.classList.toggle('hidden', !isPlaying);
    tvGame.classList.toggle('flex', isPlaying);
  }

  // Switch de vistas en Jugador Móvil
  if (page() === 'play') {
    const hasJoined = !!player;
    if ($('#joinForm')) $('#joinForm').classList.toggle('hidden', hasJoined);
    if ($('#waitingRoom')) $('#waitingRoom').classList.toggle('hidden', !hasJoined || state.status !== 'lobby');
    if ($('#closedRoom')) $('#closedRoom').classList.toggle('hidden', !hasJoined || ['lobby', 'playing', 'finished'].includes(state.status));
    if ($('#gameArea')) $('#gameArea').classList.toggle('hidden', !hasJoined || state.status !== 'playing');
    if ($('#playerBadge')) {
      $('#playerBadge').classList.toggle('hidden', !hasJoined);
      $('#playerBadge').textContent = `${playerIcon} ${player}`;
    }
  }

  // Admin Controls
  const lock = $('#roomLockBtn');
  if (lock) {
    lock.textContent = state.roomOpen ? 'Cerrar Sala' : 'Abrir Sala';
    lock.classList.toggle('bg-red-500/20', state.roomOpen);
    lock.classList.toggle('text-red-300', state.roomOpen);
  }

  const startBtn = $('#startGameBtn');
  if (startBtn) {
    const count = Object.keys(state.remotePlayers || {}).length;
    startBtn.disabled = count === 0 || state.status === 'playing';
    startBtn.classList.toggle('opacity-50', startBtn.disabled);
  }

  renderQr();
  checkCelebration();
}

function renderAll() {
  renderBoard();
  renderPlayers();
  renderRankings();
  if ($('#modeSelect')) $('#modeSelect').value = state.mode;
  if ($('#roundTitle')) $('#roundTitle').value = state.title;
  if ($('#gridSize')) $('#gridSize').value = String(state.size);
  if ($('#playerName')) $('#playerName').textContent = player || 'Jugador';
  if ($('#playerAvatar')) $('#playerAvatar').textContent = playerIcon;
  if ($('#joinError')) {
    $('#joinError').textContent = joinError;
    $('#joinError').classList.toggle('hidden', !joinError);
  }
  renderRoomInfo();
}

function timer() {
  if (state.status !== 'playing' || state.completed) return;
  const startedAt = (page() === 'play' ? state.remotePlayers?.[playerId]?.startedAt : null) || state.startedAt || Date.now();
  if (state.running && activePlayerStart === startedAt) return;
  state.running = true;
  activePlayerStart = startedAt;
  clearInterval(tick);

  tick = setInterval(() => {
    if (state.status !== 'playing' || state.completed) {
      clearInterval(tick);
      state.running = false;
      return;
    }
    state.seconds = Math.max(0, (Date.now() - startedAt) / 1000);
    if (page() === 'play') {
      if ($('#timer')) $('#timer').textContent = format(state.seconds);
      if (state.seconds % 1 < 0.25) persist();
    } else {
      if ($('#screenClock')) $('#screenClock').textContent = format(state.seconds);
    }
  }, 100);
}

function move(value) {
  if (state.status !== 'playing' || state.completed) return;
  const from = state.board.indexOf(value);
  const empty = state.board.indexOf(null);
  if (!neighbours(empty).includes(from)) return;

  [state.board[from], state.board[empty]] = [state.board[empty], state.board[from]];
  state.moves++;

  playSlideSound();
  if (navigator.vibrate) navigator.vibrate(12);

  persist();
  renderBoard();

  const isComplete = state.board.every((p, idx) => p === state.target[idx]);
  if (isComplete) complete();
}

function resetPlayer() {
  clearInterval(tick);
  activePlayerStart = null;
  state.board = shuffle();
  state.moves = 0;
  state.seconds = 0;
  state.running = false;
  state.completed = false;
  if (state.status === 'playing') {
    state.remotePlayers[playerId] = {
      ...(state.remotePlayers[playerId] || {}),
      startedAt: Date.now(),
      status: 'jugando'
    };
  }
  persist();
  renderAll();
  if (state.status === 'playing') timer();
}

function complete() {
  state.running = false;
  state.completed = true;
  clearInterval(tick);
  persist();

  playVictorySound();
  if (typeof confetti === 'function') {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  }

  if ($('#resultTime')) $('#resultTime').textContent = format(state.seconds);
  if ($('#resultMoves')) $('#resultMoves').textContent = state.moves;
  if ($('#modal')) $('#modal').classList.remove('hidden');
}

function persist() {
  try {
    localStorage.setItem('puzzle-party-state', JSON.stringify(state));
  } catch (e) {}

  if (!cloudReady || !user) return;

  if (page() === 'play' && player && state.pin) {
    const status = state.completed ? 'terminó' : state.status === 'lobby' ? 'esperando' : state.status === 'playing' ? 'jugando' : 'conectado';
    playersRef().doc(playerId).set({
      name: player,
      avatar: playerIcon,
      board: state.board,
      moves: state.moves,
      seconds: state.seconds,
      startedAt: state.remotePlayers?.[playerId]?.startedAt || state.startedAt || null,
      running: state.running,
      completed: !!state.completed,
      status,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
  } else if (page() === 'admin') {
    eventRef().set({
      mode: state.mode,
      title: state.title,
      size: state.size,
      target: state.target,
      image: state.image,
      featured: state.featured,
      status: state.status,
      pin: state.pin,
      roomOpen: state.roomOpen,
      startedAt: state.startedAt,
      background: state.background,
      soundOn: state.soundOn
    }, { merge: true }).catch(err => console.warn('Sync error:', err.message));
  }
}

function applyConfiguration() {
  state.mode = $('#modeSelect')?.value || state.mode;
  state.title = $('#roundTitle')?.value.trim() || modes[state.mode].title;
  state.size = Number($('#gridSize')?.value) === 4 ? 4 : 3;
  state.target = initialTarget(state.size);
  state.board = [...state.target];
  state.status = 'setup';
  state.roomOpen = false;
  state.featured = null;
  state.startedAt = null;
  state.completed = false;
  state.running = false;
  persist();
  renderAll();
  alert('Configuración guardada.');
}

function newRoom() {
  state.pin = String(Math.floor(100000 + Math.random() * 900000));
  state.roomOpen = true;
  state.status = 'lobby';
  state.featured = null;
  state.startedAt = null;
  state.completed = false;
  state.running = false;
  state.board = shuffle();
  lastCelebratedPlayer = null;

  if (cloudReady) {
    playersRef().get().then(snapshot => {
      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    }).then(() => {
      state.remotePlayers = {};
      persist();
      renderAll();
    }).catch(() => {
      state.remotePlayers = {};
      persist();
      renderAll();
    });
  } else {
    state.remotePlayers = {};
    persist();
    renderAll();
  }
}

function startGame() {
  const entries = Object.entries(state.remotePlayers || {});
  if (!entries.length) {
    alert('Necesitas al menos un participante en la sala para iniciar.');
    return;
  }
  state.roomOpen = false;
  state.status = 'playing';
  state.startedAt = Date.now();
  state.seconds = 0;
  state.completed = false;
  state.running = false;
  state.featured = state.featured || entries[0][0];

  if (cloudReady) {
    entries.forEach(([id, p]) => {
      playersRef().doc(id).set({
        ...p,
        board: shuffle(),
        moves: 0,
        seconds: 0,
        status: 'jugando',
        completed: false,
        startedAt: state.startedAt
      }, { merge: true });
    });
  }
  persist();
  renderAll();
  timer();
}

function restartForEveryone() {
  if (!confirm('¿Reiniciar el puzzle para todos? Los tiempos y movimientos volverán a cero.')) return;
  state.status = 'playing';
  state.roomOpen = false;
  state.startedAt = Date.now();
  state.seconds = 0;
  state.completed = false;
  state.running = false;
  lastCelebratedPlayer = null;

  const entries = Object.entries(state.remotePlayers || {});
  entries.forEach(([id, p]) => {
    const updated = {
      ...p,
      board: shuffle(),
      moves: 0,
      seconds: 0,
      status: 'jugando',
      completed: false,
      startedAt: state.startedAt
    };
    state.remotePlayers[id] = updated;
    if (cloudReady) playersRef().doc(id).set(updated, { merge: true });
  });
  persist();
  renderAll();
}

function optimizeImage(file, callback) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob || blob.size > 300 * 1024) {
        callback(null, 'La imagen supera los 300 KB permitidos. Usa una imagen más liviana.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => callback(reader.result);
      reader.readAsDataURL(blob);
    }, 'image/webp', 0.8);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    callback(null, 'No se pudo leer la imagen.');
  };
  img.src = url;
}

function joinRoom() {
  const pin = $('#pinInput')?.value.trim();
  const name = $('#nameInput')?.value.trim();

  if (!pin || pin !== state.pin || !state.roomOpen || state.status !== 'lobby') {
    joinError = 'No encontramos una sala abierta con ese PIN. Revisa la pantalla grande.';
    renderAll();
    return;
  }
  if (!name) {
    joinError = 'Por favor escribe tu apodo para entrar.';
    renderAll();
    return;
  }

  player = name.slice(0, 20);
  playerIcon = $('#avatarInput')?.value || avatars[0];
  localStorage.setItem('puzzle-deluxe-player', player);
  localStorage.setItem('puzzle-deluxe-avatar', playerIcon);
  sessionStorage.setItem('puzzle-deluxe-id', playerId);

  joinError = '';
  state.board = [...state.target];
  state.moves = 0;
  state.seconds = 0;
  state.completed = false;

  persist();
  renderAll();
}

function buildAvatarGrid() {
  const grid = $('#avatarGrid');
  if (!grid) return;
  grid.innerHTML = '';
  avatars.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isSelected = emoji === playerIcon;
    btn.className = `avatar-choice w-12 h-12 rounded-2xl flex items-center justify-center text-2xl transition-all duration-150 border-2 ${
      isSelected
        ? 'border-amber-400 bg-amber-400/20 shadow-lg glow-gold scale-105'
        : 'border-white/15 bg-white/10 hover:bg-white/20'
    }`;
    btn.textContent = emoji;
    btn.onclick = () => {
      playerIcon = emoji;
      if ($('#avatarInput')) $('#avatarInput').value = emoji;
      buildAvatarGrid();
    };
    grid.append(btn);
  });
}

function connectFirebase() {
  const config = window.PUZZLE_FIREBASE_CONFIG;
  if (!window.firebase || !config) return;

  try {
    if (!firebase.apps.length) firebase.initializeApp(config);
    db = firebase.firestore();

    firebase.auth().onAuthStateChanged(currentUser => {
      user = currentUser;
      if (!currentUser) {
        firebase.auth().signInAnonymously().catch(() => {});
        return;
      }

      if (page() === 'play' && playerId !== currentUser.uid) {
        playerId = currentUser.uid;
        sessionStorage.setItem('puzzle-deluxe-id', playerId);
      }

      cloudReady = true;

      // Escuchar cambios en la sala
      eventRef().onSnapshot(snap => {
        if (!snap.exists) return;
        state = { ...state, ...snap.data() };
        if (page() === 'play' && player) {
          if (state.status === 'lobby' && state.roomOpen) persist();
          if (state.status === 'playing' && state.startedAt && !state.completed) timer();
          else if (state.status !== 'playing') {
            clearInterval(tick);
            state.running = false;
          }
        }
        renderAll();
      });

      // Escuchar jugadores
      playersRef().onSnapshot(snap => {
        state.remotePlayers = {};
        snap.forEach(doc => { state.remotePlayers[doc.id] = doc.data(); });

        if (page() === 'play' && player) {
          const mine = state.remotePlayers[playerId];
          if (mine) {
            if (mine.board?.length) state.board = mine.board;
            if (Number.isFinite(mine.moves)) state.moves = mine.moves;
            if (Number.isFinite(mine.seconds)) state.seconds = mine.seconds;
            state.completed = !!mine.completed;
            if (mine.status === 'jugando') timer();
            if (mine.status === 'terminó') {
              state.running = false;
              clearInterval(tick);
            }
          }
        }
        renderAll();
      });
    });
  } catch (e) {
    console.warn('Firebase init:', e.message);
  }
}

function bindEvents() {
  if (page() === 'play') {
    $('#joinFormInner')?.addEventListener('submit', e => {
      e.preventDefault();
      joinRoom();
    });

    buildAvatarGrid();

    $('#restartBtn')?.addEventListener('click', resetPlayer);
    $('#hintBtn')?.addEventListener('click', () => {
      const modal = $('#targetModal');
      if (modal) modal.classList.toggle('hidden');
    });
    $('#closeTargetBtn')?.addEventListener('click', () => {
      $('#targetModal')?.classList.add('hidden');
    });
    $('#playAgainBtn')?.addEventListener('click', () => {
      $('#modal')?.classList.add('hidden');
    });
  }

  if (page() === 'admin') {
    $('#playerSearch')?.addEventListener('input', renderPlayers);
    $('#newRoundBtn')?.addEventListener('click', newRoom);
    $('#applyRoundBtn')?.addEventListener('click', applyConfiguration);
    $('#roomLockBtn')?.addEventListener('click', () => {
      state.roomOpen = !state.roomOpen;
      if (state.roomOpen) state.status = 'lobby';
      persist();
      renderAll();
    });
    $('#startGameBtn')?.addEventListener('click', startGame);
    $('#globalRestartBtn')?.addEventListener('click', restartForEveryone);

    $('#copyLinkBtn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(joinUrl());
        alert('Enlace copiado al portapapeles.');
      } catch (e) {
        prompt('Copia el enlace de acceso:', joinUrl());
      }
    });

    $('#spotlightSelect')?.addEventListener('change', e => {
      state.featured = e.target.value || null;
      persist();
      renderAll();
    });

    $('#featureBtn')?.addEventListener('click', () => renderAll());

    $('#imageUpload')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) {
        optimizeImage(file, (data, err) => {
          if (err) { alert(err); return; }
          state.image = data;
          state.mode = 'image';
          if ($('#modeSelect')) $('#modeSelect').value = 'image';
          if ($('#uploadText')) $('#uploadText').textContent = file.name;
          persist();
          renderAll();
        });
      }
    });

    $('#backgroundUpload')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) {
        optimizeImage(file, (data, err) => {
          if (err) { alert(err); return; }
          state.background = data;
          if ($('#backgroundName')) $('#backgroundName').textContent = file.name;
          persist();
          renderAll();
        });
      }
    });

    $('#removeBackgroundBtn')?.addEventListener('click', () => {
      state.background = null;
      if ($('#backgroundName')) $('#backgroundName').textContent = 'Sin fondo';
      persist();
      renderRoomInfo();
    });

    $('#resetScoresBtn')?.addEventListener('click', () => {
      if (confirm('¿Reiniciar la clasificación?')) {
        state.scores = [];
        persist();
        renderAll();
      }
    });
  }

  // Auto-fill PIN si viene en URL
  const urlParams = new URLSearchParams(location.search);
  const pinFromUrl = urlParams.get('pin') || urlParams.get('room');
  if (pinFromUrl && $('#pinInput')) {
    $('#pinInput').value = pinFromUrl;
    setTimeout(() => $('#nameInput')?.focus(), 200);
  }
}

function init() {
  try {
    const saved = localStorage.getItem('puzzle-party-state');
    if (saved) state = { ...state, ...JSON.parse(saved) };
  } catch (e) {}

  state.size = state.size === 4 ? 4 : 3;
  if (!Array.isArray(state.target) || state.target.length !== tileCount()) {
    state.target = initialTarget(state.size);
  }
  if (!Array.isArray(state.board) || state.board.length !== tileCount()) {
    state.board = [...state.target];
  }

  renderAll();
  connectFirebase();
  bindEvents();
}

init();
