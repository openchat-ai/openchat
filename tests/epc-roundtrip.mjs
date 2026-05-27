import { writeFileSync } from 'fs';

// ===== Harmonic Codebook (same formula as Dart) =====
const NOTES = 128, VELS = 32, ENTRIES = NOTES * VELS, HARMS = 8;
const codebook = [];
for (let idx = 0; idx < ENTRIES; idx++) {
  const midiNote = Math.floor(idx / VELS);
  const vel = idx % VELS;
  const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
  const bright = vel / (VELS - 1);
  let decay = freq / 2000 + (1 - bright) * 0.3;
  decay = Math.max(0.05, Math.min(2.0, decay));
  const h = [];
  for (let hh = 0; hh < HARMS; hh++) {
    const raw = Math.exp(-hh * decay) * (1 + bright * 0.5);
    h.push(Math.round(Math.max(0, Math.min(255, raw * 255))));
  }
  codebook.push(h);
}
function findNearest(target) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < ENTRIES; i++) {
    let d = 0;
    for (let h = 0; h < HARMS; h++) { const dd = codebook[i][h] - target[h]; d += dd * dd; }
    if (d < bestDist) { bestDist = d; best = i; if (d === 0) break; }
  }
  return best;
}

// ===== EPC-96 Pack/Unpack =====
// Spectrum tag Byte layout (same as Dart epc_tag.dart):
// [0] tagType=0x02
// [1] trackId(4) | spare(4)
// [2-3] codebookIdx(12) | spare(4)
// [4] midiNote(7) | onset(1)
// [5] cent(6) | spare(2)
// [6] vel(7) | spare(1)
// [7] rms
// [8-11] spare
function packEpc(tag) {
  const b = Buffer.alloc(12);
  b[0] = 0x02;
  b[1] = (tag.trackId << 4) & 0xF0;
  b[2] = (tag.codebookIdx >> 4) & 0xFF;
  b[3] = ((tag.codebookIdx & 0x0F) << 4) & 0xF0;
  b[4] = ((tag.midiNote & 0x7F) << 1) | (tag.onsetFlag & 1);
  b[5] = ((tag.cent + 32) << 2) & 0xFC;
  b[6] = (tag.velocity << 1) & 0xFE;
  b[7] = tag.rms;
  return b;
}
function unpackEpc(buf) {
  return {
    trackId: (buf[1] >> 4) & 0x0F,
    codebookIdx: (buf[2] << 4) | ((buf[3] >> 4) & 0x0F),
    midiNote: (buf[4] >> 1) & 0x7F,
    onsetFlag: buf[4] & 1,
    cent: ((buf[5] >> 2) & 0x3F) - 32,
    velocity: (buf[6] >> 1) & 0x7F,
    rms: buf[7],
    harmonics: codebook[(buf[2] << 4) | ((buf[3] >> 4) & 0x0F)],
  };
}

// ===== FFT + HPS Multi-F0 Detector =====
// Radix-2 FFT (in-place, decimation-in-time)
function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len;
    const wR = Math.cos(ang), wI = -Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cR = 1, cI = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j], uI = imag[i + j];
        const vR = real[i + j + len / 2] * cR - imag[i + j + len / 2] * cI;
        const vI = real[i + j + len / 2] * cI + imag[i + j + len / 2] * cR;
        real[i + j] = uR + vR; imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR; imag[i + j + len / 2] = uI - vI;
        const tR = cR * wR - cI * wI;
        cI = cR * wI + cI * wR; cR = tR;
      }
    }
  }
}

// Hanning window
function hanning(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  return w;
}

