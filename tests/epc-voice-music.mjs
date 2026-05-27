// EPC Voice + Background Music Separation Test
import { writeFileSync } from 'fs';

const sr = 24000;

// ===== Codebook (copy) =====
const NOTES = 128, VELS = 32, E = NOTES * VELS, H = 8;
const cb = [];
for (let i = 0; i < E; i++) {
  const n = Math.floor(i / VELS), v = i % VELS, f = 440 * Math.pow(2, (n - 69) / 12), b = v / (VELS - 1);
  let d = f / 2000 + (1 - b) * 0.3; d = Math.max(0.05, Math.min(2, d));
  const h = [];
  for (let hh = 0; hh < H; hh++) h.push(Math.round(Math.max(0, Math.min(255, Math.exp(-hh * d) * (1 + b * 0.5) * 255))));
  cb.push(h);
}
function nearest(t) { let bi = 0, bd = 1/0; for (let i = 0; i < E; i++) { let d = 0; for (let h = 0; h < H; h++) { const dd = cb[i][h] - t[h]; d += dd * dd; } if (d < bd) { bd = d; bi = i; if (d === 0) break; } } return bi; }

// ===== FFT + HPS =====
function fft(r, i) {
  const n = r.length;
  for (let j = 0, b = n >> 1, p = 1; p < n; p++) { let bt = n >> 1; for (; j & bt; bt >>= 1) j ^= bt; j ^= bt; if (p < j) { [r[p], r[j]] = [r[j], r[p]]; [i[p], i[j]] = [i[j], i[p]]; } }
  for (let l = 2; l <= n; l <<= 1) {
    const a = 2 * Math.PI / l, wR = Math.cos(a), wI = -Math.sin(a);
    for (let s = 0; s < n; s += l) { let cR = 1, cI = 0; for (let j = 0; j < l / 2; j++) { const uR = r[s + j], uI = i[s + j], vR = r[s + j + l / 2] * cR - i[s + j + l / 2] * cI, vI = r[s + j + l / 2] * cI + i[s + j + l / 2] * cR; r[s + j] = uR + vR; i[s + j] = uI + vI; r[s + j + l / 2] = uR - vR; i[s + j + l / 2] = uI - vI; const tR = cR * wR - cI * wI; cI = cR * wI + cI * wR; cR = tR; } }
  }
}
function hpsMf0(s, sr) {
  const n = 2048, hn = n >> 1, r = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))); if (i < s.length) r[i] = s[i] * w; }
  fft(r, im);
  const mag = new Float64Array(hn); for (let i = 0; i < hn; i++) mag[i] = Math.sqrt(r[i] * r[i] + im[i] * im[i]);
  const hp = new Float64Array(hn); for (let i = 0; i < hn; i++) { let p = mag[i]; if (p < 1) continue; for (let h = 2; h <= 4; h++) { const idx = Math.round(i * h); if (idx >= hn) break; p *= mag[idx]; } hp[i] = p; }
  const mn = Math.round(hn * 40 / sr), mx = Math.round(hn * 1500 / sr);
  const pk = []; for (let i = mn + 1; i < mx - 1; i++) { if (hp[i] > hp[i - 1] && hp[i] > hp[i + 1] && hp[i] > 0) pk.push({ bin: i, val: hp[i], freq: i * sr / n }); }
  pk.sort((a, b) => b.val - a.val);
  const res = [];
  for (const p of pk) { const dup = res.some(r => { const rt = p.freq > r.freq ? p.freq / r.freq : r.freq / p.freq; return Math.abs(rt - Math.round(rt)) < 0.08; }); if (!dup) { res.push({ freq: p.freq, corr: Math.min(1, p.val / (pk[0]?.val || 1)) }); if (res.length >= 3) break; } }
  return res;
}
function anaWin(s, sr) {
  const n = s.length, cs = n >= 2048 ? hpsMf0(s, sr) : [];
  const tones = [];
  for (const p of cs) {
    const f0 = p.freq; const raw = [];
    for (let h = 0; h < 8; h++) {
      const hz = f0 * (h + 1), bin = Math.round(hz * n / sr);
      if (bin < 1 || bin >= n / 2) { raw.push(0); continue; }
      let cR = 0, cI = 0;
      const lim = Math.min(s.length, n); for (let i = 0; i < lim; i++) { const a = 2 * Math.PI * bin * i / n; cR += s[i] * Math.cos(a); cI -= s[i] * Math.sin(a); }
      raw.push(Math.sqrt(cR * cR + cI * cI) / lim * 2);
    }
    const mh = Math.max(...raw, 1);
    const harms = raw.map(a => Math.round(Math.max(0, Math.min(255, a / mh * 255))));
    const sigRms = Math.sqrt(s.slice(0, Math.min(480, s.length)).reduce((s,v) => s+v*v, 0) / Math.min(480, s.length));
    tones.push({ f0, confidence: p.corr, harmonics: harms, rms: Math.round(Math.min(255, sigRms / 32768 * 255)) });
  }
  return tones;
}
function qc(s, lag, half) { let c = 0, n = 0; for (let i = 0; i < half; i++) { c += s[i] * s[i + lag]; n += s[i] * s[i] + s[i + lag] * s[i + lag]; } return n > 0 ? c / Math.sqrt(n) : 0; }

