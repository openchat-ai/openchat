// 实验三（LMDN）：LPC+MDCT → NNLS 全流水线
// 用法: node run_experiment3.mjs [wav] [start] [dur]
// 默认: jzlg.wav 200s 10s
import fs from 'fs';
import LpcMdctCodec from '../bridge/src/core/audio/lpc-mdct-codec.js';

const SR = 48000, HOP = 1024, FS = 2048, HALF = FS >> 1;
const NM = { min: 21, max: 108, cnt: 88 };

// === 预计算表 ===
const win = new Float64Array(FS);
for (let i = 0; i < FS; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FS));

// NNLS 词典 + H 矩阵（一次计算）
const dict = new Array(HALF); for (let b = 0; b < HALF; b++) dict[b] = new Float64Array(NM.cnt);
for (let ni = 0; ni < NM.cnt; ni++) {
  const f = 440 * Math.pow(2, (NM.min + ni - 69) / 12);
  for (let h = 1; h <= 10; h++) { const hf = f * h; if (hf > SR / 2) break; const b = Math.round(hf * FS / SR); if (b >= 0 && b < HALF) dict[b][ni] += Math.pow(h, -1); }
}
for (let ni = 0; ni < NM.cnt; ni++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][ni] ** 2; const n = Math.sqrt(s) || 1; for (let b = 0; b < HALF; b++) dict[b][ni] /= n; }
const Hm = new Array(NM.cnt);
for (let i = 0; i < NM.cnt; i++) { Hm[i] = new Float64Array(NM.cnt); for (let j = 0; j < NM.cnt; j++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * dict[b][j]; Hm[i][j] = s; } }

// 重用 FFT 缓冲区
const _re = new Float64Array(FS), _im = new Float64Array(FS), _g = new Float64Array(NM.cnt), _Hx = new Float64Array(NM.cnt);

function fft() {
  for (let i = 1, j = 0; i < FS; i++) { let b = FS >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [_re[i], _re[j]] = [_re[j], _re[i]]; [_im[i], _im[j]] = [_im[j], _im[i]]; } }
  for (let l = 2; l <= FS; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < FS; i += l) for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * _re[v] - wi * _im[v], ti = wr * _im[v] + wi * _re[v]; _re[v] = _re[u] - tr; _im[v] = _im[u] - ti; _re[u] += tr; _im[u] += ti; } }
}

// 单帧 NNLS 求解（操作缓冲区）
function nnlsFrame(mag) {
  // g = D^T · mag（存起来，迭代中会覆盖 _Hx）
  for (let i = 0; i < NM.cnt; i++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * mag[b]; _g[i] = Math.max(s, 1e-12); }
  // FISTA 迭代: x ← x · g / (H·x)
  const x = new Float64Array(NM.cnt); for (let i = 0; i < NM.cnt; i++) x[i] = 1e-4;
  for (let it = 0; it < 50; it++) {
    for (let i = 0; i < NM.cnt; i++) { let s = 0; for (let j = 0; j < NM.cnt; j++) s += Hm[i][j] * x[j]; _Hx[i] = Math.max(s, 1e-12); }
    let ch = 0; for (let i = 0; i < NM.cnt; i++) { const nv = x[i] * _g[i] / _Hx[i]; ch += Math.abs(nv - x[i]); x[i] = nv; }
    if (ch < 1e-8 * NM.cnt) break;
  }
  // 提取 + 谐波过滤
  const notes = []; for (let ni = 0; ni < NM.cnt; ni++) if (x[ni] > 1e-6) notes.push({ ni, midi: NM.min + ni, act: x[ni] });
  notes.sort((a, b) => b.act - a.act); const kept = [];
  for (const n of notes) { let ih = false; for (const k of kept) { const r = 2 ** ((n.midi - k.midi) / 12); if (r > 1.8 && r < 2.2 || r > 2.8 && r < 3.2) { ih = true; break; } } if (!ih) { kept.push(n); if (kept.length >= 5) break; } }
  const maxA = kept.length ? kept[0].act : 1;
  return kept.filter(n => n.act / maxA > 0.05).map(n => ({ f: Math.round(440 * 2 ** ((n.midi - 69) / 12) * 10) / 10, m: n.midi, c: Math.min(1, n.act / maxA) }));
}

// 帧追踪
function track(raw) {
  const act = {}, out = [];
  for (const n of raw) {
    const r = Math.round(n.m);
    if (act[r]) {
      if (n.t - act[r].l > 0.05) {
        const d = act[r].l - act[r].s;
        if (d > 0.04) out.push({ m: r, f: act[r].fs / act[r].cnt, s: act[r].s, d, c: act[r].c, inst: act[r].inst });
        act[r] = { fs: n.f, c: n.c, s: n.t, l: n.t, cnt: 1, inst: act[r].inst };
      } else { act[r].fs += n.f; act[r].c = Math.max(act[r].c, n.c); act[r].l = n.t; act[r].cnt++; }
    } else { act[r] = { fs: n.f, c: n.c, s: n.t, l: n.t, cnt: 1, inst: '' }; }
  }
  for (const [r, a] of Object.entries(act)) { const d = a.l - a.s; if (a.cnt >= 2 && d > 0.04) out.push({ m: parseInt(r), f: a.fs / a.cnt, s: a.s, d, c: a.c, inst: a.inst }); }
  return out.sort((a, b) => a.s - b.s);
}