// HPS multi-F0 detection
function hpsMultiF0(samples, sr) {
  const n = 2048; // FFT size
  const halfN = n >> 1;
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  const win = hanning(n);

  // Pad/copy with window
  for (let i = 0; i < n && i < samples.length; i++) { real[i] = samples[i] * win[i]; imag[i] = 0; }
  for (let i = samples.length; i < n; i++) real[i] = 0;

  fft(real, imag);

  // Magnitude spectrum (only bins 0..halfN)
  const mag = new Float64Array(halfN);
  for (let i = 0; i < halfN; i++) mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);

  // HPS: product of 4 downsampled spectra
  const hps = new Float64Array(halfN);
  for (let i = 0; i < halfN; i++) {
    let p = mag[i];
    if (p < 1) continue;
    for (let h = 2; h <= 4; h++) {
      const idx = Math.round(i * h);
      if (idx >= halfN) break;
      p *= mag[idx];
    }
    hps[i] = p;
  }

  // Find top-3 peaks in HPS (within 40-1500Hz range)
  const minBin = Math.round(halfN * 40 / sr);
  const maxBin = Math.round(halfN * 1500 / sr);
  const peaks = [];
  for (let i = minBin + 1; i < maxBin - 1; i++) {
    if (hps[i] > hps[i - 1] && hps[i] > hps[i + 1] && hps[i] > 0) {
      peaks.push({ bin: i, val: hps[i], freq: i * sr / n });
    }
  }
  peaks.sort((a, b) => b.val - a.val);

  // Take top 2, skip if harmonically related
  const result = [];
  for (const p of peaks) {
    const dup = result.some(r => {
      const ratio = p.freq > r.freq ? p.freq / r.freq : r.freq / p.freq;
      return Math.abs(ratio - Math.round(ratio)) < 0.08;
    });
    if (!dup) {
      result.push({ freq: p.freq, corr: Math.min(1, p.val / (peaks[0]?.val || 1)) });
      if (result.length >= 2) break;
    }
  }
  return result;
}

// Simple single-F0: find SHORTEST lag with corr > 0.4 (suppresses subharmonics)
function simpleF0(samples, sr) {
  const n = samples.length;
  const half = n >> 1;
  const minLag = Math.floor(sr / 1500), maxLag = Math.floor(sr / 40);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0, norm = 0;
    for (let i = 0; i < half; i++) { c += samples[i] * samples[i + lag]; norm += samples[i] * samples[i] + samples[i + lag] * samples[i + lag]; }
    const corr = norm > 0 ? c / Math.sqrt(norm) : 0;
    if (corr > 0.4) return [{ freq: sr / lag, corr }];
  }
  return [];
}

// Analyze window: HPS (2048+) or simpleF0 (cold-start)
function analyzeWindow(samples, sr) {
  const tones = [];
  const n = samples.length;
  const candidates = n >= 2048 ? hpsMultiF0(samples, sr) : simpleF0(samples, sr);
  for (const p of candidates) {
    const f0 = p.freq;
    // Use FFT magnitude at harmonic frequencies (reuse precomputed FFT if available)
    const fftN = 2048;
    const rawHarms = [];
    for (let h = 0; h < 8; h++) {
      const hz = f0 * (h + 1);
      const bin = Math.round(hz * fftN / sr);
      if (bin < 1 || bin >= fftN / 2) { rawHarms.push(0); continue; }
      // Compute magnitude at this bin via DFT (just that one bin)
      let cR = 0, cI = 0;
      const lim = Math.min(n, fftN);
      for (let i = 0; i < lim; i++) {
        const ang = 2 * Math.PI * bin * i / fftN;
        cR += samples[i] * Math.cos(ang);
        cI -= samples[i] * Math.sin(ang);
      }
      rawHarms.push(Math.sqrt(cR * cR + cI * cI) / lim * 2);
    }
    const maxH = Math.max(...rawHarms, 1);
    const harms = rawHarms.map(a => Math.round(Math.max(0, Math.min(255, a / maxH * 255))));
    const sigRms = Math.sqrt(samples.reduce((s,v) => s + v * v, 0) / samples.length);
    const rmsQ = Math.round(Math.max(0, Math.min(255, sigRms / 32768 * 255)));
    tones.push({ f0, confidence: Math.round(p.corr * 100) / 100, harmonics: harms, rms: rmsQ });
  }
  return tones;
}