// ===== EPC Pack =====
function pkE(t) { const b = Buffer.alloc(12); b[0]=0x02; b[1]=(t.trackId<<4)&0xF0; b[2]=(t.cbIdx>>4)&0xFF; b[3]=((t.cbIdx&0xF)<<4)&0xF0; b[4]=((t.midiNote&0x7F)<<1)|(t.onsetFlag&1); b[5]=((t.cent+32)<<2)&0xFC; b[6]=(t.velocity<<1)&0xFE; b[7]=t.rms; return b; }
function unE(buf) { return { trackId:(buf[1]>>4)&0xF, cbIdx:(buf[2]<<4)|((buf[3]>>4)&0xF), midiNote:(buf[4]>>1)&0x7F, onsetFlag:buf[4]&1, cent:((buf[5]>>2)&0x3F)-32, velocity:(buf[6]>>1)&0x7F, rms:buf[7], harmonics:cb[(buf[2]<<4)|((buf[3]>>4)&0xF)] }; }
function pRF(eb) { const d = Buffer.concat(eb); const pl = d.length; const f = Buffer.alloc(7 + pl); let o = 0; f[o++] = 0xBB; f[o++] = 0x01; f[o++] = 0xCC; f[o++] = (pl >> 8) & 0xFF; f[o++] = pl & 0xFF; d.copy(f, o); o += pl; let ck = 0; for (let i = 1; i < o; i++) ck = (ck + f[i]) & 0xFF; f[o++] = ck; f[o++] = 0x7E; return f; }

// ===== Generate: Male voice "你好今天天气真好" + Background pop =====
const durSec = 3;
const totalS = sr * durSec;
const pcm = Buffer.alloc(totalS * 2);

// Voice syllables: each syllable has a F0 contour (n:midiNote, t:time, dur:seconds)
const voice = [
  // 你 (nǐ)
  { t: 0.10, dur: 0.30, f0Start: 180, f0End: 210, amp: 0.6 },
  // 好 (hǎo) 
  { t: 0.40, dur: 0.35, f0Start: 220, f0End: 180, amp: 0.5 },
  // 今 (jīn)
  { t: 0.85, dur: 0.25, f0Start: 190, f0End: 205, amp: 0.5 },
  // 天 (tiān)
  { t: 1.15, dur: 0.30, f0Start: 210, f0End: 195, amp: 0.45 },
  // 天 (tiān, second)
  { t: 1.50, dur: 0.15, f0Start: 195, f0End: 200, amp: 0.4 },
  // 气 (qì)
  { t: 1.70, dur: 0.25, f0Start: 200, f0End: 170, amp: 0.5 },
  // 真 (zhēn)
  { t: 2.10, dur: 0.25, f0Start: 185, f0End: 210, amp: 0.55 },
  // 好 (hǎo, second)
  { t: 2.45, dur: 0.40, f0Start: 210, f0End: 150, amp: 0.5 },
];

