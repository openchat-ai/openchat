import { test } from 'node:test';
import assert from 'node:assert/strict';
import NnlsDetector from '../audio/nnls-detector.js';
import KsSynth from '../audio/ks-synth.js';

test('NnlsDetector: constructor defaults', () => {
  const d = new NnlsDetector();
  assert.equal(d.sr, 48000);
  assert.equal(d.hop, 1024);
  assert.equal(d.fs, 2048);
  assert.equal(d._initialized, false);
});

test('NnlsDetector: initialize builds dict and H matrix', () => {
  const d = new NnlsDetector();
  d.initialize();
  assert(d._initialized);
  assert.equal(d.dict.length, 1024);
  assert.equal(d.dict[0].length, 88);
  assert.equal(d.Hm.length, 88);
  assert.equal(d.Hm[0].length, 88);
  assert(d.win.length === 2048);
});

test('NnlsDetector: detect returns array with correct shape', () => {
  const d = new NnlsDetector();
  const sr = 48000;
  const sig = new Float64Array(sr * 0.5);
  for (let i = 0; i < sig.length; i++) {
    sig[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.5;
  }
  const notes = d.detect(sig);
  assert(Array.isArray(notes));
  for (const n of notes) {
    assert(typeof n.m === 'number');
    assert(typeof n.f === 'number');
    assert(typeof n.s === 'number');
    assert(typeof n.d === 'number');
  }
});

test('NnlsDetector: detectDrums returns array', () => {
  const d = new NnlsDetector();
  const sig = new Float64Array(48000);
  for (let i = 0; i < sig.length; i++) { sig[i] = Math.random() * 2 - 1; }
  const drums = d.detectDrums(sig);
  assert(Array.isArray(drums));
});

test('NnlsDetector: detect empty signal returns empty', () => {
  const d = new NnlsDetector();
  const sig = new Float64Array(4800);
  const notes = d.detect(sig);
  assert(Array.isArray(notes));
});

test('KsSynth: constructor', () => {
  const s = new KsSynth();
  assert.equal(s.sr, 48000);
});

test('KsSynth: guitar returns Float64Array or null for null note', () => {
  const s = new KsSynth();
  const r1 = s.guitar({ m: 60, d: 0.2, c: 0.8 });
  assert(r1 instanceof Float64Array);
  assert(r1.length > 0);
  const r2 = s.guitar({ m: null });
  assert.equal(r2, null);
});

test('KsSynth: bass returns Float64Array', () => {
  const s = new KsSynth();
  const r = s.bass({ m: 36, d: 0.3, c: 0.6 });
  assert(r instanceof Float64Array);
  assert(r.length > 0);
});

test('KsSynth: bass handles null note', () => {
  const s = new KsSynth();
  assert.equal(s.bass({ m: null }), null);
});

test('KsSynth: drum returns Float64Array for each type', () => {
  const s = new KsSynth();
  for (const inst of ['kick', 'snare', 'hihat']) {
    const r = s.drum({ inst });
    assert(r instanceof Float64Array);
    assert(r.length > 0);
  }
});

test('KsSynth: render mixes multiple notes', () => {
  const s = new KsSynth();
  const notes = [
    { m: 60, s: 0.0, d: 0.2, c: 0.8, inst: 'guitar' },
    { m: 64, s: 0.25, d: 0.2, c: 0.7, inst: 'guitar' },
    { m: 36, s: 0.0, d: 0.4, c: 0.6, inst: 'bass' },
  ];
  const sr = 48000;
  const maxEnd = notes.reduce((mx, n) => Math.max(mx, n.s + n.d), 0);
  const totalLen = Math.ceil(maxEnd * sr);
  const out = s.render(notes, totalLen);
  assert(out instanceof Float64Array);
  assert.equal(out.length, totalLen);
  assert(out.some(v => v !== 0), 'render output should not be all zeros');
});

test('KsSynth: mix blends two arrays', () => {
  const s = new KsSynth();
  const a = new Float64Array(100); a[50] = 0.5;
  const b = new Float64Array(100); b[50] = 0.5;
  const m = s.mix(a, b, 0.5);
  assert.equal(m.length, 100);
  assert(Math.abs(m[50] - (0.5 + 0.5 * 0.5)) < 1e-10);
});

test('KsSynth: _ksSynth NaN guard returns null for invalid freq', () => {
  const s = new KsSynth();
  assert.equal(s._ksSynth(NaN, 0.5, 0.5, 0.99), null);
  assert.equal(s._ksSynth(Infinity, 0.5, 0.5, 0.99), null);
  assert.equal(s._ksSynth(0, 0.5, 0.5, 0.99), null);
});

test('KsSynth: _ksSynth envelope does not break before t=0.001', () => {
  const s = new KsSynth();
  const r = s._ksSynth(440, 0.5, 0.5, 0.998);
  assert(r instanceof Float64Array);
  assert(r.length > 0);
  // second sample should be non-zero (envelope ramp starts at 0)
  assert(r[1] !== 0, 'second sample should not be zero (envelope bug)');
  assert(r[0] === 0, 'first sample at t=0 should be zero (ramp from 0)');
});
