// Decode EPC recording file → WAV
// Usage: node epc2wav.mjs input.epc [output.wav]
import fs from 'fs';

const sr = 48000;

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) { console.log('Usage: node epc2wav.mjs input.epc [output.wav]'); process.exit(1); }
  const inPath = args[0];
  const outPath = args[1] || inPath.replace(/\.epc$/i, '.wav');

  const data = fs.readFileSync(inPath);

  // Parse header
  if (data[0] !== 0x45 || data[1] !== 0x50 || data[2] !== 0x43 || data[3] !== 0x31) {
    console.error('Invalid EPC file: missing magic');
    process.exit(1);
  }
  const major = data[4], minor = data[5];
  console.log(`EPC v${major}.${minor}, ${data.length} bytes`);

  // Decode: estimate duration from file size (each RF ~ 7+12N bytes, each tag = 20ms)
  const totalSamples = Math.round(30 * sr); // 30s max, will expand if needed
  const pcm = Buffer.alloc(totalSamples * 2);
  const active = new Map();
  let outOff = 0;
  let rfCount = 0, tagCount = 0;

  for (let o = 8; o + 7 <= data.length; ) {
    if (data[o] !== 0xBB) break;
    const pl = (data[o + 3] << 8) | data[o + 4];
    const fl = 7 + pl;
    if (o + fl > data.length) break;

    for (let eo = o + 5; eo < o + 5 + pl; eo += 12) {
      const type = data[eo];
      if (type !== 0x02) continue;
      const tid = (data[eo + 1] >> 4) & 0xF;
      const note = (data[eo + 2] >> 1) & 0x7F;
      const vel = (data[eo + 3] >> 1) & 0x7F;
      const rms = data[eo + 4];
      if (vel === 0 && rms === 0) { active.delete(tid); continue; }
      const bands = []; for (let i = 0; i < 7; i++) bands.push(data[eo + 5 + i]);
      const freq = 440 * Math.pow(2, (note - 69) / 12);
      active.set(tid, { freq, bands, rms, vel });
      tagCount++;

      // Synthesize 20ms
      const nOut = 960;
      if (outOff + nOut > totalSamples) break;
      for (const t of active.values()) {
        const amp = t.rms / 255 * t.vel / 127 * 0.35;
        if (amp < 0.001) continue;
        const maxH = Math.min(100, Math.floor(sr / 2 / t.freq));
        const hGains = [];
        for (let h = 1; h <= maxH; h++) {
          const hz = t.freq * h;
          if (hz >= 8000) break;
          const be = h <= 7 ? t.bands[h - 1] / 255 : t.bands[6] / 255;
          if (be < 0.01) { hGains.push(0); continue; }
          hGains.push(be * Math.pow(0.85, h - 1) * amp);
        }
        for (let i = 0; i < nOut; i++) {
          let s = 0;
          for (let h = 0; h < hGains.length; h++) {
            if (hGains[h] < 0.001) continue;
            s += Math.sin(2 * Math.PI * t.freq * (h + 1) * (i + outOff) / sr) * hGains[h] * 32768;
          }
          const idx = (outOff + i) * 2;
          if (idx + 1 >= pcm.length) break;
          const existing = pcm.readInt16LE(idx);
          pcm.writeInt16LE(Math.max(-32768, Math.min(32767, existing + Math.round(s))), idx);
        }
      }
      outOff += nOut;
    }
    o += fl;
    rfCount++;
  }

  // Write WAV
  const h = Buffer.alloc(44);
  h.write('RIFF',0); h.writeUInt32LE(36 + outOff * 2, 4); h.write('WAVE',8);
  h.write('fmt ',12); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20);
  h.writeUInt16LE(1,22); h.writeUInt32LE(sr,24); h.writeUInt32LE(sr * 2,28);
  h.writeUInt16LE(2,32); h.writeUInt16LE(16,34); h.write('data',36);
  h.writeUInt32LE(outOff * 2,40);
  fs.writeFileSync(outPath, Buffer.concat([h, pcm.slice(0, outOff * 2)]));

  console.log(`Decoded ${rfCount} RFs, ${tagCount} tags → ${(outOff / sr).toFixed(1)}s`);
  console.log(`Saved: ${outPath}`);
}

main();