// Generate voice with formants (simple: F1=800Hz, F2=1600Hz)
for (const v of voice) {
  const startS = Math.round(v.t * sr);
  const durS = Math.round(v.dur * sr);
  for (let i = 0; i < durS && startS + i < totalS; i++) {
    const ratio = i / durS;
    const f0 = v.f0Start + (v.f0End - v.f0Start) * ratio;
    const env = Math.min(1, i / (sr * 0.02)) * Math.min(1, (durS - i) / (sr * 0.03));
    // Voice: F0 + harmonics 2-8, weighted by formants at 800Hz and 1600Hz
    let val = 0;
    for (let h = 1; h <= 8; h++) {
      const hz = f0 * h;
      // Formant filter: peak at 800Hz, secondary peak at 1600Hz
      const f1W = 1 - Math.min(1, Math.abs(hz - 800) / 400);
      const f2W = 0.5 - Math.min(0.5, Math.abs(hz - 1600) / 800);
      const weight = Math.max(0, f1W) + Math.max(0, f2W);
      if (weight < 0.01) continue;
      // Natural vibrato
      const vib = Math.sin(2 * Math.PI * 5 * (v.t + ratio * v.dur)) * 2;
      const ff = f0 * h + vib;
      val += Math.sin(2 * Math.PI * ff * (startS + i) / sr) * weight;
    }
    val *= env * v.amp;
    const idx = (startS + i) * 2;
    const clipped = Math.max(-32768, Math.min(32767, Math.round(val * 32768)));
    const existing = pcm.readInt16LE(idx);
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, existing + clipped)), idx);
  }
}

// Background pop music: C-F-G-C progression (soft pads)
const chords = [
  { notes: [60, 64, 67], t: 0.00, dur: 0.8 },  // C
  { notes: [65, 69, 72], t: 0.80, dur: 0.8 },  // F
  { notes: [67, 71, 74], t: 1.60, dur: 0.7 },  // G
  { notes: [60, 64, 67], t: 2.30, dur: 0.7 },  // C
];
// + guitar-like rhythm: strummed chords on 8th note
const strums = [];
for (let t = 0; t < durSec; t += 0.25) {
  const ch = chords.find(c => t >= c.t && t < c.t + c.dur);
  if (ch) strums.push({ notes: ch.notes, t: t, dur: 0.12, amp: 0.15 });
}

for (const st of strums) {
  const startS = Math.round(st.t * sr);
  const durS = Math.round(st.dur * sr);
  for (const note of st.notes) {
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    for (let i = 0; i < durS && startS + i < totalS; i++) {
      const env = Math.exp(-i / (sr * 0.03)); // fast decay like guitar
      let val = 0;
      for (let h = 1; h <= 5; h++) {
        val += Math.sin(2 * Math.PI * freq * h * (startS + i) / sr) * (1 / h) * 0.5;
      }
      val *= env * st.amp;
      const idx = (startS + i) * 2;
      const clipped = Math.max(-32768, Math.min(32767, Math.round(val * 32768)));
      const existing = pcm.readInt16LE(idx);
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, existing + clipped)), idx);
    }
  }
}

// + sustained pad (synth string)
for (const ch of chords) {
  const startS = Math.round(ch.t * sr);
  const durS = Math.round(ch.dur * sr);
  for (const note of ch.notes) {
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    for (let i = 0; i < durS && startS + i < totalS; i++) {
      const env = Math.min(1, i / (sr * 0.05)) * Math.min(1, (durS - i) / (sr * 0.05));
      let val = 0;
      for (let h = 1; h <= 4; h++) {
        val += Math.sin(2 * Math.PI * freq * h * (startS + i) / sr) * (1 / h) * 0.3;
      }
      val *= env * 0.12;
      const idx = (startS + i) * 2;
      const clipped = Math.max(-32768, Math.min(32767, Math.round(val * 32768)));
      const existing = pcm.readInt16LE(idx);
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, existing + clipped)), idx);
    }
  }
}

