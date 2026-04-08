// ─── State ────────────────────────────────────────────────────────────────────
let socket;
let currentUser;
let currentMatchId;
let myTeam = 1;
let searchSecs = 0;
let searchInterval;
let acceptSecs = 30;
let acceptInterval;
let matchSecs = 0;
let matchInterval;
let readySet = new Set();
let allPlayers = [];
let remainingMaps = [];
let bannedMaps = [];
let currentVetoTeam = 1;
let isMyTurn = false;

const MAPS_BG = {
  'Mirage':   'map-mirage',
  'Inferno':  'map-inferno',
  'Dust II':  'map-dust2',
  'Nuke':     'map-nuke',
  'Overpass': 'map-overpass',
  'Ancient':  'map-ancient',
  'Anubis':   'map-anubis',
};

// ─── Show State ───────────────────────────────────────────────────────────────
function showState(id) {
  ['idle','searching','found','veto','active','ended'].forEach(s => {
    const el = document.getElementById('state-' + s);
    if (el) el.classList.add('hidden');
  });
  const el = document.getElementById('state-' + id);
  if (el) el.classList.remove('hidden');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  currentUser = await requireSetup();
  if (!currentUser) return;

  renderNavUser(currentUser);
  showState('idle');

  document.getElementById('idle-username').textContent = currentUser.username;
  document.getElementById('idle-elo').textContent = currentUser.elo + ' ELO';
  document.getElementById('idle-level').innerHTML = renderLevelBadge(currentUser.elo, 'sm');
  document.getElementById('idle-cheat').innerHTML = renderCheatBadge(currentUser.cheat);

  socket = io();

  socket.on('connect', () => console.log('Socket connected'));

  socket.on('queue_joined', (data) => {
    showState('searching');
    startSearchTimer();
  });

  socket.on('queue_left', () => {
    stopSearchTimer();
    showState('idle');
  });

  socket.on('match_found', (data) => {
    stopSearchTimer();
    currentMatchId = data.matchId;
    allPlayers = data.players;
    myTeam = data.players.find(p => p.username === currentUser.username)?.team || 1;
    showMatchFound(data.players);
  });

  socket.on('ready_update', (data) => {
    readySet = new Set(data.readyPlayers);
    updateReadyDots();
    document.getElementById('found-ready-count').textContent =
      `${data.readyCount}/${data.total} готовы`;
  });

  socket.on('veto_start', (data) => {
    clearInterval(acceptInterval);
    remainingMaps = [...data.maps];
    bannedMaps = [];
    currentVetoTeam = data.currentTeam;
    showState('veto');
    renderVeto();
  });

  socket.on('map_banned', (data) => {
    remainingMaps = data.remainingMaps;
    bannedMaps = data.bannedMaps;
    currentVetoTeam = data.currentTeam;
    updateVetoMaps();
    updateVetoTurn();
  });

  socket.on('match_start', (data) => {
    clearInterval(acceptInterval);
    showMatchActive(data);
  });

  socket.on('match_end', (data) => {
    clearInterval(matchInterval);
    showMatchEnd(data);
  });

  socket.on('already_in_match', (data) => {
    currentMatchId = data.matchId;
  });
}

// ─── Search Timer ─────────────────────────────────────────────────────────────
function startSearchTimer() {
  searchSecs = 0;
  clearInterval(searchInterval);
  searchInterval = setInterval(() => {
    searchSecs++;
    document.getElementById('search-timer').textContent = formatTime(searchSecs);
    // Fake queue size
    const fake = Math.floor(Math.random() * 50) + 80;
    document.getElementById('search-queue-size').textContent = `~${fake} игроков в очереди`;
  }, 1000);
}

function stopSearchTimer() {
  clearInterval(searchInterval);
}

// ─── Start Search ─────────────────────────────────────────────────────────────
function startSearch() {
  socket.emit('join_queue', {
    userId: currentUser.id,
    username: currentUser.username,
    elo: currentUser.elo,
    cheat: currentUser.cheat
  });
}

