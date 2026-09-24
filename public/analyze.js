/* Glowstep beat detection + routine generator. Runs in the admin's browser. Exposes window.GSAnalyze.
   1. Split the track into bass / treble / full bands and measure onset strength (~86 frames per second).
   2. Tempo from the autocorrelation of the onset curve, weighted towards danceable tempos.
   3. Beat positions by dynamic programming (Ellis 2007), so tempo drift is followed.
   4. Downbeats from where the kick drum lands; loudness per bar for the choreography. */
(() => {
const SR = 22050, HOP = 256, WIN = 512, FPS = SR / HOP;
const tick = () => new Promise(r => setTimeout(r, 0));

async function renderBands(buf) {
  const len = Math.ceil(buf.duration * SR);
  const off = new OfflineAudioContext(3, len, SR);
  const src = off.createBufferSource(); src.buffer = buf;
  const merger = off.createChannelMerger(3);
  const lp1 = off.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 150;
  const lp2 = off.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 150;
  const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
  src.connect(lp1); lp1.connect(lp2); lp2.connect(merger, 0, 0);
  src.connect(hp); hp.connect(merger, 0, 1);
  src.connect(merger, 0, 2);
  merger.connect(off.destination); src.start();
  const r = await off.startRendering();
  return [r.getChannelData(0), r.getChannelData(1), r.getChannelData(2)];
}

function frameEnergy(x) {
  const n = Math.max(0, Math.floor((x.length - WIN) / HOP) + 1), e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; const o = i * HOP; for (let j = 0; j < WIN; j++) { const v = x[o + j]; s += v * v; } e[i] = s / WIN; }
  return e;
}
const mean = a => { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : 0; };
function std(a) { const m = mean(a); let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / Math.max(1, a.length)) || 1; }

function onsetCurve(e) {
  const m = mean(e) || 1e-9, n = e.length, o = new Float32Array(n);
  let prev = Math.log1p(100 * e[0] / m);
  for (let i = 1; i < n; i++) { const c = Math.log1p(100 * e[i] / m); o[i] = Math.max(0, c - prev); prev = c; }
  const s = std(o); for (let i = 0; i < n; i++) o[i] /= s;
  return o;
}

function estimateTempo(o) {
  const lRef = FPS * 60 / 120, minL = Math.floor(FPS * 60 / 200), maxL = Math.ceil(FPS * 60 / 60);
  const top = Math.min(2 * maxL + 2, o.length - 1), ac = new Float32Array(top + 1);
  for (let l = minL; l <= top; l++) { let s = 0; for (let i = l; i < o.length; i++) s += o[i] * o[i - l]; ac[l] = s / (o.length - l); }
  let best = minL, bestS = -1; const score = new Float32Array(maxL + 1);
  for (let l = minL; l <= maxL; l++) {
    const w = Math.exp(-.5 * (Math.log2(l / lRef) / .9) ** 2);
    score[l] = w * (ac[l] + .5 * (ac[2 * l] || 0) + .25 * (ac[Math.round(l / 2)] || 0));
    if (score[l] > bestS) { bestS = score[l]; best = l; }
  }
  const a = score[best - 1] || 0, b = score[best], c = score[best + 1] || 0, den = a - 2 * b + c;
  const lf = best + (den ? .5 * (a - c) / den : 0);
  const avg = mean(score.slice(minL));
  return { period: lf, confidence: avg ? bestS / avg : 0 };
}

function trackBeats(o, P, tight = 100) {
  const n = o.length, sc = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(P / 2), hi = Math.round(2 * P);
  for (let t = 0; t < n; t++) {
    let bestV = -Infinity, bestI = -1;
    for (let prev = t - hi; prev <= t - lo; prev++) {
      if (prev < 0) continue;
      const v = sc[prev] - tight * Math.log((t - prev) / P) ** 2;
      if (v > bestV) { bestV = v; bestI = prev; }
    }
    if (bestI >= 0 && bestV > 0) { sc[t] = o[t] + bestV; back[t] = bestI; } else sc[t] = o[t];
  }
  let end = n - 1, endV = -Infinity;
  for (let t = Math.max(0, n - Math.round(P)); t < n; t++) if (sc[t] > endV) { endV = sc[t]; end = t; }
  const beats = []; for (let t = end; t >= 0; t = back[t]) beats.push(t);
  return beats.reverse();
}