writeWav('test_voice_input.wav', pcm, sr);

// ===== Encode =====
const fsZ = sr * 20 / 1000, fB = fsZ * 2, hf = fsZ >> 1;
const ab = [], at = new Map(), rf = [];
let nt = 0, fc = 0;

for (let off = 0; off + fB <= pcm.length; off += fB) {
  const sm = [];
  for (let i = 0; i < fsZ; i++) { const v = pcm.readInt16LE(off + i * 2); sm.push(v); ab.push(v); }
  if (ab.length > 2048) ab.splice(0, ab.length - 2048);
  const fe = [], tr = [];

  for (const [tid, t] of at) {
    const corr = qc(sm, Math.round(sr / t.freq), hf);
    if (corr > 0.3) {
      t.stale = 0;
      const srms = Math.sqrt(sm.reduce((s,v) => s+v*v, 0) / sm.length);
      fe.push(pkE({ trackId: tid, cbIdx: t.cbIdx, midiNote: t.note, cent: t.cent, onsetFlag: 0, velocity: Math.round(corr * 127), rms: Math.round(Math.min(255, srms / 32768 * 255)) }));
    } else { t.stale++; if (t.stale > 3) { tr.push(tid); fe.push(pkE({ trackId: tid, cbIdx: 0, midiNote: 0, cent: 0, onsetFlag: 2, velocity: 0, rms: 0 })); } }
  }
  for (const tid of tr) at.delete(tid);

  const hasA = ab.length >= 2048;
  const cn = hasA ? (fc % 4 === 0) : (fc === 0);
  if (cn) {
    const src = hasA ? ab : sm;
    const tones = anaWin(src, sr);
    const valid = tones.filter(t => qc(sm, Math.round(sr / t.f0), hf) > 0.3);
    for (const t of valid) {
      const dup = [...at.values()].some(a => { const r = t.f0 > a.freq ? t.f0 / a.freq : a.freq / t.f0; return Math.abs(r - Math.round(r)) < 0.05; });
      if (dup) continue;
      const cbIdx = nearest(t.harmonics);
      const midi = 12 * Math.log(t.f0 / 440) / Math.log(2) + 69;
      const note = Math.max(0, Math.min(127, Math.round(midi)));
      const tid = nt % 15;
      at.set(tid, { freq: t.f0, lag: Math.round(sr / t.f0), cbIdx, note, cent: Math.round((midi - note) * 100), stale: 0 });
      fe.push(pkE({ trackId: tid, cbIdx, midiNote: note, cent: Math.max(-32, Math.min(31, Math.round((midi - note) * 100))), onsetFlag: 1, velocity: Math.round(t.confidence * 127), rms: t.rms }));
      nt++;
    }
  }

  rf.push(pRF(fe)); fc++;
}

const epc = Buffer.concat(rf);
console.log(`Encode: ${epc.length}B -> ${(epc.length / durSec).toFixed(0)} B/s (${(epc.length * 8 / 1000 / durSec).toFixed(1)} kbps)`);

