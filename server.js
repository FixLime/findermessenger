const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// ─── Database ─────────────────────────────────────────────────────────────────
const db = new Database('cheatmatch.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    cheat TEXT,
    avg_ping INTEGER DEFAULT 50,
    elo INTEGER DEFAULT 1000,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    setup_done INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: 'cm_x9k2m_secret_7z',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// ─── Auth Routes ───────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password)
    return res.status(400).json({ error: 'Заполните все поля' });
  if (username.trim().length < 3)
    return res.status(400).json({ error: 'Никнейм минимум 3 символа' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username.trim(), hash);
    req.session.userId = result.lastInsertRowid;
    res.json({ success: true, redirect: '/setup.html' });
  } catch (e) {
    if (e.message.includes('UNIQUE'))
      return res.status(400).json({ error: 'Никнейм уже занят' });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: 'Неверный никнейм или пароль' });
  req.session.userId = user.id;
  res.json({ success: true, redirect: user.setup_done ? '/dashboard.html' : '/setup.html' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.post('/api/setup', requireAuth, (req, res) => {
  const { cheat, avg_ping } = req.body;
  if (!cheat) return res.status(400).json({ error: 'Выберите чит' });
  const ping = Math.min(Math.max(parseInt(avg_ping) || 50, 1), 999);
  db.prepare('UPDATE users SET cheat = ?, avg_ping = ?, setup_done = 1 WHERE id = ?')
    .run(cheat, ping, req.session.userId);
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, cheat, avg_ping, elo, wins, losses, setup_done FROM users WHERE id = ?'
  ).get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  res.json(user);
});

app.get('/api/leaderboard', (req, res) => {
  const users = db.prepare(
    'SELECT username, cheat, elo, wins, losses FROM users ORDER BY elo DESC LIMIT 50'
  ).all();
  res.json(users);
});

// ─── Matchmaking ───────────────────────────────────────────────────────────────
const queue = new Map();
const activeMatches = new Map();

const MAPS = ['Mirage', 'Inferno', 'Dust II', 'Nuke', 'Overpass', 'Ancient', 'Anubis'];

const BOT_NAMES = [
  'xX_pr0h4ck3r_Xx', 'silent_aimbot', 'wallhax_king', 'norecoil_god',
  'spinbot_2077', 'rage_hacker', 'hvh_demon', 'aimware_enjoyer', 'skeet_god'
];
const BOT_CHEATS = ['Neverlose', 'Nixware', 'Fatality', 'Skeet.cc', 'Onetap', 'Aimware'];

function getLevel(elo) {
  if (elo < 501) return 1;  if (elo < 751) return 2;  if (elo < 901) return 3;
  if (elo < 1101) return 4; if (elo < 1251) return 5; if (elo < 1401) return 6;
  if (elo < 1601) return 7; if (elo < 1801) return 8; if (elo < 2001) return 9;
  return 10;
}

io.on('connection', (socket) => {
  socket.on('join_queue', (data) => {
    const { userId, username, elo, cheat } = data;

    // Check not already in active match
    for (const [, match] of activeMatches) {
      if (match.players.find(p => p.userId === userId)) {
        socket.emit('already_in_match', { matchId: match.id });
        return;
      }
    }

    queue.set(userId, { userId, username, elo, cheat, socketId: socket.id });
    socket.emit('queue_joined', { inQueue: queue.size });

    // Simulate finding match after random delay (5–12 seconds)
    const delay = Math.floor(Math.random() * 7000) + 5000;
    setTimeout(() => {
      if (!queue.has(userId)) return;
      const player = queue.get(userId);
      queue.delete(userId);
      createMatch(player);
    }, delay);
  });

  socket.on('leave_queue', (data) => {
    queue.delete(data.userId);
    socket.emit('queue_left');
  });

  socket.on('ready_up', (data) => {
    const match = activeMatches.get(data.matchId);
    if (!match || match.phase !== 'ready') return;

    match.readySet.add(data.userId);
    broadcastToMatch(match, 'ready_update', {
      readyCount: match.readySet.size,
      total: match.players.length,
      readyPlayers: Array.from(match.readySet)
    });

    if (match.readySet.size >= match.players.length) {
      match.phase = 'veto';
      startVeto(match);
    }
  });

  socket.on('ban_map', (data) => {
    const { matchId, userId, map } = data;
    const match = activeMatches.get(matchId);
    if (!match || match.phase !== 'veto') return;

    const player = match.players.find(p => p.userId === userId);
    if (!player || player.isBot || match.currentVetoTeam !== player.team) return;
    if (!match.remainingMaps.includes(map)) return;

    processBan(match, map);
  });

  socket.on('disconnect', () => {
    for (const [uid, data] of queue) {
      if (data.socketId === socket.id) { queue.delete(uid); break; }
    }
  });
});

function createMatch(realPlayer) {
  const matchId = `match_${Date.now()}`;

  const bots = BOT_NAMES.map((name, i) => ({
    userId: `bot_${i}_${matchId}`,
    username: name,
    elo: realPlayer.elo + Math.floor(Math.random() * 300) - 150,
    cheat: BOT_CHEATS[Math.floor(Math.random() * BOT_CHEATS.length)],
    isBot: true,
    team: i < 4 ? 1 : 2
  }));

  const allPlayers = [
    { ...realPlayer, isBot: false, team: 1 },
    ...bots
  ];

  const match = {
    id: matchId,
    players: allPlayers,
    phase: 'ready',
    readySet: new Set(),
    remainingMaps: [...MAPS],
    bannedMaps: [],
    currentVetoTeam: 1,
    vetoTurn: 0
  };

  activeMatches.set(matchId, match);

  const sock = io.sockets.sockets.get(realPlayer.socketId);
  if (sock) {
    sock.join(matchId);
    sock.emit('match_found', {
      matchId,
      players: allPlayers.map(p => ({
        username: p.username,
        elo: p.elo,
        cheat: p.cheat,
        team: p.team,
        isBot: p.isBot,
        level: getLevel(p.elo)
      }))
    });
  }

  // Bots auto-ready after 1.5–3 seconds
  setTimeout(() => {
    const m = activeMatches.get(matchId);
    if (!m || m.phase !== 'ready') return;
    bots.forEach(b => m.readySet.add(b.userId));
    broadcastToMatch(m, 'ready_update', {
      readyCount: m.readySet.size,
      total: m.players.length,
      readyPlayers: Array.from(m.readySet)
    });
    // If user already accepted
    if (m.readySet.size >= m.players.length) {
      m.phase = 'veto';
      startVeto(m);
    }
  }, 1500 + Math.random() * 1500);
}

function startVeto(match) {
  broadcastToMatch(match, 'veto_start', {
    maps: match.remainingMaps,
    currentTeam: match.currentVetoTeam,
    bannedMaps: []
  });
  scheduleBotBan(match);
}

function processBan(match, map) {
  const idx = match.remainingMaps.indexOf(map);
  if (idx === -1) return;

  match.remainingMaps.splice(idx, 1);
  match.bannedMaps.push(map);
  match.vetoTurn++;
  match.currentVetoTeam = match.currentVetoTeam === 1 ? 2 : 1;

  if (match.remainingMaps.length === 1) {
    match.phase = 'active';
    match.selectedMap = match.remainingMaps[0];

    broadcastToMatch(match, 'match_start', {
      map: match.selectedMap,
      matchId: match.id,
      bannedMaps: match.bannedMaps,
      players: match.players.map(p => ({
        username: p.username,
        elo: p.elo,
        cheat: p.cheat,
        team: p.team,
        level: getLevel(p.elo)
      }))
    });

    // End match after 30 seconds
    setTimeout(() => endMatch(match), 30000);
  } else {
    broadcastToMatch(match, 'map_banned', {
      bannedMap: map,
      remainingMaps: match.remainingMaps,
      bannedMaps: match.bannedMaps,
      currentTeam: match.currentVetoTeam,
      vetoTurn: match.vetoTurn
    });
    scheduleBotBan(match);
  }
}

function scheduleBotBan(match) {
  if (match.phase !== 'veto' || match.remainingMaps.length <= 1) return;

  const realPlayer = match.players.find(p => !p.isBot);
  if (!realPlayer || match.currentVetoTeam === realPlayer.team) return;

  // Bot team bans after 2–4 seconds
  setTimeout(() => {
    if (match.phase !== 'veto' || match.remainingMaps.length <= 1) return;
    const map = match.remainingMaps[Math.floor(Math.random() * match.remainingMaps.length)];
    processBan(match, map);
  }, 2000 + Math.random() * 2000);
}

function broadcastToMatch(match, event, data) {
  const real = match.players.find(p => !p.isBot);
  if (!real) return;
  const sock = io.sockets.sockets.get(real.socketId);
  if (sock) sock.emit(event, data);
}

function endMatch(match) {
  if (!activeMatches.has(match.id)) return;

  const real = match.players.find(p => !p.isBot);
  if (!real) { activeMatches.delete(match.id); return; }

  const won = Math.random() > 0.4;
  const s1 = won ? 16 : Math.floor(Math.random() * 13) + 3;
  const s2 = won ? Math.floor(Math.random() * 13) + 3 : 16;
  const eloChange = won
    ? Math.floor(Math.random() * 20) + 15
    : -(Math.floor(Math.random() * 15) + 10);

  try {
    const user = db.prepare('SELECT elo FROM users WHERE id = ?').get(real.userId);
    if (user) {
      const newElo = Math.max(100, user.elo + eloChange);
      if (won) {
        db.prepare('UPDATE users SET elo = ?, wins = wins + 1 WHERE id = ?').run(newElo, real.userId);
      } else {
        db.prepare('UPDATE users SET elo = ?, losses = losses + 1 WHERE id = ?').run(newElo, real.userId);
      }
    }
  } catch (e) { console.error('DB error:', e); }

  broadcastToMatch(match, 'match_end', {
    won,
    score: `${s1}:${s2}`,
    eloChange,
    map: match.selectedMap
  });

  activeMatches.delete(match.id);
}

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`CheatMatch running on http://localhost:${PORT}`);
});