async function analyze(arrayBuffer, onProgress = () => {}) {
  onProgress('Decoding audio…', .05); await tick();
  const buf = await GS.decode(arrayBuffer.slice(0));
  onProgress('Splitting bass and treble…', .2); await tick();
  const [low, high, full] = await renderBands(buf);
  onProgress('Listening for drum hits…', .45); await tick();
  const eLow = frameEnergy(low), eHigh = frameEnergy(high), eFull = frameEnergy(full);
  const oLow = onsetCurve(eLow), oHigh = onsetCurve(eHigh), oFull = onsetCurve(eFull);
  const n = eFull.length, o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = 1.2 * oLow[i] + .8 * oHigh[i] + oFull[i];
  // remove slow drift so quiet and loud passages count equally
  const k = 16, ma = new Float32Array(n); let run = 0;
  for (let i = 0; i < n; i++) { run += o[i]; if (i >= k) run -= o[i - k]; ma[i] = run / Math.min(i + 1, k); }
  for (let i = 0; i < n; i++) o[i] = Math.max(0, o[i] - ma[i]);
  const so = std(o); for (let i = 0; i < n; i++) o[i] /= so;

  onProgress('Finding the tempo…', .6); await tick();
  const { period, confidence } = estimateTempo(o);
  onProgress('Placing every beat…', .72); await tick();
  const frames = trackBeats(o, period);
  const toT = f => (f * HOP + WIN / 2) / SR;
  let beats = frames.map(toT);

  // median beat length, then fold to a comfortable dancing tempo (80–160 BPM)
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || .5; };
  const diffs = () => beats.slice(1).map((b, i) => b - beats[i]);
  let ibi = med(diffs());
  if (60 / ibi > 160) { // too fast: keep every other beat, on the stronger phase
    const kick = f => oLow[f] || 0;
    const s0 = frames.filter((_, i) => i % 2 === 0).reduce((a, f) => a + kick(f), 0);
    const s1 = frames.filter((_, i) => i % 2 === 1).reduce((a, f) => a + kick(f), 0);
    beats = beats.filter((_, i) => i % 2 === (s0 >= s1 ? 0 : 1)); ibi = med(diffs());
  } else if (60 / ibi < 80) { // too slow: add half-beats
    const out = []; beats.forEach((b, i) => { out.push(b); if (i < beats.length - 1) out.push((b + beats[i + 1]) / 2); }); beats = out; ibi = med(diffs());
  }
  // extend the grid to cover the whole track
  while (beats.length && beats[0] - ibi >= 0) beats.unshift(beats[0] - ibi);
  while (beats.length && beats[beats.length - 1] + ibi < buf.duration) beats.push(beats[beats.length - 1] + ibi);

  onProgress('Finding bar lines…', .82); await tick();
  const kickAt = t => { const f = Math.round((t * SR - WIN / 2) / HOP); let m = 0; for (let j = f - 2; j <= f + 2; j++) m = Math.max(m, oLow[j] || 0); return m; };
  const phase = [0, 0, 0, 0]; beats.forEach((b, i) => { phase[i % 4] += kickAt(b); });
  // bar 1 lands where the kick is strongest; ties go to the earliest
  const downbeat = phase.indexOf(Math.max(...phase));

  onProgress('Measuring the energy…', .9); await tick();
  // loudness of every beat (bass counts double); bars are summed from this so the bar start can shift later
  const energy = beats.map((b, i) => {
    const a = Math.floor(b * FPS), z = Math.floor((beats[i + 1] ?? buf.duration) * FPS);
    let s = 0, c = 0; for (let f = a; f < Math.min(z, n); f++) { s += eFull[f] + 2 * eLow[f]; c++; }
    return c ? Math.sqrt(s / c) : 0;
  });
  const sorted = [...energy].sort((x, y) => x - y), p95 = sorted[Math.floor(sorted.length * .95)] || 1;
  const norm = energy.map(v => Math.round(Math.min(1, v / p95) * 100) / 100);

  // tempo for display: straight-line fit through all the beats (more precise than one gap)
  const nb_ = beats.length, xm = (nb_ - 1) / 2, ym = beats.reduce((a, b) => a + b, 0) / nb_;
  let sxy = 0, sxx = 0; beats.forEach((b, i) => { sxy += (i - xm) * (b - ym); sxx += (i - xm) ** 2; });
  if (sxx > 0) ibi = sxy / sxx;
  onProgress('Done', 1);
  return {
    duration: Math.round(buf.duration * 1000) / 1000,
    bpm: Math.round(60 / ibi * 10) / 10,
    beats: beats.map(b => Math.round(b * 1000) / 1000),
    downbeat, energy: norm, confidence: Math.round(confidence * 100) / 100
  };
}

