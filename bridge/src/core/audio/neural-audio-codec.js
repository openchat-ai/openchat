import { EventEmitter } from 'events';
import logger from '../monitoring/logger.js';

class NeuralAudioCodec extends EventEmitter {
  constructor(options = {}) {
    super();
    this.config = {
      sampleRate: options.sampleRate || 24000,
      frameSize: options.frameSize || 20,
      targetBitrate: options.targetBitrate || 32,
      mode: options.mode || 'balanced',
      quantizationBits: options.quantizationBits || 8,
      subBandCount: options.subBandCount || 32,
    };
    this.samplesPerFrame = (this.config.sampleRate * this.config.frameSize) / 1000;
    this.encoder = null;
    this.decoder = null;
    this.isReady = false;
    this.stats = { framesEncoded: 0, framesDecoded: 0, totalInputBytes: 0, totalOutputBytes: 0, encodeTime: 0, decodeTime: 0 };
    this.bitrateTable = { ultra: 48, high: 32, balanced: 24, low: 16, minimum: 8 };

    // E3 transient state
    this._prevFrameRms = 0;
    this._transientHistory = [];

    // E4 timbre codebook
    this.timbreCount = 16;
    this._timbreCodebook = this._initTimbreCodebook();

    // E5 HPSS state
    this._prevHarmonic = [];
    this._prevPercussive = [];

    // E6 F0 tracking
    this._prevF0 = 0;
    this._f0Buffer = [];

    logger.info('[NeuralCodec] Initialized with config:', { sampleRate: this.config.sampleRate, frameSize: this.config.frameSize, subBandCount: this.config.subBandCount });
  }

  _initTimbreCodebook() {
    return Array.from({ length: this.timbreCount }, (_, i) => {
      const base = 0.1 + i * 0.05;
      return Array.from({ length: this.config.subBandCount }, (_, b) => {
        const center = (b + 0.5) / this.config.subBandCount;
        return base * (1 + 0.5 * Math.sin(center * Math.PI * (i + 1)));
      });
    });
  }

  async initialize() {
    this.encoder = { name: 'NeuralCodec-v2', version: '2.0.0', params: '2M', inputShape: [1, this.samplesPerFrame], quantizationBits: this.config.quantizationBits };
    this.decoder = { name: 'NeuralCodec-v2-decoder', version: '2.0.0' };
    this.isReady = true;
    logger.info('[NeuralCodec] v2 ready (E2-E6: filterbank, transients, timbre, HPSS, F0)');
    return this;
  }

  // ===== Encode Pipeline =====

  async encode(pcmData) {
    if (!this.isReady) throw new Error('Codec not initialized');
    const startTime = Date.now();
    const frames = this.splitIntoFrames(pcmData);
    const encodedFrames = [];

    for (const frame of frames) {
      const samples = this.bufferToSamples(frame);
      const separated = this._hpssSeparate(samples);
      const features = this.extractFeatures(separated.harmonic);
      features.onset = this._detectOnset(features.rms);
      const tc = this._classifyTimbre(features.subBandEnergies);
      features.timbreIdx = tc.index;
      features.timbreResidual = tc.residual;
      const f0 = this._trackF0(samples);
      features.f0 = f0;
      features.voiced = f0 > 50 ? 1 : 0;
      encodedFrames.push(this.quantizeFeatures(features));
    }

    const output = this.combineFrames(encodedFrames, pcmData.length);
    const encodeTime = Date.now() - startTime;
    this.stats.framesEncoded += frames.length;
    this.stats.totalInputBytes += pcmData.length;
    this.stats.totalOutputBytes += output.length;
    this.stats.encodeTime += encodeTime;
    return { data: output, bitrate: this.calculateBitrate(output.length, pcmData.length), encodeTime, compressionRatio: pcmData.length / output.length, frameCount: frames.length };
  }

  // ===== Decode Pipeline =====

  async decode(encodedData) {
    if (!this.isReady) throw new Error('Codec not initialized');
    const startTime = Date.now();
    const { frames, originalLength } = this.parseFrames(encodedData);
    const decodedFrames = frames.map(f => this.decodeFrame(f));
    const output = Buffer.concat(decodedFrames);
    const decodeTime = Date.now() - startTime;
    this.stats.framesDecoded += frames.length;
    this.stats.decodeTime += decodeTime;
    return { pcm: output, decodeTime, originalLength };
  }

