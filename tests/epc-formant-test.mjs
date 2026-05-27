// EPC roundtrip + formant filter comparison
import { writeFileSync } from 'fs';

const sr = 24000;
// ===== Codebook =====
const NOTES = 128, VELS = 32, E = NOTES * VELS;
const cb = [];
for (let i = 0; i < E; i++) {
  const n = Math.floor(i / VELS), v = i % VELS, f = 440 * Math.pow(2, (n - 69) / 12), b = v / (VELS - 1);
  let d = f / 2000 + (1 - b) * 0.3; d = Math.max(0.05, Math.min(2, d));
  const h = [];
  for (let hh = 0; hh < 8; hh++) h.push(Math.round(Math.max(0, Math.min(255, Math.exp(-hh * d) * (1 + b * 0.5) * 255))));
  cb.push(h);
}
function nearest(t) { let bi = 0, bd = 1/0; for (let i = 0; i < E; i++) { let d = 0; for (let h = 0; h < 8; h++) { const dd = cb[i][h] - t[h]; d += dd * dd; } if (d < bd) { bd = d; bi = i; if (d === 0) break; } } return bi; }

// ===== FFT + HPS =====
function fft(r, i) {
  const n = r.length;
  for (let j = 0, b = n >> 1; b < n; b++) { let bt = n >> 1; for (; j & bt; bt >>= 1) j ^= bt; j ^= bt; if (b < j) { [r[b], r[j]] = [r[j], r[b]]; [i[b], i[j]] = [i[j], i[b]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = 2 * Math.PI / l, wR = Math.cos(a), wI = -Math.sin(a); for (let s = 0; s < n; s += l) { let cR = 1, cI = 0; for (let j = 0; j < l / 2; j++) { const uR = r[s + j], uI = i[s + j], vR = r[s + j + l / 2] * cR - i[s + j + l / 2] * cI, vI = r[s + j + l / 2] * cI + i[s + j + l / 2] * cR; r[s + j] = uR + vR; i[s + j] = uI + vI; r[s + j + l / 2] = uR - vR; i[s + j + l / 2] = uI - vI; const tR = cR * wR - cI * wI; cI = cR * wI + cI * wR; cR = tR; } } }
}
function hps(s, sr) {
  const n = 2048, hn = n >> 1, r = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n && i < s.length; i++) r[i] = s[i] * (0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))));
  fft(r, im);
  const m = new Float64Array(hn); for (let i = 0; i < hn; i++) m[i] = Math.sqrt(r[i]*r[i]+im[i]*im[i]);
  const hp = new Float64Array(hn); for (let i = 0; i < hn; i++) { let p = m[i]; if (p < 1) continue; for (let h = 2; h <= 4; h++) { const idx = Math.round(i * h); if (idx >= hn) break; p *= m[idx]; } hp[i] = p; }
  const mn = Math.round(hn * 40 / sr), mx = Math.round(hn * 1500 / sr);
  const pk = []; let mp = 0; for (let i = mn + 1; i < mx - 1; i++) { if (hp[i] > hp[i-1] && hp[i] > hp[i+1] && hp[i] > 0) { pk.push({i,v:hp[i]}); if (hp[i] > mp) mp = hp[i]; } }
  const th = mp * 0.2; const fp = pk.filter(p=>p.v>=th).sort((a,b)=>b.v-a.v);
  const res = [];
  for (const p of fp) { const dup = res.some(r => { const rt = p.i > r.i ? p.i / r.i : r.i / p.i; return Math.abs(rt - Math.round(rt)) < 0.08; }); if (!dup) { res.push({freq:p.i*sr/n,corr:Math.min(1,p.v/(fp[0]?.v||1))}); if (res.length >= 2) break; } }
  return res;
}
function ana(s, sr) {
  const cs = hps(s, sr);
  const t = []; const lim = Math.min(s.length, 2048);
  for (const p of cs) {
    const f0 = p.freq; const raw = [];
    for (let h = 0; h < 8; h++) { const hz = f0 * (h + 1); const bin = Math.round(hz * 2048 / sr); if (bin < 1 || bin >= 1024) { raw.push(0); continue; } let cR = 0, cI = 0; for (let i = 0; i < lim; i++) { const a = 2 * Math.PI * bin * i / 2048; cR += s[i] * Math.cos(a); cI -= s[i] * Math.sin(a); } raw.push(Math.sqrt(cR*cR+cI*cI)/lim*2); }
    const mh = Math.max(...raw, 1); const harms = raw.map(a => Math.round(Math.max(0, Math.min(255, a / mh * 255))));
    const rms = Math.round(Math.max(0, Math.min(255, Math.sqrt(s.slice(0,Math.min(480,s.length)).reduce((s,v)=>s+v*v,0)/Math.min(480,s.length))/32768*255)));
    t.push({f0,harms,rms,corr:p.corr});
  }
  return t;
}
function qc(s, lag) { let c = 0, n = 0; const hf = s.length >> 1; for (let i = 0; i < hf; i++) { c += s[i] * s[i + lag]; n += s[i] * s[i] + s[i + lag] * s[i + lag]; } return n > 0 ? c / Math.sqrt(n) : 0; }