function cancelSearch() {
  socket.emit('leave_queue', { userId: currentUser.id });
}

// ─── Match Found ──────────────────────────────────────────────────────────────
function showMatchFound(players) {
  readySet = new Set();
  acceptSecs = 30;

  const team1 = players.filter(p => p.team === 1);
  const team2 = players.filter(p => p.team === 2);

  document.getElementById('found-team1').innerHTML = renderPlayerList(team1, 'left');
  document.getElementById('found-team2').innerHTML = renderPlayerList(team2, 'right');
  document.getElementById('found-countdown').textContent = acceptSecs;
  document.getElementById('found-ready-count').textContent = `0/${players.length} готовы`;

  const acceptBtn = document.getElementById('accept-btn');
  acceptBtn.disabled = false;
  acceptBtn.textContent = 'ПРИНЯТЬ';
  acceptBtn.className = 'btn btn-green btn-lg';

  showState('found');

  clearInterval(acceptInterval);
  acceptInterval = setInterval(() => {
    acceptSecs--;
    document.getElementById('found-countdown').textContent = acceptSecs;
    if (acceptSecs <= 0) {
      clearInterval(acceptInterval);
      socket.emit('leave_queue', { userId: currentUser.id });
      showState('idle');
    }
  }, 1000);
}

function renderPlayerList(players, side) {
  return players.map(p => {
    const isMe = p.username === currentUser.username;
    const color = getUserColor(p.username);
    const initial = p.username.charAt(0).toUpperCase();
    const lv = renderSmallLevel(p.elo);
    const row = side === 'right' ? 'flex-direction:row-reverse' : '';
    return `<div class="player-row" data-username="${p.username}" style="${row}">
      <div class="avatar avatar-sm" style="background:${color}">${initial}</div>
      ${lv}
      <div class="player-row-info">
        <div class="player-row-name" style="${isMe ? 'color:var(--accent)' : ''}">${p.username}${isMe ? ' (Вы)' : ''}</div>
        <div class="player-row-cheat" style="color:${getCheatColor(p.cheat)}">${p.cheat}</div>
      </div>
      <div class="player-ready-dot" id="dot-${p.username.replace(/[^a-zA-Z0-9]/g,'_')}"></div>
    </div>`;
  }).join('');
}

function updateReadyDots() {
  allPlayers.forEach(p => {
    const id = 'dot-' + p.username.replace(/[^a-zA-Z0-9]/g,'_');
    const dot = document.getElementById(id);
    if (dot) dot.classList.toggle('ready', readySet.has(p.userId));
  });
}

function acceptMatch() {
  socket.emit('ready_up', { matchId: currentMatchId, userId: currentUser.id });
  const btn = document.getElementById('accept-btn');
  btn.disabled = true;
  btn.textContent = '✓ ПРИНЯТО';
  btn.style.background = '#1a4a2a';
  btn.style.color = 'var(--green)';
}

function declineMatch() {
  clearInterval(acceptInterval);
  socket.emit('leave_queue', { userId: currentUser.id });
  showState('idle');
}

// ─── Veto ─────────────────────────────────────────────────────────────────────
function renderVeto() {
  const team1 = allPlayers.filter(p => p.team === 1);
  const team2 = allPlayers.filter(p => p.team === 2);

  document.getElementById('veto-team1-players').innerHTML =
    team1.map(p => {
      const isMe = p.username === currentUser.username;
      return `<div class="veto-player-chip ${isMe ? 'me' : ''}">${p.username}</div>`;
    }).join('');

  document.getElementById('veto-team2-players').innerHTML =
    team2.map(p => `<div class="veto-player-chip">${p.username}</div>`).join('');

  updateVetoTurn();
  renderMapCards();
}

