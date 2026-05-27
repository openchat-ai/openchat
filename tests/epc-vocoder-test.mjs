// EPC vocoder roundtrip: 11-band Mel subbands, no codebook
import { writeFileSync } from 'fs';

const sr = 24000;
const melFreqs = [100, 150, 220, 320, 460, 660, 950, 1350, 1950, 2800, 4000];

// ===== FFT + HPS (same as before) =====
function fft(r, i) {
  const n = r.length;
  for (let j = 0, b = n >> 1; b < n; b++) { let bt = n >> 1; for (; j & bt; bt >>= 1) j ^= bt; j ^= bt; if (b < j) { [r[b], r[j]] = [r[j], r[b]]; [i[b], i[j]] = [i[j], i[b]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = 2 * Math.PI / l, wR = Math.cos(a), wI = -Math.sin(a); for (let s = 0; s < n; s += l) { let cR = 1, cI = 0; for (let j = 0; j < l / 2; j++) { const uR = r[s + j], uI = i[s + j], vR = r[s + j + l / 2] * cR - i[s + j + l / 2] * cI, vI = r[s + j + l / 2] * cI + i[s + j + l / 2] * cR; r[s + j] = uR + vR; i[s + j] = uI + vI; r[s + j + l / 2] = uR - vR; i[s + j + l / 2] = uI - vI; const tR = cR * wR - cI * wI; cI = cR * wI + cI * wR; cR = tR; } } }
}
function hps(s) {
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

// ===== Extract Mel subbands from FFT magnitude =====
function extractSubbands(fftMag, halfN) {
  const bands = [];
  const fftSize = 2048;
  for (let b = 0; b < 11; b++) {
    const fMin = b === 0 ? 80 : melFreqs[b - 1];
    const fMax = b === 10 ? 8000 : melFreqs[b];
    let binStart = Math.round(fMin * fftSize / sr);
    let binEnd = Math.round(fMax * fftSize / sr);
    let energy = 0; let count = 0;
    for (let bin = binStart; bin < binEnd && bin < halfN; bin++) { energy += fftMag[bin]; count++; }
    const avg = count > 0 ? energy / count : 0;
    bands.push(Math.round(Math.max(0, Math.min(31, avg / 32768 * 31))));
  }
  return bands;
}

// ===== Vocoder synthesis =====
function vocoderSynth(subBands, freq, rmsQ, vel, nSamples) {
  const amp = rmsQ / 255 * vel / 127 * 0.5;
  if (amp < 0.001) return new Float64Array(nSamples);
  const out = new Float64Array(nSamples);
  const state = new Float64Array(11); // smoothed amplitudes

  // Formant filter state
  let f1x1=0,f1x2=0,f1y1=0,f1y2=0, f2x1=0,f2x2=0,f2y1=0,f2y2=0;

  for (let i = 0; i < nSamples; i++) {
    let s = 0;
    for (let b = 0; b < 11; b++) {
      const target = subBands[b] / 31 * amp;
      if (target < 0.001) continue;
      state[b] += (target - state[b]) * 0.3;
      const bandAmp = state[b];
      const f = melFreqs[b];
      const t = i / sr;
      let val;
      if (f > 3000) {
        val = (Math.random() * 2 - 1) * bandAmp;
      } else if (f > 1500) {
        val = (Math.sin(2 * Math.PI * f * t) * 0.6 + (Math.random() * 2 - 1) * 0.4) * bandAmp;
      } else {
        val = Math.sin(2 * Math.PI * f * t) * bandAmp;
        if (freq > 50) val += Math.sin(2 * Math.PI * freq * t) * bandAmp * 0.3;
      }
      s += val;
    }

    // Formant filter F1=800Hz
    const f1=800,q1=1.5,g1=10; const a1=Math.pow(10,g1/40), w1=2*Math.PI*f1/sr, al1=Math.sin(w1)/(2*q1);
    const y1 = ((1+al1*a1)*s - 2*Math.cos(w1)*f1x1 + (1-al1*a1)*f1x2 + 2*Math.cos(w1)*f1y1 - (1-al1/a1)*f1y2) / (1+al1/a1);
    f1x2=f1x1; f1x1=s; f1y2=f1y1; f1y1=y1;

    // Formant filter F2=1600Hz
    const f2=1600,q2=2,g2=6; const a2=Math.pow(10,g2/40), w2=2*Math.PI*f2/sr, al2=Math.sin(w2)/(2*q2);
    const y2 = ((1+al2*a2)*y1 - 2*Math.cos(w2)*f2x1 + (1-al2*a2)*f2x2 + 2*Math.cos(w2)*f2y1 - (1-al2/a2)*f2y2) / (1+al2/a2);
    f2x2=f2x1; f2x1=y1; f2y2=f2y1; f2y1=y2;

    out[i] = y2;
  }
  return out;
}

// ===== Generate test signal =====
const durSec = 2;
const nS = sr * durSec;
const pcmIn = Buffer.alloc(nS * 2);
for (let i = 0; i < nS; i++) {
  let s = 0, f0 = 200 + 50 * Math.sin(2 * Math.PI * 0.5 * i / sr);
  for (let h = 1; h <= 20; h++) s += Math.sin(2 * Math.PI * f0 * h * i / sr) / h;
  s *= 0.3;
  const c = Math.max(-32768, Math.min(32767, Math.round(s * 32768)));
  pcmIn.writeInt16LE(c, i * 2);
}
writeWav('vocoder_input.wav', pcmIn, sr);

// ===== Encode =====
const fsZ = 480, fB = fsZ * 2;
const ab = [], at = new Map(), rf = [];
let nt = 0, fc = 0;

for (let off = 0; off + fB <= pcmIn.length; off += fB) {
  const sm = [];
  for (let i = 0; i < fsZ; i++) { const v = pcmIn.readInt16LE(off + i * 2); sm.push(v); ab.push(v); }
  if (ab.length > 2048) ab.splice(0, ab.length - 2048);
  const fe = [], tr = [];

  for (const [tid, t] of at) {
    const lag = Math.round(sr / t.f);
    let c = 0, n = 0; for (let i = 0; i < 240; i++) { c += sm[i] * sm[i + lag]; n += sm[i]*sm[i] + sm[i+lag]*sm[i+lag]; }
    const corr = n > 0 ? c / Math.sqrt(n) : 0;
    if (corr > 0.3) { t.s = 0; const srms = Math.sqrt(sm.reduce((s,v)=>s+v*v,0)/sm.length); fe.push(encodeEpc(tid, t.n, 0, Math.round(corr*127), Math.round(Math.min(255,srms/32768*255)), t.bands)); }
    else { t.s++; if (t.s > 3) { tr.push(tid); fe.push(encodeEpc(tid, 0, 0, 0, 0, null)); } }
  }
  for (const tid of tr) at.delete(tid);

  if (ab.length >= 2048 && fc % 4 === 0) {
    // FFT + HPS
    const n = 2048, hn = n >> 1;
    const r = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = (i < ab.length ? ab[i] : 0) * (0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))));
    fft(r, im);
    const mag = new Float64Array(hn); for (let i = 0; i < hn; i++) mag[i] = Math.sqrt(r[i]*r[i]+im[i]*im[i]);

    const tones = hps(ab);
    for (const t of tones) {
      const lag = Math.round(sr / t.freq);
      let c = 0, n = 0; for (let i = 0; i < 240; i++) { c += sm[i] * sm[i + lag]; n += sm[i]*sm[i] + sm[i+lag]*sm[i+lag]; }
      const corr = n > 0 ? c / Math.sqrt(n) : 0;
      if (corr < 0.3) continue;
      const dup = [...at.values()].some(a => { const r = t.freq > a.f ? t.freq / a.f : a.f / t.freq; return Math.abs(r - Math.round(r)) < 0.05; });
      if (dup) continue;

      // Extract subbands
      const bands = extractSubbands(mag, hn);
      const midi = 12 * Math.log(t.freq / 440) / Math.log(2) + 69;
      const note = Math.max(0, Math.min(127, Math.round(midi)));
      const srms = Math.sqrt(sm.reduce((s,v)=>s+v*v,0)/sm.length);
      const rmsQ = Math.round(Math.min(255, srms / 32768 * 255));

      at.set(nt % 15, { f: t.freq, n: note, s: 0, v: Math.round(t.corr * 127), r: rmsQ, bands });
      fe.push(encodeEpc(nt % 15, note, 1, Math.round(t.corr * 127), rmsQ, bands));
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

// ===== Decode =====
const po = [], activeTones = new Map();
let o = 0;
while (o + 7 <= epcData.length) {
  if (epcData[o] !== 0xBB) break;
  const dl = (epcData[o + 3] << 8) | epcData[o + 4], fl = 7 + dl;
  for (let eo = o + 5; eo < o + 5 + dl; eo += 12) {
    const buf = epcData.slice(eo, eo + 12);
    const tid = (buf[1] >> 4) & 0xF;
    const note = (buf[2] >> 1) & 0x7F;
    const vel = (buf[3] >> 1) & 0x7F, rms = buf[4];
    // Unpack subbands
    const bands = [];
    let bit = 0;
    for (let i = 0; i < 11; i++) {
      let val = 0;
      for (let b = 0; b < 5; b++) {
        const byteIdx = 5 + (bit >> 3);
        const bitIdx = bit & 7;
        val = (val << 1) | ((buf[byteIdx] >> (7 - bitIdx)) & 1);
        bit++;
      }
      bands.push(val);
    }
    if (vel === 0 && rms === 0) { activeTones.delete(tid); continue; }
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    activeTones.set(tid, { freq, bands, rms, vel });
  }

  const nOut = sr * 20 / 1000;
  const pcmOut = Buffer.alloc(nOut * 2);
  const state = new Float64Array(11);
  let f1x1=0,f1x2=0,f1y1=0,f1y2=0, f2x1=0,f2x2=0,f2y1=0,f2y2=0;

  for (let i = 0; i < nOut; i++) {
    let s = 0;
    for (const tone of activeTones.values()) {
      const amp = tone.rms / 255 * tone.vel / 127 * 0.5;
      if (amp < 0.001) continue;
      for (let b = 0; b < 11; b++) {
        const target = tone.bands[b] / 31 * amp;
        if (target < 0.001) continue;
        state[b] += (target - state[b]) * 0.3;
        const ba = state[b];
        const f = melFreqs[b];
        const t = i / sr;
        let val;
        if (f > 3000) val = (Math.random() * 2 - 1) * ba;
        else if (f > 1500) val = (Math.sin(2*Math.PI*f*t)*0.6 + (Math.random()*2-1)*0.4) * ba;
        else { val = Math.sin(2*Math.PI*f*t)*ba; if(tone.freq>50) val += Math.sin(2*Math.PI*tone.freq*t)*ba*0.3; }
        s += val;
      }
    }
    // Formant filter
    const f1=800,q1=1.5,g1=10; const a1=Math.pow(10,g1/40),w1=2*Math.PI*f1/sr,al1=Math.sin(w1)/(2*q1);
    const y1=((1+al1*a1)*s-2*Math.cos(w1)*f1x1+(1-al1*a1)*f1x2+2*Math.cos(w1)*f1y1-(1-al1/a1)*f1y2)/(1+al1/a1);
    f1x2=f1x1;f1x1=s;f1y2=f1y1;f1y1=y1;
    const f2=1600,q2=2,g2=6;const a2=Math.pow(10,g2/40),w2=2*Math.PI*f2/sr,al2=Math.sin(w2)/(2*q2);
    const y2=((1+al2*a2)*y1-2*Math.cos(w2)*f2x1+(1-al2*a2)*f2x2+2*Math.cos(w2)*f2y1-(1-al2/a2)*f2y2)/(1+al2/a2);
    f2x2=f2x1;f2x1=y1;f2y2=f2y1;f2y1=y2;

    const c = Math.max(-32768, Math.min(32767, Math.round(y2 * 32768)));
    pcmOut.writeInt16LE(c, i * 2);
  }
  po.push(pcmOut);
  o += fl;
}

const outPcm = Buffer.concat(po);
writeWav('vocoder_output.wav', outPcm, sr);
console.log('Decoded:', outPcm.length, 'bytes');

// Compare
const minLen = Math.min(pcmIn.length, outPcm.length);
let mse = 0;
for (let i = 0; i < minLen; i++) { const d = pcmIn[i] - outPcm[i]; mse += d * d; }
mse /= minLen;
const snr = 20 * Math.log10(255 / (Math.sqrt(mse) + 0.001));
console.log('SNR:', snr.toFixed(1), 'dB');
console.log('Ratio:', (pcmIn.length / epcData.length).toFixed(1), 'x');

// ===== Score Comparison =====
console.log('\n=== Score ===');
console.log('Original: 200Hz sawtooth (20 harmonics) for 2s');
// Extract all NoteOn events
console.log('EPC data length:', epcData.length, 'bytes');
console.log('First bytes:', epcData.slice(0,7).toString('hex'));
console.log('Extracted events:');
for (let o2 = 0, fi = 0; o2 + 7 <= epcData.length; fi++) {
  const dl = (epcData[o2 + 3] << 8) | epcData[o2 + 4], fl = 7 + dl;
  if (dl === 0) { o2 += fl; continue; }
  for (let eo = o2 + 5; eo < o2 + 5 + dl; eo += 12) {
    const buf = epcData.slice(eo, eo + 12);
    const onset = buf[2] & 1;
    const note = (buf[2] >> 1) & 0x7F;
    const vel = (buf[3] >> 1) & 0x7F, rms = buf[4];
    if (vel === 0 && rms === 0) continue;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    const nn = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][note%12]+Math.floor(note/12-1);
    const t = (fi * 20 / 1000).toFixed(2);
    if (onset === 1) console.log(`  ${t}s  ON  ${nn}(${Math.round(freq)}Hz) track=${eo > 0 ? (buf[1]>>4)&0xF : '?'} vel=${vel} rms=${rms}`);
    else if (fi < 5 || fi % 20 === 0) {
      // Show sustain every 20 frames (400ms)
      const bands=[]; let bit=0; for(let i=0;i<11;i++){let v=0;for(let b=0;b<5;b++){v=(v<<1)|((buf[5+(bit>>3)]>>(7-(bit&7)))&1);bit++;}bands.push(v);}
      console.log(`  ${t}s  SUS ${nn} rms=${rms} bands_top3=${bands.slice(0,3).join(',')}...`);
    }
  }
  o2 += fl;
}

function encodeEpc(tid, note, onset, vel, rms, bands) {
  const b = Buffer.alloc(12);
  b[0] = 0x02; b[1] = (tid << 4) & 0xF0;
  b[2] = ((note & 0x7F) << 1) | (onset & 1);
  b[3] = (vel << 1) & 0xFE;
  b[4] = rms;
  if (bands) {
    let bit = 0;
    for (let i = 0; i < 11; i++) {
      for (let b2 = 0; b2 < 5; b2++) {
        const byteIdx = 5 + (bit >> 3);
        const bitIdx = bit & 7;
        if ((bands[i] >> (4 - b2) & 1) !== 0) b[byteIdx] |= 1 << (7 - bitIdx);
        bit++;
      }
    }
  }
  return b;
}

function writeWav(path, pcm, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);
  h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);
  h.writeUInt16LE(1,22);h.writeUInt32LE(sr,24);h.writeUInt32LE(sr*2,28);
  h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);
  h.writeUInt32LE(pcm.length,40);
  writeFileSync(path,Buffer.concat([h,pcm]));
}