// ===== Formant filter (biquad peaking) =====
function applyFormant(pcm, sr, freq, Q, gainDb) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * freq / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = 1 + alpha * A, b1 = -2 * Math.cos(w0), b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A, a1 = -2 * Math.cos(w0), a2 = 1 - alpha / A;
  const out = Buffer.alloc(pcm.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const x = pcm.readInt16LE(i);
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    const c = Math.max(-32768, Math.min(32767, Math.round(y)));
    out.writeInt16LE(c, i);
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}

// Generate more voice-like signal (sawtooth = rich harmonics)
const durSec = 2;
const nS = sr * durSec;
const pcmIn = Buffer.alloc(nS * 2);
for (let i = 0; i < nS; i++) {
  let s = 0, f0 = 200 + 50 * Math.sin(2 * Math.PI * 0.5 * i / sr); // pitch modulation
  for (let h = 1; h <= 20; h++) s += Math.sin(2 * Math.PI * f0 * h * i / sr) / h;
  s *= 0.3;
  const c = Math.max(-32768, Math.min(32767, Math.round(s * 32768)));
  pcmIn.writeInt16LE(c, i * 2);
}
writeWav('epc_formant_input.wav', pcmIn, sr);

// ===== EPC Encode =====
const fsZ = 480, fB = fsZ * 2;
const ab = [], at = new Map(), rf = [];
let nt = 0, fc = 0;
for (let off = 0; off + fB <= pcmIn.length; off += fB) {
  const sm = [];
  for (let i = 0; i < fsZ; i++) { const v = pcmIn.readInt16LE(off + i * 2); sm.push(v); ab.push(v); }
  if (ab.length > 2048) ab.splice(0, ab.length - 2048);
  const fe = [], tr = [];
  for (const [tid, t] of at) {
    const corr = qc(sm, Math.round(sr / t.f));
    if (corr > 0.3) { t.s = 0;
      const srms = Math.sqrt(sm.reduce((s,v)=>s+v*v,0)/sm.length);
      fe.push(Buffer.from([0x02,(tid<<4)&0xF0,(t.cb>>4)&0xFF,((t.cb&0xF)<<4)&0xF0,((t.n&0x7F)<<1)|0,(t.ce+32<<2)&0xFC,(t.v<<1)&0xFE,Math.round(Math.min(255,srms/32768*255)),0,0,0,0]));
    } else { t.s++; if (t.s > 3) { tr.push(tid); fe.push(Buffer.from([0x02,(tid<<4)&0xF0,0,0,0,0,0,0,0,0,0,0])); } }
  }
  for (const tid of tr) at.delete(tid);
  if (ab.length >= 2048 && fc % 4 === 0) {
    const tones = ana(ab, sr);
    for (const t of tones) {
      if (qc(sm, Math.round(sr / t.f0)) < 0.3) continue;
      const dup = [...at.values()].some(a => { const r = t.f0 > a.f ? t.f0 / a.f : a.f / t.f0; return Math.abs(r - Math.round(r)) < 0.05; });
      if (dup) continue;
      const cbIdx = nearest(t.harms);
      const midi = 12 * Math.log(t.f0 / 440) / Math.log(2) + 69;
      const note = Math.max(0, Math.min(127, Math.round(midi)));
      at.set(nt % 15, { f: t.f0, cb: cbIdx, n: note, ce: Math.round((midi - note) * 100), s: 0, v: Math.round(t.corr * 127) });
      fe.push(Buffer.from([0x02,((nt%15)<<4)&0xF0,(cbIdx>>4)&0xFF,((cbIdx&0xF)<<4)&0xF0,((note&0x7F)<<1)|1,((Math.round((midi-note)*100)+32)<<2)&0xFC,(Math.round(t.corr*127)<<1)&0xFE,t.rms,0,0,0,0]));
      nt++;
    }
  }
  const epcList = fe.length > 0 ? Buffer.concat(fe) : Buffer.alloc(0);
  const pl = epcList.length; const f = Buffer.alloc(7 + pl); let o = 0;
  f[o++] = 0xBB; f[o++] = 0x01; f[o++] = 0xCC; f[o++] = (pl >> 8) & 0xFF; f[o++] = pl & 0xFF;
  if (pl > 0) epcList.copy(f, o); o += pl;
  let ck = 0; for (let i = 1; i < o; i++) ck = (ck + f[i]) & 0xFF; f[o++] = ck; f[o++] = 0x7E;
  rf.push(f); fc++;
}
const epcData = Buffer.concat(rf);
console.log('Encoded:', epcData.length, 'bytes');