// ===== Response Frame: BB|01|CC|PL|EPCs|Chk|7E =====
function packResponseFrame(epcBuffers) {
  const data = Buffer.concat(epcBuffers);
  const pl = data.length;
  const frame = Buffer.alloc(7 + pl);
  let off = 0;
  frame[off++] = 0xBB;
  frame[off++] = 0x01; // response
  frame[off++] = 0xCC;
  frame[off++] = (pl >> 8) & 0xFF;
  frame[off++] = pl & 0xFF;
  data.copy(frame, off); off += pl;
  let chk = 0;
  for (let i = 1; i < off; i++) chk = (chk + frame[i]) & 0xFF;
  frame[off++] = chk;
  frame[off++] = 0x7E;
  return frame;
}

// Quick correlation check for existing track
function quickCheck(samples, lag, half) {
  let c = 0, norm = 0;
  for (let i = 0; i < half; i++) {
    c += samples[i] * samples[i + lag];
    norm += samples[i] * samples[i] + samples[i + lag] * samples[i + lag];
  }
  return norm > 0 ? c / Math.sqrt(norm) : 0;
}

// ===== Encode PCM → ResponseFrames (with track lifecycle, 2048-window analysis) =====
function encode(pcm, sr) {
  const frameSize = sr * 20 / 1000; // 480 samples for quick check
  const frameBytes = frameSize * 2;
  const half = frameSize >> 1;
  const responseFrames = [];
  const activeTracks = new Map();
  const analysisBuf = []; // rolling 2048-sample buffer
  let nextTrackId = 0, frameCount = 0;

  for (let off = 0; off + frameBytes <= pcm.length; off += frameBytes) {
    const samples = [];
    for (let i = 0; i < frameSize; i++) {
      const v = pcm.readInt16LE(off + i * 2);
      samples.push(v);
      analysisBuf.push(v);
    }
    if (analysisBuf.length > 2048) analysisBuf.splice(0, analysisBuf.length - 2048);

    const frameEpcs = [];
    const toRemove = [];

    // 1. Quick check on existing tracks (20ms window)
    for (const [tid, t] of activeTracks) {
        const trackLag = t.lag || Math.round(sr / t.freq);
        const corr = quickCheck(samples, trackLag, half);
      if (corr > 0.3) {
        t.stale = 0;
        const sigRms = Math.sqrt(samples.reduce((s,v) => s + v * v, 0) / samples.length);
        const rmsQ = Math.round(Math.max(0, Math.min(255, sigRms / 32768 * 255)));
        frameEpcs.push(packEpc({ trackId: tid, codebookIdx: t.cbIdx, midiNote: t.note, cent: t.cent,
          onsetFlag: 0, velocity: Math.round(corr * 127), rms: rmsQ }));
      } else {
        t.stale++;
        if (t.stale > 3) {
          toRemove.push(tid);
          frameEpcs.push(packEpc({ trackId: tid, codebookIdx: 0, midiNote: 0, cent: 0,
            onsetFlag: 2, velocity: 0, rms: 0 }));
        }
      }
    }
    for (const tid of toRemove) activeTracks.delete(tid);

    // 2. Full analysis: HPS on accumulated buffer, fallback to simpleF0 for cold-start
    const hasAnalysis = analysisBuf.length >= 2048;
    const checkNew = hasAnalysis ? (frameCount % 4 === 0) : (frameCount === 0);
    if (checkNew) {
      const tones = hasAnalysis ? analyzeWindow(analysisBuf, sr) : simpleF0(samples, sr).map(p => {
        const harms = [255, 166, 108, 70, 45, 29, 19, 12]; // approximate profile
        const sigRms = Math.sqrt(samples.reduce((s,v) => s + v * v, 0) / samples.length);
        return { f0: p.freq, confidence: p.corr, harmonics: harms, rms: Math.round(Math.min(255, sigRms / 32768 * 255)) };
      });
      // Verify each candidate with 20ms quickCheck
      const valid = tones.filter(t => quickCheck(samples, Math.round(sr / t.f0), half) > 0.3);
      for (const t of valid) {
        const dup = [...activeTracks.values()].some(at => {
          const f1 = sr / at.lag;
          const r = t.f0 > f1 ? t.f0 / f1 : f1 / t.f0;
          return Math.abs(r - Math.round(r)) < 0.05;
        });
        if (dup) continue;
        const cbIdx = findNearest(t.harmonics);
        const midi = 12 * Math.log(t.f0 / 440) / Math.log(2) + 69;
        const note = Math.max(0, Math.min(127, Math.round(midi)));
        const cent = Math.round((midi - note) * 100);
        activeTracks.set(nextTrackId, { freq: t.f0, lag: Math.round(sr / t.f0), cbIdx, note, cent, stale: 0 });
        frameEpcs.push(packEpc({ trackId: nextTrackId, codebookIdx: cbIdx, midiNote: note,
          cent: Math.max(-32, Math.min(31, cent)), onsetFlag: 1,
          velocity: Math.round(t.confidence * 127), rms: t.rms }));
        nextTrackId++;
      }
    }

    responseFrames.push(packResponseFrame(frameEpcs));
    frameCount++;
  }
  return Buffer.concat(responseFrames);
}

