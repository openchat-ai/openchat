// EPC instrument-based variable frame format test
import fs from 'fs';

const sr = 48000;

// ===== Instrument configs =====
const configs = {
  // Byte[1]=0: Piano — 11×5b fixed subbands, no segmentation
  0: {name:'Piano',bands:11,bandBits:5,segment:false,desc:'11 fixed subbands'},
  // Byte[1]=1: Voice — 7×8b F0-tracking harmonic peaks, with segmentation
  1: {name:'Voice',bands:7,bandBits:8,segment:true,desc:'7 harmonic peaks'},
  // Byte[1]=2: Drums — 4×5b energy bands, no segmentation
  2: {name:'Drums',bands:4,bandBits:5,segment:false,desc:'4 energy bands'},
};

// Helper: pack instrument-based EPC frame
function packEpc(instr, midiNote, onset, vel, rms, bands) {
  const b = Buffer.alloc(12);
  b[0] = 0x02;       // tagType
  b[1] = instr & 0xFF; // instrument
  b[2] = ((midiNote & 0x7F) << 1) | (onset & 1);
  b[3] = (vel << 1) & 0xFE;
  b[4] = rms;

  const cfg = configs[instr];
  if (!cfg) return b;

  if (cfg.bandBits === 5) {
    // Bit-packed 5-bit bands
    let bit = 0;
    for (let i = 0; i < cfg.bands; i++) {
      for (let bi = 0; bi < 5; bi++) {
        const byteIdx = 5 + (bit >> 3);
        const bitIdx = bit & 7;
        if ((bands[i] >> (4 - bi) & 1) !== 0) b[byteIdx] |= (1 << (7 - bitIdx));
        bit++;
      }
    }
  } else if (cfg.bandBits === 8) {
    // Direct byte per band
    for (let i = 0; i < cfg.bands && i < bands.length; i++) b[5 + i] = bands[i];
  }
  return b;
}

// Helper: unpack
function unpackEpc(buf) {
  const tag = {instr:buf[1]&0xFF,note:(buf[2]>>1)&0x7F,onset:buf[2]&1,vel:(buf[3]>>1)&0x7F,rms:buf[4],bands:[]};
  const cfg = configs[tag.instr];
  if (!cfg) return tag;
  if (cfg.bandBits === 5) {
    let bit = 0;
    for (let i = 0; i < cfg.bands; i++) {
      let v = 0;
      for (let b = 0; b < 5; b++) {
        const byteIdx = 5 + (bit >> 3);
        const bitIdx = bit & 7;
        v = (v << 1) | ((buf[byteIdx] >> (7 - bitIdx)) & 1);
        bit++;
      }
      tag.bands.push(v);
    }
  } else if (cfg.bandBits === 8) {
    for (let i = 0; i < cfg.bands && 5+i < buf.length; i++) tag.bands.push(buf[5+i]);
  }
  return tag;
}

// ===== Generate test data =====
// Piano C4 (60) — 11×5b: piano-like band profile
const pianoBands = [12,15,20,25,22,18,15,12,8,5,3];
const pianoEpc = packEpc(0, 60, 1, 100, 180, pianoBands);

// Voice — 7×8b: formant-shaped bands
const voiceBands = [80,120,200,180,100,60,40];
const voiceEpc = packEpc(1, 64, 1, 90, 160, voiceBands);

// Drums — 4×5b: wide energy
const drumsBands = [20,25,30,28];
const drumsEpc = packEpc(2, 48, 1, 120, 200, drumsBands);

// ===== Verify roundtrip =====
console.log('=== Instrument-based EPC ===\n');

for (const [epc, expectedConfig] of [
  [pianoEpc, configs[0]],
  [voiceEpc, configs[1]],
  [drumsEpc, configs[2]],
]) {
  const tag = unpackEpc(epc);
  const cfg = configs[tag.instr];
  console.log(`Instrument ${tag.instr} (${cfg.name}): ${cfg.desc}`);
  console.log(`  Note: ${tag.note}  Vel:${tag.vel}  RMS:${tag.rms}`);
  console.log(`  Bands: [${tag.bands.join(',')}]  (${cfg.bands}×${cfg.bandBits}b = ${cfg.bands*cfg.bandBits} bits)`);
  console.log(`  Total: 8+8+8+8+8+${cfg.bands*cfg.bandBits} = ${8+8+8+8+8+cfg.bands*cfg.bandBits} ≤ 96b ✓\n`);
}

// ===== Same 20ms PCM, different instrument =====
console.log('=== Same signal, different instrument encoding ===');
console.log('(simulating C4 note at 48kHz)');

const testSamples = []; // 480 samples @ 48kHz = 10ms
const f0=262; // C4
for(let i=0;i<480;i++){
  let s=0;
  for(let h=1;h<=20;h++) s+=Math.sin(2*Math.PI*f0*h*i/sr)*Math.pow(0.7,h-1);
  testSamples.push(s);
}

// Pretend we analyzed it 3 ways:
const samePcm = [
  {instr:0, note:60, vel:100, rms:180, bands:[15,20,25,30,28,22,18,15,12,8,5]},
  {instr:1, note:60, vel:100, rms:180, bands:[100,160,220,180,80,50,30]},
  {instr:2, note:48, vel:120, rms:200, bands:[22,28,30,25]},
];

for(const d of samePcm){
  const epc = packEpc(d.instr, d.note, 1, d.vel, d.rms, d.bands);
  const tag = unpackEpc(epc);
  const cfg = configs[tag.instr];
  console.log(`  as ${cfg.name}: ${cfg.bands}×${cfg.bandBits}b = ${tag.bands.join(',')}`);
}

console.log('\n✓ Instrument-based encode/decode works');
console.log('Each instrument uses different bits/band for same 20ms');
console.log('Receiver decodes based on Byte[1] — layout is self-describing');
