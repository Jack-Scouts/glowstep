// Glowstep server: song storage, admin API and live control of /screen displays.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const SONG_DIR = path.join(DATA_DIR, 'songs');
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN = PASSWORD ? crypto.createHmac('sha256', PASSWORD).update('glowstep-admin').digest('hex') : '';
fs.mkdirSync(SONG_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

/* ---------- auth ---------- */
function cookies(header = '') {
  return Object.fromEntries(header.split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const isAdmin = req => !PASSWORD || cookies(req.headers.cookie).gs_admin === TOKEN;
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Log in to the admin first.' });
  res.redirect('/login');
}

app.use(express.json({ limit: '2mb' }));

/* ---------- pages ---------- */
const page = f => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get('/', (req, res) => res.redirect('/screen'));
app.get('/screen', page('screen.html'));
app.get('/login', (req, res) => (PASSWORD ? page('login.html')(req, res) : res.redirect('/admin')));
app.get('/admin', requireAdmin, page('admin.html'));
app.post('/api/login', (req, res) => {
  if (!PASSWORD || req.body?.password === PASSWORD) {
    res.setHeader('Set-Cookie', `gs_admin=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'That password is not right.' });
});
app.get('/api/config', (req, res) => res.json({ passwordSet: !!PASSWORD }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

/* ---------- songs ---------- */
const metaPath = id => path.join(SONG_DIR, `${id}.json`);
const validId = id => /^[a-z0-9-]{6,40}$/.test(id);
function readSong(id) {
  if (!validId(id)) return null;
  try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch { return null; }
}
function listSongs() {
  return fs.readdirSync(SONG_DIR).filter(f => f.endsWith('.json'))
    .map(f => readSong(f.slice(0, -5))).filter(Boolean)
    .map(({ beats, energy, bars, ...rest }) => ({ ...rest, barCount: bars?.length || 0 }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

app.get('/api/songs', (req, res) => res.json(listSongs()));
app.get('/api/songs/:id', (req, res) => {
  const s = readSong(req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'Song not found.' });
});
app.get('/media/:id', (req, res) => {
  const s = readSong(req.params.id);
  if (!s) return res.status(404).end();
  res.sendFile(path.join(SONG_DIR, s.file), { maxAge: '7d' });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: SONG_DIR,
    filename: (req, file, cb) => {
      const id = crypto.randomBytes(6).toString('hex');
      req.songId = id;
      const ext = (path.extname(file.originalname) || '.mp3').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, id + ext);
    }
  }),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^audio\//.test(file.mimetype) || /\.(mp3|m4a|wav|ogg|aac)$/i.test(file.originalname))
});

const SONG_FIELDS = ['title', 'duration', 'bpm', 'beats', 'downbeat', 'energy', 'bars', 'seed', 'confidence', 'nudge'];
function pickSong(body) {
  const out = {};
  for (const k of SONG_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  if (out.title) out.title = String(out.title).slice(0, 80);
  return out;
}

app.post('/api/songs', requireAdmin, upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an MP3 (or other audio) file to upload.' });
  let analysis = {};
  try { analysis = JSON.parse(req.body.analysis || '{}'); } catch {}
  const song = {
    id: req.songId, file: req.file.filename, originalName: req.file.originalname, size: req.file.size,
    createdAt: Date.now(), title: path.basename(req.file.originalname, path.extname(req.file.originalname)).slice(0, 80),
    ...pickSong(analysis)
  };
  fs.writeFileSync(metaPath(song.id), JSON.stringify(song));
  io.to('admin').emit('songs', listSongs());
  res.json(song);
});

app.put('/api/songs/:id', requireAdmin, (req, res) => {
  const s = readSong(req.params.id);
  if (!s) return res.status(404).json({ error: 'Song not found.' });
  const next = { ...s, ...pickSong(req.body), updatedAt: Date.now() };
  fs.writeFileSync(metaPath(s.id), JSON.stringify(next));
  io.to('admin').emit('songs', listSongs());
  if (state.songId === s.id) io.emit('songUpdated', s.id);
  res.json(next);
});

app.delete('/api/songs/:id', requireAdmin, (req, res) => {
  const s = readSong(req.params.id);
  if (!s) return res.status(404).json({ error: 'Song not found.' });
  fs.rmSync(path.join(SONG_DIR, s.file), { force: true });
  fs.rmSync(metaPath(s.id), { force: true });
  if (state.songId === s.id) setState({ songId: null, status: 'idle', offset: 0 });
  io.to('admin').emit('songs', listSongs());
  res.json({ ok: true });
});

/* ---------- live state ---------- */
// status: idle | ready | playing | paused | ended
let state = { songId: null, status: 'idle', offset: 0, startedAt: 0, rev: 0 };
let endTimer = null;
const LEAD_MS = 600; // give every screen a moment to start in sync

function position() {
  if (state.status === 'playing') return state.offset + (Date.now() - state.startedAt) / 1000;
  return state.offset;
}
function setState(patch) {
  state = { ...state, ...patch, rev: state.rev + 1 };
  clearTimeout(endTimer);
  if (state.status === 'playing') {
    const song = readSong(state.songId);
    if (song?.duration) {
      const ms = (song.duration - state.offset) * 1000 + (state.startedAt - Date.now()) + 1500;
      endTimer = setTimeout(() => setState({ status: 'ended', offset: 0 }), Math.max(0, ms));
    }
  }
  io.emit('state', state);
}

const screens = new Map(); // socket.id -> report
function pushScreens() { io.to('admin').emit('screens', [...screens.values()]); }

io.on('connection', socket => {
  const role = socket.handshake.query.role === 'admin' ? 'admin' : 'screen';
  const authed = role === 'admin' && (!PASSWORD || cookies(socket.handshake.headers.cookie).gs_admin === TOKEN);

  socket.on('timesync', (_, cb) => typeof cb === 'function' && cb(Date.now()));
  socket.emit('state', state);

  if (role === 'screen') {
    screens.set(socket.id, { id: socket.id, connectedAt: Date.now(), soundOn: false, loaded: null, pos: 0 });
    pushScreens();
    socket.on('report', r => {
      const cur = screens.get(socket.id); if (!cur || !r) return;
      screens.set(socket.id, { ...cur, soundOn: !!r.soundOn, loaded: r.loaded || null, pos: +r.pos || 0, size: r.size || null });
      pushScreens();
    });
    socket.on('disconnect', () => { screens.delete(socket.id); pushScreens(); });
    return;
  }

  if (!authed) { socket.emit('authError'); return socket.disconnect(true); }
  socket.join('admin');
  socket.emit('songs', listSongs());
  socket.emit('screens', [...screens.values()]);

  socket.on('cmd', (c = {}) => {
    const now = Date.now();
    switch (c.type) {
      case 'load':
        if (!readSong(c.songId)) return;
        return setState({ songId: c.songId, status: 'ready', offset: 0, startedAt: 0 });
      case 'play':
        if (!state.songId) return;
        return setState({ status: 'playing', offset: state.status === 'ended' ? 0 : state.offset, startedAt: now + LEAD_MS });
      case 'pause':
        if (state.status !== 'playing') return;
        return setState({ status: 'paused', offset: Math.max(0, position()), startedAt: 0 });
      case 'restart':
        if (!state.songId) return;
        return setState({ status: 'playing', offset: 0, startedAt: now + LEAD_MS });
      case 'seek':
        if (!state.songId) return;
        return setState({ offset: Math.max(0, +c.to || 0), startedAt: now + LEAD_MS });
      case 'stop':
        if (!state.songId) return;
        return setState({ status: 'ready', offset: 0, startedAt: 0 });
      case 'clear':
        return setState({ songId: null, status: 'idle', offset: 0, startedAt: 0 });
      case 'say':
        return io.emit('say', { text: String(c.text || '').slice(0, 60), big: !!c.big, at: now });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Glowstep running on :${PORT}  (data: ${DATA_DIR}, admin password ${PASSWORD ? 'on' : 'off'})`);
});
