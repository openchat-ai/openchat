// calibrate_lmdn2.mjs — 逐轨 F1 对比（原始 vs LPC+MDCT→NNLS）
import fs from 'fs';
import { parseMidi } from 'midi-file';
import LpcMdctCodec from '../bridge/src/core/audio/lmdn-codec.mjs';

const SR = 48000, HOP = 1024, FS = 2048, HALF = FS >> 1, NM = 21, NX = 108, NC = 88;

function f2m(f) { return 12 * Math.log2(f / 440) + 69; }

const win = new Float64Array(FS); for (let i = 0; i < FS; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FS));
const dict = new Array(HALF); for (let b = 0; b < HALF; b++) dict[b] = new Float64Array(NC);
for (let ni = 0; ni < NC; ni++) {
  const f = 440 * Math.pow(2, (NM + ni - 69) / 12);
  for (let h = 1; h <= 10; h++) { const hf = f * h; if (hf > SR / 2) break; const b = Math.round(hf * FS / SR); if (b >= 0 && b < HALF) dict[b][ni] += Math.pow(h, -1); }
}
for (let ni = 0; ni < NC; ni++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][ni] ** 2; const n = Math.sqrt(s) || 1; for (let b = 0; b < HALF; b++) dict[b][ni] /= n; }
const Hm = new Array(NC); for (let i = 0; i < NC; i++) { Hm[i] = new Float64Array(NC); for (let j = 0; j < NC; j++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * dict[b][j]; Hm[i][j] = s; } }
const _re = new Float64Array(FS), _im = new Float64Array(FS), _g = new Float64Array(NC), _Hx = new Float64Array(NC);

function fft() {
  for (let i = 1, j = 0; i < FS; i++) { let b = FS >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [_re[i], _re[j]] = [_re[j], _re[i]]; [_im[i], _im[j]] = [_im[j], _im[i]]; } }
  for (let l = 2; l <= FS; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < FS; i += l) for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * _re[v] - wi * _im[v], ti = wr * _im[v] + wi * _re[v]; _re[v] = _re[u] - tr; _im[v] = _im[u] - ti; _re[u] += tr; _im[u] += ti; } }
}
function nnlsFrame(mag) {
  for (let i = 0; i < NC; i++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * mag[b]; _g[i] = Math.max(s, 1e-12); }
  const x = new Float64Array(NC); for (let i = 0; i < NC; i++) x[i] = 1e-4;
  for (let it = 0; it < 50; it++) { for (let i = 0; i < NC; i++) { let s = 0; for (let j = 0; j < NC; j++) s += Hm[i][j] * x[j]; _Hx[i] = Math.max(s, 1e-12); } let ch = 0; for (let i = 0; i < NC; i++) { const nv = x[i] * _g[i] / _Hx[i]; ch += Math.abs(nv - x[i]); x[i] = nv; } if (ch < 1e-8 * NC) break; }
  const notes = []; for (let ni = 0; ni < NC; ni++) if (x[ni] > 1e-6) notes.push({ ni, midi: NM + ni, act: x[ni] });
  notes.sort((a, b) => b.act - a.act); const kept = [];
  for (const n of notes) { let ih = false; for (const k of kept) { const r = 2 ** ((n.midi - k.midi) / 12); if (r > 1.8 && r < 2.2 || r > 2.8 && r < 3.2) { ih = true; break; } } if (!ih) { kept.push(n); if (kept.length >= 5) break; } }
  const maxA = kept.length ? kept[0].act : 1;
  return kept.filter(n => n.act / maxA > 0.05).map(n => ({ f: Math.round(440 * 2 ** ((n.midi - 69) / 12) * 10) / 10, m: n.midi, c: Math.min(1, n.act / maxA) }));
}

function detectBand(sig, minF, maxF, minC) {
  const tf = Math.floor((sig.length - FS) / HOP) + 1; const raw = [];
  for (let fi = 0; fi < tf; fi++) {
    const fr = sig.subarray(fi * HOP, fi * HOP + FS);
    for (let i = 0; i < FS; i++) { _re[i] = fr[i] * win[i]; _im[i] = 0; } fft();
    const mag = new Float64Array(HALF); for (let i = 0; i < HALF; i++) mag[i] = Math.sqrt(_re[i] ** 2 + _im[i] ** 2);
    for (const d of nnlsFrame(mag)) if (d.f > minF && d.f < maxF && d.c > minC) raw.push({ t: fi * HOP / SR, m: d.m, c: d.c });
  }
  const act = {}, out = [];
  for (const n of raw) { const r = Math.round(n.m); if (act[r]) { if (n.t - act[r].l > 0.05) { const d = act[r].l - act[r].s; if (d > 0.04) out.push({ m: r, s: act[r].s, c: act[r].c }); act[r] = { c: n.c, s: n.t, l: n.t, cnt: 1 }; } else { act[r].c = Math.max(act[r].c, n.c); act[r].l = n.t; act[r].cnt++; } } else { act[r] = { c: n.c, s: n.t, l: n.t, cnt: 1 }; } }
  for (const [r, a] of Object.entries(act)) { const d = a.l - a.s; if (a.cnt >= 2 && d > 0.04) out.push({ m: parseInt(r), s: a.s, c: a.c }); }
  return out.sort((a, b) => a.s - b.s);
}

