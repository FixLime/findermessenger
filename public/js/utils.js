// ─── ELO / Level Utilities ───────────────────────────────────────────────────

const LEVEL_THRESHOLDS = [0, 501, 751, 901, 1101, 1251, 1401, 1601, 1801, 2001, Infinity];
const LEVEL_COLORS = {
  1: '#b0b0b0', 2: '#1dcf3c', 3: '#1dcf3c', 4: '#1dcf3c',
  5: '#f5d328', 6: '#f5d328', 7: '#f0a030', 8: '#f0a030',
  9: '#f54545', 10: '#ff5500'
};
const LEVEL_NAMES = {
  1: 'Новичок', 2: 'Бронза', 3: 'Бронза', 4: 'Серебро',
  5: 'Золото', 6: 'Золото', 7: 'Платина', 8: 'Платина',
  9: 'Алмаз', 10: 'Элита'
};

function getLevel(elo) {
  for (let i = 1; i <= 10; i++) {
    if (elo < LEVEL_THRESHOLDS[i]) return i;
  }
  return 10;
}

function getLevelColor(level) { return LEVEL_COLORS[level] || '#b0b0b0'; }
function getLevelName(level) { return LEVEL_NAMES[level] || 'Новичок'; }

function getLevelProgress(elo) {
  const level = getLevel(elo);
  if (level === 10) return { progress: 100, toNext: 0, current: elo, next: null };
  const from = LEVEL_THRESHOLDS[level - 1];
  const to = LEVEL_THRESHOLDS[level];
  const progress = Math.round(((elo - from) / (to - from)) * 100);
  return { progress, toNext: to - elo, current: elo, next: to };
}

// ─── Avatar Color ─────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#ff5500', '#7c3aed', '#2563eb', '#dc2626',
  '#16a34a', '#d97706', '#0891b2', '#be185d'
];

function getUserColor(username) {
  let hash = 0;
  for (const c of username) hash = (hash * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
}

// ─── Level Badge HTML ─────────────────────────────────────────────────────────

function renderLevelBadge(elo, size = 'md') {
  const level = getLevel(elo);
  const color = getLevelColor(level);
  const sizes = { sm: 40, md: 60, lg: 80 };
  const px = sizes[size] || 60;
  const fontSize = Math.round(px * 0.42);
  return `<div class="level-circle" style="width:${px}px;height:${px}px;color:${color}">
    <span class="level-number" style="font-size:${fontSize}px">${level}</span>
  </div>`;
}

// ─── Avatar HTML ──────────────────────────────────────────────────────────────

function renderAvatar(username, sizeClass = 'avatar-md') {
  const color = getUserColor(username);
  const initial = username.charAt(0).toUpperCase();
  return `<div class="avatar ${sizeClass}" style="background:${color}">${initial}</div>`;
}

// ─── Small level badge for lists ─────────────────────────────────────────────

function renderSmallLevel(elo) {
  const level = getLevel(elo);
  const color = getLevelColor(level);
  return `<div style="
    width:28px;height:28px;border-radius:50%;
    border:2px solid ${color};color:${color};
    display:flex;align-items:center;justify-content:center;
    font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:700;
    flex-shrink:0;background:rgba(0,0,0,0.3)
  ">${level}</div>`;
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

async function apiPost(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
}

async function requireLogin() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return null; }
    const user = await res.json();
    return user;
  } catch {
    window.location.href = '/';
    return null;
  }
}

// ─── Auth Check + Setup Check ─────────────────────────────────────────────────

async function requireSetup() {
  const user = await requireLogin();
  if (!user) return null;
  if (!user.setup_done) { window.location.href = '/setup.html'; return null; }
  return user;
}

// ─── Render Navbar User ───────────────────────────────────────────────────────

function renderNavUser(user) {
  const level = getLevel(user.elo);
  const color = getLevelColor(level);
  const nameEl = document.getElementById('nav-username');
  const avatarEl = document.getElementById('nav-avatar');
  const levelEl = document.getElementById('nav-level');

  if (nameEl) nameEl.textContent = user.username;
  if (avatarEl) {
    avatarEl.style.background = getUserColor(user.username);
    avatarEl.textContent = user.username.charAt(0).toUpperCase();
  }
  if (levelEl) {
    levelEl.textContent = level;
    levelEl.style.color = color;
    levelEl.style.borderColor = color;
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────

async function logout() {
  await apiPost('/api/logout', {});
  window.location.href = '/';
}

// ─── Time Format ──────────────────────────────────────────────────────────────

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Cheat badge style ───────────────────────────────────────────────────────

const CHEAT_COLORS = {
  'Neverlose': '#8b5cf6', 'Nixware': '#3b82f6', 'Fatality': '#ef4444',
  'Skeet.cc': '#22c55e', 'Onetap': '#14b8a6', 'Aimware': '#f97316',
  'Gamesense': '#06b6d4', 'Interwebz': '#ec4899', 'Primordial': '#7f1d1d', 'Другое': '#6b7280'
};

function getCheatColor(cheat) { return CHEAT_COLORS[cheat] || '#6b7280'; }

function renderCheatBadge(cheat) {
  const color = getCheatColor(cheat);
  return `<span class="cheat-badge" style="color:${color};border-color:${color}33;background:${color}15">${cheat || '—'}</span>`;
}