function renderMapCards() {
  const grid = document.getElementById('maps-grid');
  const allMaps = ['Mirage','Inferno','Dust II','Nuke','Overpass','Ancient','Anubis'];

  grid.innerHTML = allMaps.map(map => {
    const isBanned = bannedMaps.includes(map);
    const bgClass = MAPS_BG[map] || 'map-mirage';
    const clickable = !isBanned && isMyTurn;
    return `<div class="map-card ${bgClass} ${isBanned ? 'banned' : ''} ${clickable ? 'clickable' : ''}"
      id="map-${map.replace(/\s/g,'_')}"
      ${clickable ? `onclick="banMap('${map}')"` : ''}>
      <span class="map-name">${map}</span>
    </div>`;
  }).join('');
}

function updateVetoMaps() {
  const allMaps = ['Mirage','Inferno','Dust II','Nuke','Overpass','Ancient','Anubis'];
  allMaps.forEach(map => {
    const el = document.getElementById('map-' + map.replace(/\s/g,'_'));
    if (!el) return;
    if (bannedMaps.includes(map)) {
      el.classList.add('banned');
      el.classList.remove('clickable');
      el.removeAttribute('onclick');
    } else if (isMyTurn) {
      el.classList.add('clickable');
      el.setAttribute('onclick', `banMap('${map}')`);
    }
  });
  updateVetoTurn();
}

function updateVetoTurn() {
  isMyTurn = (currentVetoTeam === myTeam);
  const badge = document.getElementById('veto-turn-badge');
  if (isMyTurn) {
    badge.textContent = '🎯 ВАШ ХОД — ЗАБАНЬТЕ КАРТУ';
    badge.className = 'veto-turn-badge my-turn';
  } else {
    badge.textContent = '⏳ Ожидание хода противника...';
    badge.className = 'veto-turn-badge their-turn';
  }
  // Re-render clickability
  renderMapCards();
}

function banMap(map) {
  if (!isMyTurn) return;
  socket.emit('ban_map', { matchId: currentMatchId, userId: currentUser.id, map });
}

// ─── Match Active ─────────────────────────────────────────────────────────────
function showMatchActive(data) {
  document.getElementById('active-map-name').textContent = data.map;

  const team1 = data.players.filter(p => p.team === 1);
  const team2 = data.players.filter(p => p.team === 2);

  document.getElementById('active-team1').innerHTML = team1.map(p => {
    const isMe = p.username === currentUser.username;
    return `<div class="player-row" style="margin-bottom:6px">
      ${renderAvatar(p.username, 'avatar-sm')}
      ${renderSmallLevel(p.elo)}
      <div class="player-row-info">
        <div class="player-row-name" style="${isMe ? 'color:var(--accent)' : ''}">${p.username}${isMe ? ' (Вы)' : ''}</div>
        <div class="player-row-cheat" style="color:${getCheatColor(p.cheat)}">${p.cheat}</div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('active-team2').innerHTML = team2.map(p => {
    return `<div class="player-row" style="margin-bottom:6px">
      ${renderAvatar(p.username, 'avatar-sm')}
      ${renderSmallLevel(p.elo)}
      <div class="player-row-info">
        <div class="player-row-name">${p.username}</div>
        <div class="player-row-cheat" style="color:${getCheatColor(p.cheat)}">${p.cheat}</div>
      </div>
    </div>`;
  }).join('');

  matchSecs = 0;
  clearInterval(matchInterval);
  matchInterval = setInterval(() => {
    matchSecs++;
    document.getElementById('active-timer').textContent = formatTime(matchSecs);
  }, 1000);

  showState('active');
}

// ─── Match End ────────────────────────────────────────────────────────────────
function showMatchEnd(data) {
  const resultEl = document.getElementById('ended-result');
  resultEl.textContent = data.won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
  resultEl.className = 'ended-result ' + (data.won ? 'win' : 'loss');

  document.getElementById('ended-score').textContent = data.score;
  document.getElementById('ended-map').textContent = 'Карта: ' + data.map;

  const eloEl = document.getElementById('ended-elo');
  eloEl.textContent = (data.eloChange > 0 ? '+' : '') + data.eloChange + ' ELO';
  eloEl.className = 'elo-change-badge ' + (data.eloChange > 0 ? 'positive' : 'negative');

  showState('ended');
}
