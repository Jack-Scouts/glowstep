// Glowstep server: song storage, admin API and live control of /screen displays.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const SONG_DIR = path.join(DATA_DIR, 'songs');
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const sign = what => PASSWORD ? crypto.createHmac('sha256', PASSWORD).update(what).digest('hex') : '';
const TOKEN = sign('glowstep-admin');
const SCREEN_TOKEN = sign('glowstep-screen'); // changes whenever the password does, which unlinks old screens
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const VOTES_FILE = path.join(DATA_DIR, 'votes.json');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
fs.mkdirSync(SONG_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

/* ---------- auth ---------- */
function cookies(header = '') {
  return Object.fromEntries(header.split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const safeEq = (a = '', b = '') => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const isAdminCookie = header => !PASSWORD || safeEq(cookies(header).gs_admin, TOKEN);
// A screen may fetch songs if it holds the screen cookie (from the admin's screen link) or is logged in as admin.
const isScreenCookie = header => isAdminCookie(header) || safeEq(cookies(header).gs_screen, SCREEN_TOKEN);
const isAdmin = req => isAdminCookie(req.headers.cookie);
const isScreen = req => isScreenCookie(req.headers.cookie);
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Log in to the admin first.' });
  res.redirect('/login');
}
function requireScreen(req, res, next) {
  if (isScreen(req)) return next();
  res.status(401).json({ error: 'This screen is not linked. Open the screen link from the admin.' });
}

app.disable('x-powered-by');
app.set('trust proxy', 1); // Railway's proxy: gives the real client IP and https protocol
app.use((req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
app.use(express.json({ limit: '2mb' }));

/* ---------- pages ---------- */
const page = f => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get('/', (req, res) => res.redirect('/screen'));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
app.get('/screen', (req, res) => {
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  if (PASSWORD && key) {
    if (!safeEq(key, SCREEN_TOKEN)) return page('screen-locked.html')(req, res);
    // Swap the key for a cookie so it drops out of the address bar and browser history.
    res.setHeader('Set-Cookie', `gs_screen=${SCREEN_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`);
    return res.redirect('/screen');
  }
  page(isScreen(req) ? 'screen.html' : 'screen-locked.html')(req, res);
});
app.get('/vote', page('vote.html'));
app.get('/vote-qr.svg', async (req, res) => {
  try {
    const svg = await QRCode.toString(voteUrl(req), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0C0A24', light: '#FFFFFF' } });
    res.type('image/svg+xml').setHeader('Cache-Control', 'no-cache'); res.send(svg);
  } catch (e) { res.status(500).end(); }
});
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
app.get('/api/screen-link', requireAdmin, (req, res) => res.json({ path: PASSWORD ? `/screen?key=${SCREEN_TOKEN}` : '/screen' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

/* ---------- songs ---------- */
const metaPath = id => path.join(SONG_DIR, `${id}.json`);
const validId = id => /^[a-z0-9-]{6,40}$/.test(id);
function readSong(id) {
  if (!validId(id)) return null;
  try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch { return null; }
}
let songsCache = null;
function listSongs() {
  return songsCache ||= fs.readdirSync(SONG_DIR).filter(f => f.endsWith('.json'))
    .map(f => readSong(f.slice(0, -5))).filter(Boolean)
    .map(({ beats, energy, bars, ...rest }) => ({ ...rest, barCount: bars?.length || 0 }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

app.get('/api/songs', requireAdmin, (req, res) => res.json(listSongs()));
app.get('/api/songs/:id', requireScreen, (req, res) => {
  const s = readSong(req.params.id);
  if (!s) return res.status(404).json({ error: 'Song not found.' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(s);
});
app.get('/media/:id', requireScreen, (req, res) => {
  const s = readSong(req.params.id);
  if (!s) return res.status(404).end();
  // Never cached by shared caches, never offered as a download.
  res.sendFile(path.join(SONG_DIR, s.file), { cacheControl: false, headers: { 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' } });
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
  songsChanged();
  res.json(song);
});

app.put('/api/songs/:id', requireAdmin, (req, res) => {
  const s = readSong(req.params.id);
  if (!s) return res.status(404).json({ error: 'Song not found.' });
  const next = { ...s, ...pickSong(req.body), updatedAt: Date.now() };
  fs.writeFileSync(metaPath(s.id), JSON.stringify(next));
  songsChanged();
  if (state.songId === s.id) io.to('screens').emit('songUpdated', s.id);
  res.json(next);
});

app.delete('/api/songs/:id', requireAdmin, (req, res) => {
  const s = readSong(req.params.id);
  if (!s) return res.status(404).json({ error: 'Song not found.' });
  fs.rmSync(path.join(SONG_DIR, s.file), { force: true });
  fs.rmSync(metaPath(s.id), { force: true });
  if (votes[s.id]) { delete votes[s.id]; saveVotes(); }
  const queue = state.queue.filter(q => q.songId !== s.id);
  if (state.songId === s.id) setState({ songId: null, status: 'idle', offset: 0, queue });
  else if (queue.length !== state.queue.length) setState({ queue });
  songsChanged();
  res.json({ ok: true });
});

/* ---------- live state + queue ---------- */
// status: idle | ready | playing | paused | ended
// queue: songs waiting to play, in order ({ qid, songId }); the song on screen is not in it.
// auto: the next automatic step once a song ends ({ step: 'next' | 'play', at }), or null.
// voting: crowd voting settings (on, show the QR code on screen, allow repeat votes).
let state = { songId: null, status: 'idle', offset: 0, startedAt: 0, rev: 0, queue: [], autoplay: true, auto: null,
  voting: { on: false, qr: true, repeat: true } };
let endTimer = null, autoTimer = null;
const LEAD_MS = 600;       // give every screen a moment to start in sync
const SWITCH_MS = 2500;    // longer when the song changes, so screens can fetch and decode it
const BREAK_MS = 8000;     // celebration screen before the next queued song comes up
const UP_NEXT_MS = 5000;   // "Up next" screen before it starts playing
const QUEUE_MAX = 200;

try {
  const saved = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  state.queue = (saved.queue || []).filter(q => q && validId(q.songId) && readSong(q.songId)).slice(0, QUEUE_MAX);
  state.autoplay = saved.autoplay !== false;
  if (saved.voting) state.voting = { ...state.voting, ...saved.voting };
} catch {}
function saveQueue() {
  try { fs.writeFileSync(QUEUE_FILE, JSON.stringify({ queue: state.queue, autoplay: state.autoplay, voting: state.voting })); } catch (e) { console.error('Could not save the queue:', e.message); }
}

function position() {
  if (state.status === 'playing') return state.offset + (Date.now() - state.startedAt) / 1000;
  return state.offset;
}
// Any change cancels a pending automatic step unless the patch sets a new one.
function setState(patch) {
  const prevQueue = state.queue, prevAuto = state.autoplay, prevVoting = state.voting;
  state = { ...state, auto: null, ...patch, rev: state.rev + 1 };
  clearTimeout(endTimer); clearTimeout(autoTimer);
  if (state.status === 'playing') {
    const song = readSong(state.songId);
    if (song?.duration) {
      const ms = (song.duration - state.offset) * 1000 + (state.startedAt - Date.now()) + 1500;
      endTimer = setTimeout(songEnded, Math.max(0, ms));
    }
  }
  if (state.auto) autoTimer = setTimeout(runAuto, Math.max(0, state.auto.at - Date.now()));
  if (state.queue !== prevQueue || state.autoplay !== prevAuto || state.voting !== prevVoting) saveQueue();
  // A song's votes are used up once it plays.
  if (state.status === 'playing' && votes[state.songId]) { delete votes[state.songId]; saveVotes(); }
  io.to(['screens', 'admin']).emit('state', state);
  pushVotes();
}

/* ---------- crowd voting ---------- */
// votes: songId -> { n: total votes, by: { voterId: votes from that phone } }
let votes = {};
try { votes = JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8')) || {}; } catch {}
const VOTE_GAP_MS = 5000;      // one vote per phone every 5 seconds
const IP_VOTES_PER_MIN = 120;  // generous, since a whole venue can share one IP
const lastVote = new Map(), ipHits = new Map();
setInterval(() => { const t = Date.now() - 60000; for (const m of [lastVote, ipHits]) for (const [k, v] of m) if ((v.t ?? v) < t) m.delete(k); }, 60000).unref();

let saveVotesT = null;
function saveVotes() {
  clearTimeout(saveVotesT);
  saveVotesT = setTimeout(() => fs.writeFile(VOTES_FILE, JSON.stringify(votes), e => e && console.error('Could not save votes:', e.message)), 1000);
}
const onScreen = id => state.songId === id && ['ready', 'playing', 'paused'].includes(state.status);
function board() {
  const queued = new Set(state.queue.map(q => q.songId));
  return {
    on: state.voting.on, repeat: state.voting.repeat,
    songs: listSongs().map(s => ({ id: s.id, title: s.title, votes: votes[s.id]?.n || 0, flag: onScreen(s.id) ? 'playing' : queued.has(s.id) ? 'queued' : null }))
  };
}
// Batch updates so a burst of votes doesn't flood every phone.
let pushVotesT = null;
function pushVotes() {
  if (pushVotesT) return;
  pushVotesT = setTimeout(() => { pushVotesT = null; const b = board(); io.to('admin').emit('votes', b); io.to('voters').emit('votes', b.on ? b : { on: false }); }, 300);
}
function songsChanged() { songsCache = null; io.to('admin').emit('songs', listSongs()); pushVotes(); }
function voterId(req, res) {
  let id = cookies(req.headers.cookie).gs_voter;
  if (!/^[a-f0-9]{16}$/.test(id || '')) {
    id = crypto.randomBytes(8).toString('hex');
    res.setHeader('Set-Cookie', `gs_voter=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`);
  }
  return id;
}
const voteUrl = req => `${PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/vote`;
const mineOf = id => Object.fromEntries(Object.entries(votes).filter(([, v]) => v.by?.[id]).map(([k, v]) => [k, v.by[id]]));

app.get('/api/vote', (req, res) => {
  const id = voterId(req, res);
  res.setHeader('Cache-Control', 'no-store');
  res.json(state.voting.on ? { ...board(), mine: mineOf(id) } : { on: false });
});
app.post('/api/vote', (req, res) => {
  if (!state.voting.on) return res.status(403).json({ error: 'Voting is closed right now.' });
  const id = voterId(req, res), songId = String(req.body?.songId || '');
  if (!listSongs().some(s => s.id === songId)) return res.status(404).json({ error: 'That song is not in the list any more.' });
  if (onScreen(songId)) return res.status(409).json({ error: "That one's on right now! Pick another." });
  const now = Date.now(), wait = VOTE_GAP_MS - (now - (lastVote.get(id) || 0));
  if (wait > 0) return res.status(429).json({ error: `Hold on ${Math.ceil(wait / 1000)}s before voting again.`, wait });
  const ip = ipHits.get(req.ip); const hits = ip && now - ip.t < 60000 ? ip : { n: 0, t: now };
  if (++hits.n > IP_VOTES_PER_MIN) return res.status(429).json({ error: 'Lots of votes from this network. Try again in a minute.', wait: 60000 });
  ipHits.set(req.ip, hits);
  const rec = votes[songId] ||= { n: 0, by: {} };
  if (!state.voting.repeat && rec.by[id]) return res.status(409).json({ error: "You've already voted for this one." });
  rec.n++; rec.by[id] = (rec.by[id] || 0) + 1; lastVote.set(id, now);
  saveVotes(); pushVotes();
  res.json({ ok: true, votes: rec.n, mine: rec.by[id], wait: VOTE_GAP_MS });
});
// After a song finishes, the next queued one comes up by itself (if autoplay is on).
const autoAfterEnd = (queue = state.queue) => state.autoplay && queue.length ? { step: 'next', at: Date.now() + BREAK_MS } : null;
function songEnded() { setState({ status: 'ended', offset: 0, auto: autoAfterEnd() }); }
function runAuto() {
  const a = state.auto; if (!a) return;
  if (a.step === 'next') return startFromQueue(state.queue[0]?.qid, false, { step: 'play', at: Date.now() + UP_NEXT_MS });
  if (a.step === 'play' && state.songId) setState({ status: 'playing', offset: 0, startedAt: Date.now() + LEAD_MS });
}
// Take a song off the queue and put it on screen, either waiting ("ready") or playing straight away.
function startFromQueue(qid, play, auto = null) {
  let queue = state.queue.filter(q => readSong(q.songId)); // skip anything deleted meanwhile
  const item = queue.find(q => q.qid === qid);
  if (!item) return setState({ queue });
  queue = queue.filter(q => q !== item);
  const lead = item.songId === state.songId ? LEAD_MS : SWITCH_MS;
  setState({ songId: item.songId, queue, status: play ? 'playing' : 'ready', offset: 0, startedAt: play ? Date.now() + lead : 0, auto });
}

const screens = new Map(); // socket.id -> report
function pushScreens() { io.to('admin').emit('screens', [...screens.values()]); }

io.on('connection', socket => {
  const role = ['admin', 'vote'].includes(socket.handshake.query.role) ? socket.handshake.query.role : 'screen';
  if (role === 'vote') { socket.join('voters'); const b = board(); return socket.emit('votes', b.on ? b : { on: false }); }
  const authed = role === 'admin' && isAdminCookie(socket.handshake.headers.cookie);

  socket.on('timesync', (_, cb) => typeof cb === 'function' && cb(Date.now()));

  if (role === 'screen') {
    if (!isScreenCookie(socket.handshake.headers.cookie)) { socket.emit('authError'); return socket.disconnect(true); }
    screens.set(socket.id, { id: socket.id, connectedAt: Date.now(), soundOn: false, loaded: null, pos: 0 });
    pushScreens();
    socket.on('report', r => {
      const cur = screens.get(socket.id); if (!cur || !r) return;
      screens.set(socket.id, { ...cur, soundOn: !!r.soundOn, loaded: r.loaded || null, pos: +r.pos || 0, size: r.size || null });
      pushScreens();
    });
    socket.on('disconnect', () => { screens.delete(socket.id); pushScreens(); });
    socket.join('screens');
    socket.emit('state', state);
    return;
  }

  if (!authed) { socket.emit('authError'); return socket.disconnect(true); }
  socket.join('admin');
  socket.emit('state', state);
  socket.emit('songs', listSongs());
  socket.emit('votes', board());
  socket.emit('screens', [...screens.values()]);

  socket.on('cmd', (c = {}) => {
    const now = Date.now();
    switch (c.type) {
      case 'enqueue': {
        if (!readSong(c.songId) || state.queue.length >= QUEUE_MAX) return;
        const queue = [...state.queue, { qid: crypto.randomBytes(5).toString('hex'), songId: c.songId }];
        return setState({ queue, auto: state.auto || (state.status === 'ended' ? autoAfterEnd(queue) : null) });
      }
      case 'unqueue':
        return setState({ queue: state.queue.filter(q => q.qid !== c.qid), auto: state.auto });
      case 'reorder': {
        const byId = new Map(state.queue.map(q => [q.qid, q]));
        const order = Array.isArray(c.order) ? c.order : [];
        if (order.length !== byId.size || new Set(order).size !== order.length || !order.every(id => byId.has(id))) return socket.emit('state', state);
        return setState({ queue: order.map(id => byId.get(id)), auto: state.auto });
      }
      case 'clearQueue':
        return setState({ queue: [] });
      case 'autoplay':
        if (!c.on) return setState({ autoplay: false });
        return setState({ autoplay: true, auto: state.auto || (state.status === 'ended' && state.queue.length ? { step: 'next', at: Date.now() + BREAK_MS } : null) });
      case 'playNow':
        return startFromQueue(c.qid, true);
      case 'next':
        return startFromQueue(state.queue[0]?.qid, true);
      case 'voting': {
        const v = state.voting;
        const pick = k => typeof c[k] === 'boolean' ? c[k] : v[k];
        return setState({ voting: { on: pick('on'), qr: pick('qr'), repeat: pick('repeat') }, auto: state.auto });
      }
      case 'resetVotes':
        if (c.songId) delete votes[c.songId]; else votes = {};
        saveVotes(); return pushVotes();
      case 'hold':
        return setState({});
      case 'play':
        if (!state.songId) return startFromQueue(state.queue[0]?.qid, true);
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
        return io.to('screens').emit('say', { text: String(c.text || '').slice(0, 60), big: !!c.big, at: now });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Glowstep running on :${PORT}  (data: ${DATA_DIR}, admin password ${PASSWORD ? 'on' : 'off'})`);
});
