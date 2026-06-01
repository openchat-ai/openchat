import { Router } from 'express';
import KsSynth from '../../core/audio/ks-synth.js';

const router = Router();
const synth = new KsSynth();

function pcmToWav(pcm, sr) {
  const n = pcm.length, d = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) d.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32768))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, d]);
}

// C 大调音阶预览
router.get('/scale', (req, res) => {
  const sr = 48000, dur = 0.4, gap = 0.05;
  const scale = [60, 62, 64, 65, 67, 69, 71, 72]; // C4-C5
  const totalLen = Math.round(scale.length * (dur + gap) * sr);
  const out = new Float64Array(totalLen);
  for (let si = 0; si < scale.length; si++) {
    const note = { m: scale[si], d: dur, c: 0.8 };
    const tone = synth.guitar(note);
    if (!tone) continue;
    const off = Math.round(si * (dur + gap) * sr);
    for (let i = 0; i < tone.length && off + i < out.length; i++) out[off + i] += tone[i];
  }
  const wav = pcmToWav(out, sr);
  res.set('Content-Type', 'audio/wav');
  res.set('Content-Disposition', 'inline; filename="scale.wav"');
  res.send(wav);
});

// 从音符数据渲染
router.post('/render', (req, res) => {
  const { notes, sampleRate = 48000, mixRatio } = req.body;
  if (!notes || !Array.isArray(notes) || notes.length === 0) {
    return res.status(400).json({ error: 'need notes array' });
  }
  const maxEnd = notes.reduce((m, n) => Math.max(m, (n.s || 0) + (n.d || 0.3)), 0);
  const totalLen = Math.max(Math.ceil(maxEnd * sampleRate), 1);
  const out = synth.render(notes, totalLen);
  if (mixRatio != null) {
    const orig = new Float64Array(totalLen);
    for (let i = 0; i < totalLen && i < (req.body.original?.length || 0); i++) orig[i] = req.body.original[i];
    const mixed = synth.mix(out, orig, mixRatio);
    const wav = pcmToWav(mixed, sampleRate);
    res.set('Content-Type', 'audio/wav'); res.send(wav);
    return;
  }
  const wav = pcmToWav(out, sampleRate);
  res.set('Content-Type', 'audio/wav');
  res.send(wav);
});

export default router;