function highpass(sig, fc) { const a = 1 - 2 * Math.PI * fc / SR; const o = new Float64Array(sig.length); let y = 0; for (let i = 1; i < sig.length; i++) { y = sig[i] - sig[i - 1] + a * y; o[i] = y; } return o; }
function lowpass(sig, fc) { const o = new Float64Array(sig.length); let y = 0; for (let i = 0; i < sig.length; i++) { y = y * fc + sig[i] * (1 - fc); o[i] = y; } return o; }
function highpassBass(sig) { const o = highpass(sig, 40); return lowpass(o, 0.996); }

function detectFull(sig, band) {
  const chunkS = 10 * SR, nChunks = Math.ceil(sig.length / chunkS);
  const all = [];
  const opt = band === 'high' ? { minF: 80, maxF: 1500, minC: 0.15 } : { minF: 40, maxF: 180, minC: 0.1 };
  for (let ci = 0; ci < nChunks; ci++) {
    if (nChunks > 1) process.stdout.write(`\r  ${ci+1}/${nChunks}`);
    const st = ci * chunkS, en = Math.min(sig.length, st + chunkS);
    const sig2 = sig.subarray(st, en);
    const input = band === 'high' ? highpass(sig2, 200) : highpassBass(sig2);
    for (const n of detectBand(input, opt.minF, opt.maxF, opt.minC)) { n.s += ci * 10; all.push(n); }
  }
  return all;
}

// 匹配：把 GT 分组再分别 match
function match(det, gtNotes) {
  const det2 = det.map(d => ({ ...d }));
  let tp = 0, matched = new Set();
  det2.sort((a, b) => b.c - a.c);
  for (const d of det2) { let found = false; for (let gi = 0; gi < gtNotes.length; gi++) { if (matched.has(gi)) continue; const g = gtNotes[gi]; if (Math.abs(d.s - g.time) < 0.15 && Math.abs(d.m - g.midi) < 1.5) { tp++; matched.add(gi); found = true; break; } } }
  return { tp, fp: det.length - tp, fn: gtNotes.length - matched.size, det: det.length, gt: gtNotes.length };
}

// === MIDI GT 分轨 ===
console.log('加载 MIDI GT...');
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;
const trackNames = [];
const trackNotes = [];
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, notes = [];
  const tn = track.find(e => e.type === 'trackName');
  trackNames.push(tn?.text || `Track${ti}`);
  for (const e of track) { tick += e.deltaTime || 0; const sec = tick / ppq * spb; if (sec > 432) break; if (e.type === 'noteOn' && e.velocity > 0) { notes.push({ time: sec, midi: e.noteNumber, vel: e.velocity }); } }
  trackNotes.push(notes);
}
console.log(`Tracks: ${trackNames.map((n,i)=>`${i+1})${n}=${trackNotes[i].length}`).join(', ')}`);

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const totalFrames = Math.floor((buf.length - dataOff) / 4);
const mono = new Float64Array(totalFrames);
for (let i = 0; i < totalFrames; i++) { const idx = i * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

// === 对比 ===
for (const label of ['原始 NNLS', 'LPC+MDCT→NNLS']) {
  const isCodec = label.startsWith('LPC');
  console.log(`\n=== ${label} ===`);
  const t0 = Date.now();
  let sig = mono;

  if (isCodec) {
    console.log('  LPC+MDCT 编解码...');
    const codec = new LpcMdctCodec(); await codec.initialize();
    const pcmBuf = Buffer.alloc(mono.length * 2); for (let i = 0; i < mono.length; i++) pcmBuf.writeInt16LE(Math.round(mono[i] * 32768), i * 2);
    const enc = await codec.encode(pcmBuf);
    const dec = await codec.decode(enc.data);
    const rlen = Math.floor(dec.pcm.length / 2); sig = new Float64Array(rlen);
    for (let i = 0; i < rlen; i++) sig[i] = dec.pcm.readInt16LE(i * 2) / 32768;
  }

  const gNotes = detectFull(sig, 'high');
  const bNotes = detectFull(sig, 'low');
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\n  高:${gNotes.length} 低:${bNotes.length} (${elapsed.toFixed(0)}s)`);

  // 每轨分别 match
  for (let ti = 0; ti < trackNotes.length; ti++) {
    const n = trackNotes[ti];
    if (n.length === 0) continue;
    // 吉他轨（1-3）用高频道，贝斯轨（4）用低频道，第5轨用高频
    const det = ti === 3 ? bNotes : gNotes;
    const r = match(det, n);
    const p = r.tp / (r.tp + r.fp) || 0, re = r.tp / (r.tp + r.fn) || 0;
    const f1 = 2 * p * re / (p + re || 1) * 100;
    console.log(`  ${trackNames[ti]}: P=${(p*100).toFixed(1)}% R=${(re*100).toFixed(1)}% F1=${f1.toFixed(1)}% (TP=${r.tp} FP=${r.fp} FN=${r.fn} DET=${r.det} GT=${r.gt})`);
  }
}