// ===== Decode =====
const po = []; const a2 = new Map(); let o2 = 0;
while (o2 + 7 <= epc.length) {
  if (epc[o2] !== 0xBB) break;
  const dl = (epc[o2 + 3] << 8) | epc[o2 + 4], fl = 7 + dl;
  for (let eo = o2 + 5; eo < o2 + 5 + dl; eo += 12) {
    const t = unE(epc.slice(eo, eo + 12));
    if (t.onsetFlag === 2) { a2.delete(t.trackId); continue; }
    const freq = 440 * Math.pow(2, (t.midiNote + t.cent / 100 - 69) / 12);
    if (t.rms > 0) a2.set(t.trackId, { freq, harmonics: t.harmonics, rms: t.rms, vel: t.velocity });
  }
  const buf = Buffer.alloc(fsZ * 2);
  for (let i = 0; i < fsZ; i++) {
    let s = 0;
    for (const tn of a2.values()) {
      const amp = tn.rms / 255; let hs = 0; for (let h = 0; h < 8; h++) hs += tn.harmonics[h] * tn.harmonics[h];
      const pr = Math.sqrt(hs / 8) / 255; const g = pr > 0 ? amp * 1.414 / pr : 0;
      for (let h = 0; h < 8; h++) { if (tn.harmonics[h] / 255 < 0.01) continue; s += Math.sin(2 * Math.PI * tn.freq * (h + 1) * i / sr) * g * tn.harmonics[h] / 255 * 32768; }
    }
    const cl = Math.max(-32768, Math.min(32767, Math.round(s)));
    buf.writeInt16LE(cl, i * 2);
  }
  po.push(buf); o2 += fl;
}
const op = Buffer.concat(po);
writeWav('test_voice_output.wav', op, sr);

// ===== Score =====
console.log('\n=== Voice + Music Test ===\n');
console.log('Original Voice (F0 contour):');
for (const v of voice) console.log(`  ${v.t.toFixed(2)}s-${(v.t+v.dur).toFixed(2)}s  ${v.f0Start}Hz→${v.f0End}Hz`);

console.log('\nOriginal Music (Chords):');
for (const ch of chords) {
  const ns = ch.notes.map(n => (['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n % 12] + Math.floor(n / 12 - 1)));
  console.log(`  ${ch.t.toFixed(2)}s-${(ch.t+ch.dur).toFixed(2)}s  ${ns.join(' ')}`);
}

console.log('\nExtracted EPC Tracks:');
let prevOn = new Map();
for (let o = 0, fi = 0; o + 7 <= epc.length; fi++) {
  const dl = (epc[o + 3] << 8) | epc[o + 4], fl = 7 + dl;
  for (let eo = o + 5; eo < o + 5 + dl; eo += 12) {
    const t = unE(epc.slice(eo, eo + 12));
    if (t.onsetFlag === 2) {
      const n = prevOn.get(t.trackId);
      if (n) console.log(`  ${n.t}s-${(fi*20/1e3).toFixed(2)}s  Track#${t.trackId} Note ${n.name} (${n.f}Hz)  OFF`);
      prevOn.delete(t.trackId);
    }
    if (t.onsetFlag === 1) {
      const name = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][t.midiNote % 12] + Math.floor(t.midiNote / 12 - 1);
      const fHz = Math.round(440 * Math.pow(2, (t.midiNote + t.cent / 100 - 69) / 12));
      prevOn.set(t.trackId, { t: (fi*20/1e3).toFixed(2), name, f: fHz });
      const inVoice = voice.some(v => fi*20/1e3 >= v.t - 0.1 && fi*20/1e3 <= v.t + v.dur + 0.1 && Math.abs(fHz - (v.f0Start+v.f0End)/2) < 80);
      const inChord = chords.some(ch => fi*20/1e3 >= ch.t - 0.1 && fi*20/1e3 <= ch.t + ch.dur + 0.1 && ch.notes.some(n => Math.abs(12*Math.log(fHz/(440*Math.pow(2,(n-69)/12)))/Math.log(2)) < 1));
      console.log(`  ${(fi*20/1e3).toFixed(2)}s  ON  Track#${t.trackId} ${name} (${fHz}Hz) rms=${t.rms}  ${inVoice ? '← voice' : inChord ? '← music' : '?'}`);
    }
  }
  o += fl;
}

console.log(`\nTotal EPC tags: ${Math.floor(epc.length / 12)}`);

function writeWav(path, pcm, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([h, pcm]));
  console.log(`  saved ${path}`);
}
