const DEFAULT_SR = 48000, DEFAULT_HOP = 1024, DEFAULT_FS = 2048, HALF = DEFAULT_FS >> 1;
const NM_MIN = 21, NM_MAX = 108, NM_CNT = 88;

export class NnlsDetector {
  constructor(options = {}) {
    this.sr = options.sampleRate || DEFAULT_SR;
    this.hop = options.hop || DEFAULT_HOP;
    this.fs = options.fs || DEFAULT_FS;
    this.half = this.fs >> 1;
    this._initialized = false;
  }

  initialize() {
    if (this._initialized) return;

    this.win = new Float64Array(this.fs);
    for (let i = 0; i < this.fs; i++) this.win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / this.fs));

    this.dict = new Array(this.half);
    for (let b = 0; b < this.half; b++) this.dict[b] = new Float64Array(NM_CNT);
    for (let ni = 0; ni < NM_CNT; ni++) {
      const f = 440 * Math.pow(2, (NM_MIN + ni - 69) / 12);
      for (let h = 1; h <= 10; h++) {
        const hf = f * h; if (hf > this.sr / 2) break;
        const b = Math.round(hf * this.fs / this.sr);
        if (b >= 0 && b < this.half) this.dict[b][ni] += Math.pow(h, -1);
      }
    }
    for (let ni = 0; ni < NM_CNT; ni++) {
      let s = 0; for (let b = 0; b < this.half; b++) s += this.dict[b][ni] ** 2;
      const n = Math.sqrt(s) || 1; for (let b = 0; b < this.half; b++) this.dict[b][ni] /= n;
    }

    this.Hm = new Array(NM_CNT);
    for (let i = 0; i < NM_CNT; i++) {
      this.Hm[i] = new Float64Array(NM_CNT);
      for (let j = 0; j < NM_CNT; j++) {
        let s = 0; for (let b = 0; b < this.half; b++) s += this.dict[b][i] * this.dict[b][j];
        this.Hm[i][j] = s;
      }
    }

    this._re = new Float64Array(this.fs);
    this._im = new Float64Array(this.fs);
    this._g = new Float64Array(NM_CNT);
    this._Hx = new Float64Array(NM_CNT);
    this._initialized = true;
  }

  _fft() {
    const n = this.fs;
    const re = this._re, im = this._im;
    for (let i = 1, j = 0; i < n; i++) {
      let b = n >> 1;
      for (; j & b; b >>= 1) j ^= b;
      j ^= b;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let l = 2; l <= n; l <<= 1) {
      const a = -2 * Math.PI / l;
      for (let i = 0; i < n; i += l) {
        for (let j = 0; j < l >> 1; j++) {
          const u = i + j, v = i + j + (l >> 1);
          const wr = Math.cos(a * j), wi = Math.sin(a * j);
          const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v];
          re[v] = re[u] - tr; im[v] = im[u] - ti;
          re[u] += tr; im[u] += ti;
        }
      }
    }
  }

  _nnlsFrame(mag) {
    for (let i = 0; i < NM_CNT; i++) {
      let s = 0; for (let b = 0; b < this.half; b++) s += this.dict[b][i] * mag[b];
      this._g[i] = Math.max(s, 1e-12);
    }
    const x = new Float64Array(NM_CNT);
    for (let i = 0; i < NM_CNT; i++) x[i] = 1e-4;
    for (let it = 0; it < 50; it++) {
      for (let i = 0; i < NM_CNT; i++) {
        let s = 0; for (let j = 0; j < NM_CNT; j++) s += this.Hm[i][j] * x[j];
        this._Hx[i] = Math.max(s, 1e-12);
      }
      let ch = 0;
      for (let i = 0; i < NM_CNT; i++) {
        const nv = x[i] * this._g[i] / this._Hx[i]; ch += Math.abs(nv - x[i]); x[i] = nv;
      }
      if (ch < 1e-8 * NM_CNT) break;
    }
    const notes = [];
    for (let ni = 0; ni < NM_CNT; ni++) if (x[ni] > 1e-6) notes.push({ ni, midi: NM_MIN + ni, act: x[ni] });
    notes.sort((a, b) => b.act - a.act);
    const kept = [];
    for (const n of notes) {
      let ih = false;
      for (const k of kept) {
        const r = 2 ** ((n.midi - k.midi) / 12);
        if (r > 1.8 && r < 2.2 || r > 2.8 && r < 3.2) { ih = true; break; }
      }
      if (!ih) { kept.push(n); if (kept.length >= 5) break; }
    }
    const maxA = kept.length ? kept[0].act : 1;
    return kept.filter(n => n.act / maxA > 0.05).map(n => ({
      f: Math.round(440 * 2 ** ((n.midi - 69) / 12) * 10) / 10,
      m: n.midi, c: Math.min(1, n.act / maxA)
    }));
  }

  _highpass(sig, fc) {
    const a = 1 - 2 * Math.PI * fc / this.sr;
    const o = new Float64Array(sig.length); let y = 0;
    for (let i = 1; i < sig.length; i++) { y = sig[i] - sig[i - 1] + a * y; o[i] = y; }
    return o;
  }

  _lowpass(sig, fc) {
    const o = new Float64Array(sig.length); let y = 0;
    for (let i = 0; i < sig.length; i++) { y = y * fc + sig[i] * (1 - fc); o[i] = y; }
    return o;
  }

  _track(raw) {
    const act = {}, out = [];
    for (const n of raw) {
      const r = Math.round(n.m);
      if (act[r]) {
        if (n.t - act[r].l > 0.05) {
          const d = act[r].l - act[r].s;
          if (d > 0.04) out.push({ m: r, f: act[r].fs / act[r].cnt, s: act[r].s, d, c: act[r].c });
          act[r] = { fs: n.f, c: n.c, s: n.t, l: n.t, cnt: 1 };
        } else { act[r].fs += n.f; act[r].c = Math.max(act[r].c, n.c); act[r].l = n.t; act[r].cnt++; }
      } else { act[r] = { fs: n.f, c: n.c, s: n.t, l: n.t, cnt: 1 }; }
    }
    for (const [r, a] of Object.entries(act)) {
      const d = a.l - a.s; if (a.cnt >= 2 && d > 0.04) out.push({ m: parseInt(r), f: a.fs / a.cnt, s: a.s, d, c: a.c });
    }
    return out.sort((a, b) => a.s - b.s);
  }

  _detectBand(sig, minF, maxF, minC) {
    const { hop, fs, sr, win, _re, _im } = this;
    const tf = Math.floor((sig.length - fs) / hop) + 1, raw = [];
    for (let fi = 0; fi < tf; fi++) {
      const fr = sig.subarray(fi * hop, fi * hop + fs);
      for (let i = 0; i < fs; i++) { _re[i] = fr[i] * win[i]; _im[i] = 0; }
      this._fft();
      const mag = new Float64Array(this.half);
      for (let i = 0; i < this.half; i++) mag[i] = Math.sqrt(_re[i] * _re[i] + _im[i] * _im[i]);
      const dets = this._nnlsFrame(mag);
      for (const d of dets) if (d.f > minF && d.f < maxF && d.c > minC)
        raw.push({ t: fi * hop / sr, f: d.f, m: d.m, c: d.c });
    }
    return this._track(raw);
  }

  /**
   * 对一段音频做多音高检测
   * @param {Float64Array} samples  PCM 样点
   * @param {object} options
   * @param {string} options.instrument 'guitar'|'bass'
   * @returns {Array<{m:number, f:number, s:number, d:number, c:number}>}
   */
  detect(samples, options = {}) {
    if (!this._initialized) this.initialize();
    const inst = options.instrument || 'guitar';
    let sig = samples;

    if (inst === 'guitar') {
      sig = this._highpass(samples, 200);
      return this._detectBand(sig, 80, 1500, 0.15);
    }

    if (inst === 'bass') {
      sig = this._highpass(samples, 40);
      sig = this._lowpass(sig, 0.996);
      return this._detectBand(sig, 40, 180, 0.1);
    }

    sig = this._highpass(samples, 80);
    return this._detectBand(sig, 80, 1500, 0.15);
  }

  /**
   * 检测鼓点（包络峰值 + ZCR）
   */
  detectDrums(samples) {
    const sr = this.sr;
    const env = new Float64Array(samples.length); let lp = 0;
    for (let i = 0; i < samples.length; i++) { lp += (Math.abs(samples[i]) - lp) * 0.01; env[i] = lp; }
    const out = []; let last = -Math.round(sr * 0.1);
    for (let i = Math.round(sr * 0.1); i < samples.length - 1; i++) {
      if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > 0.03) {
        const base = env[Math.max(0, i - Math.round(sr * 0.03))];
        if (env[i] > base * 2.2 && i - last > Math.round(sr * 0.1)) {
          last = i; const seg = samples.subarray(Math.max(0, i - 128), Math.min(samples.length, i + 384));
          let zcr = 0; for (let j = 1; j < seg.length; j++) if (seg[j] * seg[j - 1] < 0) zcr++;
          out.push({ s: i / sr, m: 0, inst: zcr / seg.length < 0.06 ? 'kick' : zcr / seg.length < 0.18 ? 'snare' : 'hihat', c: Math.min(1, env[i] / base / 3), d: 0.1 });
        }
      }
    }
    return out;
  }
}

export default NnlsDetector;