// ===== Decode ResponseFrames → PCM =====
function decode(epcData, sr) {
  const frameSize = sr * 20 / 1000;
  const pcmParts = [];
  const active = new Map();
  let off = 0;

  while (off + 7 <= epcData.length) {
    if (epcData[off] !== 0xBB) break;
    const dataLen = (epcData[off + 3] << 8) | epcData[off + 4];
    const frameLen = 7 + dataLen;
    if (off + frameLen > epcData.length) break;

    // Parse all EPCs, handle track lifecycle
    let epcOff = off + 5;
    const frameEnd = epcOff + dataLen;
    while (epcOff + 12 <= frameEnd) {
      const tag = unpackEpc(epcData.slice(epcOff, epcOff + 12));
      epcOff += 12;

      if (tag.type === 0x02) { // spectrum tag
        if (tag.onsetFlag === 2) { // NoteOff
          active.delete(tag.trackId);
          continue;
        }
        const freq = 440 * Math.pow(2, (tag.midiNote + tag.cent / 100 - 69) / 12);
        if (tag.onsetFlag === 1) { // NoteOn
          active.set(tag.trackId, { freq, harmonics: tag.harmonics, rms: tag.rms, velocity: tag.velocity, age: 0 });
        } else { // Sustain
          const existing = active.get(tag.trackId);
          if (existing) {
            existing.rms = tag.rms;
            existing.velocity = tag.velocity;
            existing.age = 0;
          } else {
            // Late join: create track
            active.set(tag.trackId, { freq, harmonics: tag.harmonics, rms: tag.rms, velocity: tag.velocity, age: 0 });
          }
        }
      }
    }

    // Synthesize 20ms
    const buf = Buffer.alloc(frameSize * 2);
    for (let i = 0; i < frameSize; i++) {
      let s = 0;
      for (const tone of active.values()) {
        // amp = RMS-relative gain
        const amp = tone.rms / 255;
        let hSum = 0;
        for (let h = 0; h < 8; h++) hSum += tone.harmonics[h] * tone.harmonics[h];
        const profileRms = Math.sqrt(hSum / 8) / 255;
        // Gain: output_RMS = tone.rms/255 = gain * profileRms / sqrt(2)
        // gain = amp * sqrt(2) / profileRms
        const gain = profileRms > 0 ? amp * 1.414 / profileRms : 0;
        for (let h = 0; h < 8; h++) {
          const hAmp = tone.harmonics[h] / 255;
          if (hAmp < 0.01) continue;
          s += Math.sin(2 * Math.PI * tone.freq * (h + 1) * i / sr) * gain * hAmp * 32768;
        }
      }
      const clipped = Math.max(-32768, Math.min(32767, Math.round(s)));
      buf.writeInt16LE(clipped, i * 2);
    }
    pcmParts.push(buf);
    off += frameLen;
  }

  return Buffer.concat(pcmParts);
}