// === IO ===
function readWav(path, ss, ds) {
  const buf = fs.readFileSync(path); let o = 12, doff, frames, sr;
  while (o < buf.length) { const id = buf.toString('ascii', o, o + 4); const sz = buf.readUInt32LE(o + 4); if (id === 'fmt ') sr = buf.readUInt32LE(o + 12); if (id === 'data') { doff = o + 8; frames = sz / 4; break; } o += 8 + sz; }
  const si = Math.round((ss || 0) * sr); const di = Math.round((ds || frames / sr) * sr);
  const m = new Float64Array(di); for (let i = 0; i < di; i++) { const idx = (si + i) * 2; m[i] = buf.readInt16LE(doff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(doff + (idx + 1) * 2) / 32768 * 0.5; }
  return m;
}
function writeWav(p, s) {
  const n = s.length, d = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) d.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32768))), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n * 2, 40); fs.writeFileSync(p, Buffer.concat([h, d]));
}

// === 检测通道 ===
function detectBand(sig, minF, maxF, minC, inst) {
  const tf = Math.floor((sig.length - FS) / HOP) + 1, raw = [];
  for (let fi = 0; fi < tf; fi++) {
    const fr = sig.subarray(fi * HOP, fi * HOP + FS);
    // FFT
    for (let i = 0; i < FS; i++) { _re[i] = fr[i] * win[i]; _im[i] = 0; }
    fft();
    const mag = new Float64Array(HALF); for (let i = 0; i < HALF; i++) mag[i] = Math.sqrt(_re[i] * _re[i] + _im[i] * _im[i]);
    const dets = nnlsFrame(mag);
    for (const d of dets) if (d.f > minF && d.f < maxF && d.c > minC) raw.push({ t: fi * HOP / SR, f: d.f, m: d.m, c: d.c, inst });
  }
  const notes = track(raw);
  for (const n of notes) n.inst = inst;
  return notes;
}

// 高通/低通滤波器
function highpass(sig, fc) { const a = 1 - 2 * Math.PI * fc / SR; const o = new Float64Array(sig.length); let y = 0; for (let i = 1; i < sig.length; i++) { y = sig[i] - sig[i - 1] + a * y; o[i] = y; } return o; }
function lowpass(sig, fc) { const o = new Float64Array(sig.length); let y = 0; for (let i = 0; i < sig.length; i++) { y = y * fc + sig[i] * (1 - fc); o[i] = y; } return o; }

// 鼓检测（包络 + ZCR）
function detectDrums(sig) {
  const env = new Float64Array(sig.length); let lp = 0; for (let i = 0; i < sig.length; i++) { lp += (Math.abs(sig[i]) - lp) * 0.01; env[i] = lp; }
  const out = []; let last = -Math.round(SR * 0.1);
  for (let i = Math.round(SR * 0.1); i < sig.length - 1; i++) {
    if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > 0.03) {
      const base = env[Math.max(0, i - Math.round(SR * 0.03))];
      if (env[i] > base * 2.2 && i - last > Math.round(SR * 0.1)) {
        last = i; const seg = sig.subarray(Math.max(0, i - 128), Math.min(sig.length, i + 384));
        let zcr = 0; for (let j = 1; j < seg.length; j++) if (seg[j] * seg[j - 1] < 0) zcr++;
        out.push({ s: i / SR, m: 0, inst: zcr / seg.length < 0.06 ? 'kick' : zcr / seg.length < 0.18 ? 'snare' : 'hihat', c: Math.min(1, env[i] / base / 3), d: 0.1 });
      }
    }
  }
  return out;
}

// === KS 合成器 ===
function ksSynth(freq, durS, c, vol, dec) {
  const del = Math.round(SR / freq); if (del < 4) return null;
  const out = new Float64Array(durS); const buf = new Float64Array(del);
  for (let i = 0; i < del; i++) { buf[i] = (Math.random() * 2 - 1) * 0.3 + (i < del * 0.4 ? Math.sin(Math.PI * i / del) * 0.7 : 0); }
  let wi = 0, lp = 0;
  for (let i = 0; i < durS; i++) {
    const s = buf[wi]; lp = lp * 0.93 + ((buf[wi] + buf[(wi - 1 + del) % del]) * 0.5) * 0.07; buf[wi] = lp * dec; wi = (wi + 1) % del;
    const t = i / SR, e = t < 0.001 ? t / 0.001 : Math.exp(-2 * (t - 0.001));
    if (e > 0) out[i] = s * e * vol; if (t >= 0.001 && e < 0.0001) break;
  }
  return out;
}
function synGuitar(n) { return ksSynth(440 * 2 ** ((n.m - 69) / 12), Math.round(n.d * SR), n.c, 0.15 + n.c * 0.25, 0.998 ** (1 / Math.round(SR / (440 * 2 ** ((n.m - 69) / 12))))); }
function synBass(n) { return ksSynth(440 * 2 ** ((n.m - 69) / 12), Math.round(n.d * SR), n.c, 0.2 + n.c * 0.3, 0.9995 ** (1 / Math.round(SR / (440 * 2 ** ((n.m - 69) / 12))))); }
function synDrum(n) {
  const o = new Float64Array(Math.round(0.15 * SR));
  for (let i = 0; i < o.length; i++) { const t = i / SR; let s = 0; if (n.inst === 'kick') s = Math.sin(2 * Math.PI * 60 * t) * Math.exp(-20 * t) + (Math.random() * 2 - 1) * 0.3 * Math.exp(-40 * t); else if (n.inst === 'snare') s = Math.sin(2 * Math.PI * 200 * t) * Math.exp(-15 * t) * 0.5 + (Math.random() * 2 - 1) * Math.exp(-12 * t) * 0.6; else s = (Math.random() * 2 - 1) * Math.exp(-30 * t) * 0.4; o[i] = s * 0.5; }
  return o;
}