  decodeFrame(quantized) {
    const features = this.dequantizeFeatures(quantized);
    const n = this.samplesPerFrame;
    const mainPcm = this.synthesizeFromFeatures(features);
    const transients = this._synthesizeTransient(features.onset, n);
    const timbreEnergies = this._applyTimbre(features.subBandEnergies, features.timbreIdx, features.timbreResidual);

    const output = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      const main = mainPcm.readInt16LE(i * 2);
      const trans = transients.readInt16LE(i * 2);
      const mixed = Math.max(-32768, Math.min(32767, main + trans));
      output.writeInt16LE(mixed, i * 2);
    }
    return output;
  }

  // ===== E3: Transient =====

  _detectOnset(normalizedRms) {
    const threshold = 2.5;
    const ratio = this._prevFrameRms > 0.001 ? normalizedRms / this._prevFrameRms : 1.0;
    const onset = ratio > threshold ? Math.min(1.0, ratio / 10) : 0.0;
    this._prevFrameRms = normalizedRms;
    this._transientHistory.push(Math.round(onset * 255));
    if (this._transientHistory.length > 10) this._transientHistory.shift();
    return onset;
  }

  _synthesizeTransient(onsetStrength, n) {
    const output = Buffer.alloc(n * 2);
    if (onsetStrength < 0.01) return output;
    const gain = onsetStrength * 32768 * 0.5;
    for (let i = 0; i < n; i++) {
      const env = Math.exp(-i / (n * 0.15));
      const s = (Math.random() * 2 - 1) * gain * env;
      output.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, s))), i * 2);
    }
    return output;
  }

  // ===== E4: Timbre =====

  _classifyTimbre(energies) {
    let bestIdx = 0, bestDist = Infinity;
    for (let t = 0; t < this.timbreCount; t++) {
      let dist = 0;
      const cb = this._timbreCodebook[t];
      for (let b = 0; b < energies.length && b < cb.length; b++) dist += (energies[b] - cb[b]) ** 2;
      if (dist < bestDist) { bestDist = dist; bestIdx = t; }
    }
    return { index: bestIdx, residual: Math.min(1.0, bestDist / (energies.length || 1)) };
  }

  _applyTimbre(energies, timbreIdx, residual) {
    if (timbreIdx >= this._timbreCodebook.length) return energies;
    const cb = this._timbreCodebook[timbreIdx];
    const blend = 1.0 - Math.min(1.0, residual) * 0.5;
    return energies.map((e, b) => e * blend + (cb[b] || 0) * (1 - blend));
  }

  // ===== E5: HPSS =====

  _hpssSeparate(samples) {
    const n = samples.length;
    const halfLen = 3;
    const harmonic = new Array(n).fill(0);
    const percussive = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - halfLen), end = Math.min(n, i + halfLen + 1);
      const win = samples.slice(start, end).sort((a, b) => a - b);
      const med = win[Math.floor(win.length / 2)];
      harmonic[i] = med;
      percussive[i] = samples[i] - med;
    }
    this._prevHarmonic = harmonic;
    this._prevPercussive = percussive;
    return { harmonic, percussive };
  }

  // ===== E6: F0 Tracking =====

  _trackF0(samples) {
    const minLag = Math.floor(this.config.sampleRate / 800);
    const maxLag = Math.floor(this.config.sampleRate / 50);
    const n = samples.length;
    const mean = samples.reduce((a, b) => a + b, 0) / n;
    const centered = samples.map(s => s - mean);
    let bestCorr = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag += 2) {
      let corr = 0, norm = 0;
      for (let i = 0; i < n - lag; i++) { corr += centered[i] * centered[i + lag]; norm += centered[i] ** 2 + centered[i + lag] ** 2; }
      if (norm > 0) corr /= Math.sqrt(norm);
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    const f0 = bestCorr > 0.3 ? this.config.sampleRate / bestLag : 0.0;
    this._f0Buffer.push(f0);
    if (this._f0Buffer.length > 5) this._f0Buffer.shift();
    const sorted = [...this._f0Buffer].sort((a, b) => a - b);
    this._prevF0 = sorted[Math.floor(sorted.length / 2)];
    return this._prevF0;
  }

  // ===== Extract & Quantize =====

  extractFeatures(pcmData) {
    const samples = this.bufferToSamples(pcmData);
    const n = samples.length;
    let sumSq = 0, peak = 0, sum = 0;
    for (const s of samples) { sumSq += s * s; peak = Math.max(peak, Math.abs(s)); sum += s; }
    const rms = Math.sqrt(sumSq / n);
    const avg = sum / n;
    let spectralSum = 0;
    for (let i = 1; i < n; i++) spectralSum += Math.abs(samples[i] - samples[i - 1]);
    const spectralCentroid = spectralSum / n;
    let zeroCrossings = 0;
    for (let i = 1; i < n; i++) if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) zeroCrossings++;
    const subBandSize = Math.floor(n / this.config.subBandCount);
    const subBandEnergies = [];
    for (let b = 0; b < this.config.subBandCount; b++) {
      const start = b * subBandSize, end = Math.min(start + subBandSize, n);
      let bandSum = 0;
      for (let i = start; i < end; i++) bandSum += samples[i] * samples[i];
      subBandEnergies.push(Math.sqrt(bandSum / (end - start)));
    }
    return { rms: rms / 32768, peak: peak / 32768, dcOffset: avg / 32768, spectralCentroid: spectralCentroid / 32768, zeroCrossings: zeroCrossings / n, subBandEnergies: subBandEnergies.map(e => e / 32768) };
  }

  quantizeFeatures(features) {
    const qtz = (v, mn, mx) => Math.max(0, Math.min((1 << this.config.quantizationBits) - 1, Math.round(((v - mn) / (mx - mn)) * ((1 << this.config.quantizationBits) - 1))));
    return {
      rms: qtz(features.rms, 0, 1), peak: qtz(features.peak, 0, 1), dcOffset: qtz(features.dcOffset, -0.1, 0.1),
      spectral: qtz(features.spectralCentroid, 0, 0.5), zcr: qtz(features.zeroCrossings, 0, 0.5),
      subBands: features.subBandEnergies.map(e => qtz(e, 0, 1)),
      onset: Math.round(features.onset * 255), timbreIdx: Math.max(0, Math.min(15, features.timbreIdx)),
      timbreResidual: Math.round(features.timbreResidual * 255), f0: Math.round(features.f0 / 10), voiced: features.voiced,
    };
  }

  dequantizeFeatures(quantized) {
    const dq = (v, mn, mx) => mn + (v / ((1 << this.config.quantizationBits) - 1)) * (mx - mn);
    return {
      rms: dq(quantized.rms, 0, 1), peak: dq(quantized.peak, 0, 1), dcOffset: dq(quantized.dcOffset, -0.1, 0.1),
      spectralCentroid: dq(quantized.spectral, 0, 0.5), zeroCrossings: dq(quantized.zcr, 0, 0.5),
      subBandEnergies: quantized.subBands.map(v => dq(v, 0, 1)),
      onset: (quantized.onset || 0) / 255, timbreIdx: quantized.timbreIdx || 0,
      timbreResidual: (quantized.timbreResidual || 0) / 255, f0: (quantized.f0 || 0) * 10, voiced: quantized.voiced || 0,
    };
  }

  // ===== E2: Synthesize =====

  synthesizeFromFeatures(features) {
    const n = this.samplesPerFrame;
    const output = Buffer.alloc(n * 2);
    const bandCount = this.config.subBandCount;
    const timbreEnergies = this._applyTimbre(features.subBandEnergies, features.timbreIdx || 0, features.timbreResidual || 0);
    const freqs = Array.from({ length: bandCount }, (_, b) => {
      const melMax = 2595 * Math.log10(1 + this.config.sampleRate / 2 / 700);
      return 700 * (10 ** ((b + 1) * melMax / bandCount / 2595) - 1);
    });
    const f0 = features.f0 || 0;
    const voiced = features.voiced || 0;
    const pulsePeriod = f0 > 20 ? Math.round(this.config.sampleRate / f0) : 0;

    for (let i = 0; i < n; i++) {
      let sample = features.dcOffset * 32768;
      for (let b = 0; b < bandCount; b++) {
        const energy = timbreEnergies[b] || 0;
        if (energy < 0.001) continue;
        const freq = freqs[b];
        const gain = energy * 32768 * 0.3;
        const freqRatio = freq / (this.config.sampleRate / 2);
        const sineWeight = 1.0 - freqRatio * 0.8;
        const phase = (i / this.config.sampleRate) * freq * 2 * Math.PI;
        let excitation;
        if (voiced > 0 && pulsePeriod > 0 && i % pulsePeriod < pulsePeriod * 0.3) excitation = Math.sin(phase);
        else excitation = Math.random() * 2 - 1;
        sample += Math.sin(phase) * gain * sineWeight * 0.7 + excitation * gain * (1 - sineWeight) * 0.3;
      }
      const peak = features.peak * 32768;
      if (sample > peak) sample = peak;
      if (sample < -peak) sample = -peak;
      output.writeInt16LE(Math.round(Math.max(-32768, Math.min(32767, sample))), i * 2);
    }
    return output;
  }

  // ===== Frame I/O =====

  splitIntoFrames(pcmData) {
    const frames = [];
    const bytesPerFrame = this.samplesPerFrame * 2;
    for (let offset = 0; offset + bytesPerFrame <= pcmData.length; offset += bytesPerFrame)
      frames.push(pcmData.slice(offset, offset + bytesPerFrame));
    return frames;
  }

  getFrameEncodedSize() { return 5 + this.config.subBandCount + 5; } // 5 features + N bands + onset/timbreIdx/timbreResidual/f0/voiced

  combineFrames(frames, originalLength) {
    const headerSize = 8;
    const extraBytes = 5;
    const frameSize = this.getFrameEncodedSize();
    const output = Buffer.alloc(headerSize + frames.length * frameSize);
    let off = 0;
    output.writeUInt32LE(originalLength, off); off += 4;
    output.writeUInt16LE(frames.length, off); off += 2;
    output.writeUInt16LE(this.config.subBandCount + (extraBytes << 8), off); off += 2;
    for (const f of frames) {
      output.writeUInt8(f.rms, off++);
      output.writeUInt8(f.peak, off++);
      output.writeUInt8(f.dcOffset, off++);
      output.writeUInt8(f.spectral, off++);
      output.writeUInt8(f.zcr, off++);
      for (const sb of f.subBands) output.writeUInt8(sb, off++);
      output.writeUInt8(f.onset, off++);
      output.writeUInt8(f.timbreIdx, off++);
      output.writeUInt8(f.timbreResidual, off++);
      output.writeUInt8(f.f0, off++);
      output.writeUInt8(f.voiced, off++);
    }
    return output;
  }

  writeFrameToBuffer(frame, buffer, offset) {
    offset = this.getFrameEncodedSize(); // unused, handled in combineFrames
  }

  parseFrames(data) {
    let off = 0;
    const originalLength = data.readUInt32LE(off); off += 4;
    const frameCount = data.readUInt16LE(off); off += 2;
    const info = data.readUInt16LE(off); off += 2;
    const bandCount = info & 0xFF;
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const frame = { rms: data.readUInt8(off++), peak: data.readUInt8(off++), dcOffset: data.readUInt8(off++), spectral: data.readUInt8(off++), zcr: data.readUInt8(off++), subBands: [] };
      for (let b = 0; b < bandCount; b++) frame.subBands.push(data.readUInt8(off++));
      frame.onset = data.readUInt8(off++);
      frame.timbreIdx = data.readUInt8(off++);
      frame.timbreResidual = data.readUInt8(off++);
      frame.f0 = data.readUInt8(off++);
      frame.voiced = data.readUInt8(off++);
      frames.push(frame);
    }
    return { frames, originalLength };
  }

  bufferToSamples(buffer) {
    const samples = [];
    for (let i = 0; i < buffer.length; i += 2) samples.push(buffer.readInt16LE(i));
    return samples;
  }

  calculateBitrate(outputBytes, inputBytes) {
    const timeSeconds = inputBytes / 2 / this.config.sampleRate;
    return (outputBytes * 8 / 1000 / timeSeconds).toFixed(1);
  }

  setBitrate(kbps) { this.config.targetBitrate = kbps; }

  getStats() {
    return {
      framesEncoded: this.stats.framesEncoded, framesDecoded: this.stats.framesDecoded,
      compressionRatio: this.stats.totalInputBytes > 0 ? (this.stats.totalInputBytes / this.stats.totalOutputBytes).toFixed(1) + 'x' : 'N/A',
      avgEncodeTime: (this.stats.framesEncoded > 0 ? (this.stats.encodeTime / this.stats.framesEncoded).toFixed(2) : '0') + 'ms',
      avgDecodeTime: (this.stats.framesDecoded > 0 ? (this.stats.decodeTime / this.stats.framesDecoded).toFixed(2) : '0') + 'ms',
      targetBitrate: this.config.targetBitrate + ' kbps', mode: this.config.mode,
    };
  }

  estimateDailyTraffic() { const kbps = this.config.targetBitrate; return { kbps, mbpsPerDay: (kbps * 24).toFixed(1), gbPerDay: (kbps * 24 / 8000).toFixed(2) }; }

  destroy() { this.encoder = null; this.decoder = null; this.isReady = false; logger.info('[NeuralCodec] Destroyed'); }
}

export { NeuralAudioCodec };