// ===== Decode (standard wavetable) =====
function decode(epcData, sr, formant) {
  const n = sr * 20 / 1000;
  const po = [], a2 = new Map();
  let o = 0;
  while (o + 7 <= epcData.length) {
    if (epcData[o] !== 0xBB) break;
    const dl = (epcData[o + 3] << 8) | epcData[o + 4], fl = 7 + dl;
    for (let eo = o + 5; eo < o + 5 + dl; eo += 12) {
      const buf = epcData.slice(eo, eo + 12);
      const tid = (buf[1] >> 4) & 0xF;
      const cbIdx = (buf[2] << 4) | ((buf[3] >> 4) & 0xF);
      const mn = (buf[4] >> 1) & 0x7F;
      const cent = ((buf[5] >> 2) & 0x3F) - 32;
      const vel = (buf[6] >> 1) & 0x7F, rms = buf[7];
      if (vel === 0 && rms === 0) { a2.delete(tid); continue; }
      const freq = 440 * Math.pow(2, (mn + cent / 100 - 69) / 12);
      a2.set(tid, { freq, harms: cb[cbIdx] || [255,166,108,70,45,29,19,12], rms, vel });
    }
    const buf = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const t of a2.values()) {
        const amp = t.rms / 255 * t.vel / 127;
        if (amp < 0.001) continue;
        // Wavetable
        const wt = new Float64Array(256);
        for (let j = 0; j < 256; j++) { let v = 0; for (let h = 0; h < 8; h++) v += Math.sin(2 * Math.PI * (h + 1) * j / 256) * t.harms[h] / 255; wt[j] = v; }
        let mv = 0; for (let j = 0; j < 256; j++) if (Math.abs(wt[j]) > mv) mv = Math.abs(wt[j]); for (let j = 0; j < 256; j++) wt[j] /= mv;
        const ph = t.freq * 256 / sr;
        const idx = Math.floor(i * ph) % 256;
        const frac = i * ph - Math.floor(i * ph);
        const next = (idx + 1) % 256;
        s += (wt[idx] * (1 - frac) + wt[next] * frac) * amp * 0.3 * 32768;
      }
      const c = Math.max(-32768, Math.min(32767, Math.round(s)));
      buf.writeInt16LE(c, i * 2);
    }
    po.push(buf);
    o += fl;
  }
  let pcm = Buffer.concat(po);
  // Apply formant filter if configured
  if (formant) pcm = applyFormant(pcm, sr, formant.freq, formant.Q, formant.gain);
  return pcm;
}

// Decode without formant (baseline)
const out1 = decode(epcData, sr, null);
writeWav('epc_formant_baseline.wav', out1, sr);

// Decode with formant filter (800Hz peak, Q=1.5, +10dB = voice F1)
const out2 = decode(epcData, sr, {freq:800, Q:1.5, gain:10});
writeWav('epc_formant_voice.wav', out2, sr);

// Decode with dual formants (F1=800 + F2=1600)
const out3a = applyFormant(out1, sr, 800, 1.5, 10);
const out3 = applyFormant(out3a, sr, 1600, 2, 6);
writeWav('epc_formant_dual.wav', out3, sr);

console.log('\\nCompare: baseline vs F1(800Hz) vs F1+F2');
console.log('Listen to epc_formant_baseline.wav, epc_formant_voice.wav, epc_formant_dual.wav');

function writeWav(path, pcm, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);
  h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);
  h.writeUInt16LE(1,22);h.writeUInt32LE(sr,24);h.writeUInt32LE(sr*2,28);
  h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);
  h.writeUInt32LE(pcm.length,40);
  writeFileSync(path,Buffer.concat([h,pcm]));
  console.log('saved',path);
}