/* ---------- choreography ---------- */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const POOLS = {
  0: ['hula', 'point', 'robot', 'wave', 'clap'],
  1: ['clap', 'stomp', 'robot', 'point', 'hula', 'wave'],
  2: ['star', 'punch', 'windmill', 'wave', 'clap', 'stomp']
};

function generate(an, seed = Date.now() % 100000) {
  const r = rng(seed), pick = a => a[Math.floor(r() * a.length)];
  const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const BE = an.energy || [], db = an.downbeat || 0, nb = Math.floor(((an.beats?.length || 0) - db) / 4);
  if (nb < 1) return [];
  const E = []; for (let k = 0; k < nb; k++) { let s = 0; for (let j = 0; j < 4; j++) s += BE[db + 4 * k + j] || 0; E.push(s / 4); }
  // two-bar phrases, each rated calm / groove / party by how loud it is compared with the rest of the song
  const nP = Math.ceil(nb / 2), pe = [];
  for (let p = 0; p < nP; p++) pe.push((E[2 * p] + (E[2 * p + 1] ?? E[2 * p])) / 2);
  const sorted = [...pe].sort((a, b) => a - b), rank = v => sorted.indexOf(v) / Math.max(1, sorted.length - 1);
  // loudness sets the level; if a song is one flat volume all the way through, split it by rank instead so it still has variety
  let lv = pe.map(v => v >= .82 ? 2 : v >= .55 ? 1 : 0);
  if (nP > 8 && new Set(lv).size === 1) lv = pe.map(v => { const q = rank(v); return q < .3 ? 0 : q < .68 ? 1 : 2; });
  lv = lv.map((v, i) => [lv[i - 1] ?? v, v, lv[i + 1] ?? v].sort()[1]); // smooth out one-off blips

  const pattern = { 0: shuffle(POOLS[0]).slice(0, 4), 1: shuffle(POOLS[1]).slice(0, 4), 2: shuffle(POOLS[2]).slice(0, 4) };
  const bars = new Array(nb);
  let counter = { 0: 0, 1: 0, 2: 0 }, prevL = -1;
  for (let p = 0; p < nP; p++) {
    const L = lv[p]; if (L !== prevL) counter[L] = 0;
    const m = pattern[L][counter[L]++ % 4];
    const first = L !== prevL;
    for (const b of [2 * p, 2 * p + 1]) if (b < nb) bars[b] = { m, l: L };
    if (first || counter[L] <= 4) bars[2 * p].p = pick(GS.MOVES[m].say);
    prevL = L;
  }
  // opening: a sway then the 3-2-1 countdown
  if (nb > 8) { bars[0] = { m: 'sway', l: 0, p: 'Get ready to dance!' }; bars[1] = { m: 'count', l: 0 }; }
  // freezes: the bar just before the music lifts into a party section
  const freezes = [];
  for (let p = 3; p < nP - 2; p++) if (lv[p] === 2 && lv[p - 1] < 2) freezes.push(2 * p - 1);
  const chosen = [];
  for (const f of freezes) if (!chosen.length || f - chosen[chosen.length - 1] >= 24) chosen.push(f);
  if (!chosen.length && nb > 24) chosen.push(2 * Math.round(nb * .55 / 2) - 1);
  chosen.slice(0, 3).forEach(b => { if (bars[b]) bars[b] = { m: 'freeze', l: bars[b].l, p: pick(GS.MOVES.freeze.say) }; });
  // make sure the next section announces itself after a freeze
  chosen.forEach(b => { if (bars[b + 1] && !bars[b + 1].p) bars[b + 1].p = pick(GS.MOVES[bars[b + 1].m].say); });
  bars[nb - 1] = { m: 'final', l: 2, p: 'BIG FINISH!' };
  return bars;
}

window.GSAnalyze = { analyze, generate };
})();