// ===== Main =====
function main() {
  console.log('=== EPC Codec Roundtrip (Node.js) ===\n');

  const sr = 24000;
  const durSec = 2;
  const nSamples = sr * durSec;
  const pcm = Buffer.alloc(nSamples * 2);

  // Generate: C4(262Hz) with CODEBOOK-MATCHING exponential decay harmonics
  // Then E4(330Hz) added at 1s with same decay profile
  function codebookHarms(freq, vel) {
    const bright = vel / 126;
    let decay = freq / 2000 + (1 - bright) * 0.3;
    decay = Math.max(0.05, Math.min(2.0, decay));
    const h = [];
    for (let hh = 0; hh < 8; hh++) h.push(Math.exp(-hh * decay) * (1 + bright * 0.5));
    return h;
  }
  const hC4 = codebookHarms(262, 80);  // [~1.0, ~0.65, ~0.42, ~0.27, ~0.18, ...]
  const hE4 = codebookHarms(330, 100); // [~1.0, ~0.60, ~0.36, ~0.22, ...]

  for (let i = 0; i < nSamples; i++) {
    let s = 0;
    for (let h = 0; h < hC4.length; h++) {
      s += Math.sin(2 * Math.PI * 262 * (h + 1) * i / sr) * hC4[h];
    }
    s *= 0.3;
    if (i > sr) {
      for (let h = 0; h < hE4.length; h++) {
        s += Math.sin(2 * Math.PI * 330 * (h + 1) * i / sr) * hE4[h] * 0.6;
      }
    }
    const clipped = Math.max(-32768, Math.min(32767, Math.round(s * 32768)));
    pcm.writeInt16LE(clipped, i * 2);
  }

  writeWav('test_epc_input.wav', pcm, sr);
  console.log(`Input:  ${pcm.length}B PCM -> test_epc_input.wav`);

  // Encode
  const t0 = Date.now();
  const epcData = encode(pcm, sr);
  const t1 = Date.now();
  const bps = epcData.length / durSec;
  console.log(`Encode: ${epcData.length}B -> ${bps.toFixed(0)} B/s (${(bps * 8 / 1000).toFixed(1)} kbps), ${Math.floor(epcData.length / 12)} EPC tags`);
  console.log(`  time: ${t1 - t0}ms`);

  // Decode
  const t2 = Date.now();
  const outPcm = decode(epcData, sr);
  const t3 = Date.now();
  console.log(`Decode: ${outPcm.length}B PCM, time: ${t3 - t2}ms`);
  writeWav('test_epc_output.wav', outPcm, sr);
  console.log('Output: saved test_epc_output.wav');

  // Compare
  const minLen = Math.min(pcm.length, outPcm.length);
  let mse = 0;
  for (let i = 0; i < minLen; i++) { const d = pcm[i] - outPcm[i]; mse += d * d; }
  mse /= minLen;
  const rmsErr = Math.sqrt(mse);
  const snr = 20 * Math.log10(255 / (rmsErr + 0.001));
  console.log(`\n=== Results ===`);
  console.log(`MSE:  ${mse.toFixed(2)}`);
  console.log(`RMS:  ${rmsErr.toFixed(1)}`);
  console.log(`SNR:  ${snr.toFixed(1)} dB`);
  console.log(`Ratio: ${(pcm.length / epcData.length).toFixed(1)}x`);

  // Extract score from EPC tags
  const notes = [];
  for (let o = 0, fi = 0; o + 7 <= epcData.length; fi++) {
    const dl = (epcData[o + 3] << 8) | epcData[o + 4];
    const fl = 7 + dl;
    for (let eo = o + 5; eo < o + 5 + dl; eo += 12) {
      const t = unpackEpc(epcData.slice(eo, eo + 12));
      if (t.onsetFlag === 1) {
        const freq = 440 * Math.pow(2, (t.midiNote + t.cent / 100 - 69) / 12);
        notes.push({ time: (fi * 20 / 1000).toFixed(2) + 's', type: 'On', track: t.trackId, note: t.midiNote, freq: Math.round(freq), vel: t.velocity });
      } else if (t.onsetFlag === 2) {
        notes.push({ time: (fi * 20 / 1000).toFixed(2) + 's', type: 'Off', track: t.trackId, note: t.midiNote });
      }
    }
    o += fl;
  }

  console.log('\n=== Score Comparison ===');
  console.log('Original:');
  console.log('  0.00s  C4(262Hz) On  vel=80');
  console.log('  1.00s  E4(330Hz) On  vel=100');
  console.log('  2.00s  C4 Off + E4 Off');
  console.log('Extracted:');
  for (const n of notes) {
    const nn = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n.note % 12] + Math.floor(n.note / 12 - 1);
    console.log(`  ${n.time}  ${nn}(${n.freq}Hz) ${n.type}  track=${n.track} vel=${n.vel || '-'}`);
  }
  if (notes.length === 0) console.log('  (none)');

  // Debug special frames (0, 45-55)
  console.log('\n=== Frame-by-frame events ===');
  let off = 0;
  for (let fi = 0; off + 7 <= epcData.length; fi++) {
    const dl = (epcData[off + 3] << 8) | epcData[off + 4];
    const fl = 7 + dl;
    if (fi < 5 || (fi >= 45 && fi <= 55)) {
      const tags = [];
      for (let eo = off + 5; eo < off + 5 + dl; eo += 12) {
        const t = unpackEpc(epcData.slice(eo, eo + 12));
        const nn = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][t.midiNote % 12] + Math.floor(t.midiNote / 12 - 1);
        tags.push(`${t.onsetFlag === 1 ? 'ON' : t.onsetFlag === 2 ? 'OFF' : '   '} ${nn}(${t.midiNote}) rms=${t.rms}` +
          (t.onsetFlag !== 2 ? ` on=${t.onsetFlag}` : ''));
      }
      console.log(`  F${fi}(${(fi*20/1e3).toFixed(2)}s): ${tags.length>0 ? tags.join(' | ') : '(no EPC)'}`);
    }
    off += fl;
  }

  console.log('\n=== Debug: first 5 frames ===');
  let off2 = 0;
  for (let fi = 0; fi < 5 && off + 7 <= epcData.length; fi++) {
    const dl = (epcData[off + 3] << 8) | epcData[off + 4];
    const fl = 7 + dl;
    const tags = [];
    for (let eo = off + 5; eo < off + 5 + dl; eo += 12) {
      const t = unpackEpc(epcData.slice(eo, eo + 12));
      tags.push(`  track=${t.trackId} note=${t.midiNote} cent=${t.cent} vel=${t.velocity} rms=${t.rms} cb=${t.codebookIdx} h0=${t.harmonics[0]}`);
    }
    console.log(`  Frame ${fi}: ${tags.length} EPCs`);
    for (const t of tags) console.log(t);
    off += fl;
  }
}

function writeWav(path, pcm, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); // chunk size
  h.writeUInt16LE(1, 20);  // PCM
  h.writeUInt16LE(1, 22);  // mono
  h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); // byte rate
  h.writeUInt16LE(2, 32);  // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  const wav = Buffer.concat([h, pcm]);
  writeFileSync(path, wav);
  console.log(`  saved ${path} (${wav.length}B)`);
}

main();