// ===== 主流程 =====
const [,, wavPath = 'jzlg.wav', startSec = '200', durSec = '10'] = process.argv;
const orig = readWav(wavPath, parseFloat(startSec), parseFloat(durSec));
console.log(`输入: ${wavPath} @ ${startSec}s x ${durSec}s (${orig.length} 样点)`);

// 1. LPC+MDCT 编解码（发送端 → 接收端）
console.log(`[1/5] LPC+MDCT 编解码...`);
const codec = new LpcMdctCodec(); await codec.initialize();
const pcmBuf = Buffer.alloc(orig.length * 2); for (let i = 0; i < orig.length; i++) pcmBuf.writeInt16LE(Math.round(orig[i] * 32768), i * 2);
const enc = await codec.encode(pcmBuf); const encSz = enc.data.length;
console.log(`  → EPC: ${(encSz / 1024).toFixed(1)}KB (${(orig.length * 2 / encSz).toFixed(1)}x)`);
const dec = await codec.decode(enc.data);
const reconLen = Math.floor(dec.pcm.length / 2); const recon = new Float64Array(reconLen);
for (let i = 0; i < reconLen; i++) recon[i] = dec.pcm.readInt16LE(i * 2) / 32768;
console.log(`  → PCM: ${(reconLen / SR).toFixed(2)}s`);

// 2. NNLS 多音高检测（在解码后音频上）
console.log(`[2/5] NNLS 扒谱...`);
const hpG = highpass(recon, 200);
const hpB = highpass(recon, 40);
const bpB = lowpass(hpB, 0.996);
const t0 = Date.now();
const gNotes = detectBand(hpG, 80, 1500, 0.15, 'guitar');
const bNotes = detectBand(bpB, 40, 180, 0.1, 'bass');
const dNotes = detectDrums(orig);
const dt = (Date.now() - t0) / 1000;
console.log(`  → ${gNotes.length}吉他 + ${bNotes.length}贝斯 + ${dNotes.length}鼓 = ${gNotes.length + bNotes.length + dNotes.length}声部 (${dt.toFixed(0)}s)`);

// 3. KS 波表合成
console.log(`[3/5] 合成...`);
const allNotes = [...gNotes, ...bNotes, ...dNotes].sort((a, b) => a.s - b.s);
const syn = new Float64Array(recon.length); let synC = 0;
for (const n of allNotes) {
  const ss = Math.round((n.s) * SR);
  const ds = n.inst === 'drum' ? Math.round(0.15 * SR) : Math.max(Math.round((n.d || 0.1) * SR), Math.round(SR * 0.03));
  if (ss + ds > syn.length) continue;
  const fn = n.inst === 'guitar' ? synGuitar : n.inst === 'bass' ? synBass : synDrum;
  const tone = fn(n); if (!tone) continue;
  for (let i = 0; i < tone.length && ss + i < syn.length; i++) syn[ss + i] += tone[i] * (n.c || 1);
  synC++;
}
console.log(`  → ${synC}/${allNotes.length} 合成`);

// 4. 混合
console.log(`[4/5] 混合...`);
const mixLen = Math.min(recon.length, syn.length); const mix = new Float64Array(mixLen);
for (let i = 0; i < mixLen; i++) mix[i] = syn[i] + recon[i] * 0.3;

// 5. 输出
console.log(`[5/5] 写入文件...`);
writeWav('exp3_01_original.wav', orig);
fs.writeFileSync('exp3_02_epc.epc', enc.data);
writeWav('exp3_03_decoded.wav', recon);
writeWav('exp3_04_synth.wav', syn);
writeWav('exp3_05_mix.wav', mix);
console.log(`\n输出: exp3_01_original.wav (原始)`);
console.log(`      exp3_02_epc.epc (编码 ${(encSz / 1024).toFixed(1)}KB)`);
console.log(`      exp3_03_decoded.wav (解码 ${(reconLen * 2 / 1024).toFixed(0)}KB)`);
console.log(`      exp3_04_synth.wav (${synC}声部合成)`);
console.log(`      exp3_05_mix.wav (混合)`);
