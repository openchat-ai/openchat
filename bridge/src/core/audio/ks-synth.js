const DEFAULT_SR = 48000;

export class KsSynth {
  constructor(options = {}) {
    this.sr = options.sampleRate || DEFAULT_SR;
  }

  /**
   * KS 波表合成单音
   * @param {number} freq  频率 (Hz)
   * @param {number} durS  时长 (秒)
   * @param {number} vol   音量 (0-1)
   * @param {number} dec   衰减因子
   * @returns {Float64Array|null}
   */
  _ksSynth(freq, durS, vol, dec) {
    const sr = this.sr;
    const del = Math.round(sr / freq); if (!isFinite(del) || del < 4) return null;
    const out = new Float64Array(Math.round(durS * sr));
    const buf = new Float64Array(del);
    for (let i = 0; i < del; i++) {
      buf[i] = (Math.random() * 2 - 1) * 0.3 +
        (i < del * 0.4 ? Math.sin(Math.PI * i / del) * 0.7 : 0);
    }
    let wi = 0, lp = 0;
    for (let i = 0; i < out.length; i++) {
      const s = buf[wi];
      lp = lp * 0.93 + ((buf[wi] + buf[(wi - 1 + del) % del]) * 0.5) * 0.07;
      buf[wi] = lp * dec;
      wi = (wi + 1) % del;
      const t = i / sr, e = t < 0.001 ? t / 0.001 : Math.exp(-2 * (t - 0.001));
      if (e > 0) out[i] = s * e * vol;
      if (t >= 0.001 && e < 0.0001) break;
    }
    return out;
  }

  /**
   * 合成吉他音
   * @param {{m:number, d:number, c:number}} note
   * @returns {Float64Array|null}
   */
  guitar(note) {
    if (note.m == null) return null;
    const freq = 440 * 2 ** ((note.m - 69) / 12);
    const del = Math.round(this.sr / freq);
    const dec = 0.998 ** (1 / del);
    return this._ksSynth(freq, note.d || 0.3, 0.15 + (note.c || 0.5) * 0.25, dec);
  }

  bass(note) {
    if (note.m == null) return null;
    const freq = 440 * 2 ** ((note.m - 69) / 12);
    const del = Math.round(this.sr / freq);
    const dec = 0.9995 ** (1 / del);
    return this._ksSynth(freq, note.d || 0.3, 0.2 + (note.c || 0.5) * 0.3, dec);
  }

  /**
   * 合成贝斯音
   * @param {{m:number, d:number, c:number}} note
   * @returns {Float64Array|null}
   */
  bass(note) {
    const freq = 440 * 2 ** ((note.m - 69) / 12);
    const del = Math.round(this.sr / freq);
    const dec = 0.9995 ** (1 / del);
    return this._ksSynth(freq, note.d, 0.2 + note.c * 0.3, dec);
  }

  /**
   * 合成鼓音
   * @param {{inst:'kick'|'snare'|'hihat'}} note
   * @returns {Float64Array}
   */
  drum(note) {
    const o = new Float64Array(Math.round(0.15 * this.sr));
    for (let i = 0; i < o.length; i++) {
      const t = i / this.sr; let s = 0;
      if (note.inst === 'kick')
        s = Math.sin(2 * Math.PI * 60 * t) * Math.exp(-20 * t) +
          (Math.random() * 2 - 1) * 0.3 * Math.exp(-40 * t);
      else if (note.inst === 'snare')
        s = Math.sin(2 * Math.PI * 200 * t) * Math.exp(-15 * t) * 0.5 +
          (Math.random() * 2 - 1) * Math.exp(-12 * t) * 0.6;
      else
        s = (Math.random() * 2 - 1) * Math.exp(-30 * t) * 0.4;
      o[i] = s * 0.5;
    }
    return o;
  }

  /**
   * 渲染全部音符到音频
   * @param {Array<{m:number, s:number, d:number, c:number, inst:string}>} notes
   * @param {number} totalSamples  输出长度
   * @returns {Float64Array}
   */
  render(notes, totalSamples) {
    const sorted = [...notes].sort((a, b) => a.s - b.s);
    const out = new Float64Array(totalSamples);
    let count = 0;
    for (const n of sorted) {
      const ss = Math.round(n.s * this.sr);
      const i = n.inst || 'guitar';
      const fn = i === 'guitar' ? this.guitar.bind(this) :
                 i === 'bass' ? this.bass.bind(this) :
                 i === 'drum' ? () => this.drum(n) : this.guitar.bind(this);
      const tone = fn(n); if (!tone) continue;
      for (let i = 0; i < tone.length && ss + i < out.length; i++)
        out[ss + i] += tone[i] * (n.c || 1);
      count++;
    }
    return out;
  }

  /**
   * 混合合成音频和原始音频
   * @param {Float64Array} synth   合成音频
   * @param {Float64Array} original  原始音频
   * @param {number} mixRatio  原始音量比例 (默认 0.3)
   * @returns {Float64Array}
   */
  mix(synth, original, mixRatio = 0.3) {
    const len = Math.min(synth.length, original.length);
    const out = new Float64Array(len);
    for (let i = 0; i < len; i++) out[i] = synth[i] + original[i] * mixRatio;
    return out;
  }
}

export default KsSynth;
