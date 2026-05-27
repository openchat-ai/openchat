// Manualy compose 小蜜蜂 (Frère Jacques) using EPC vocoder synthesis
import fs from 'fs';
const { writeFileSync } = fs;

const sr = 24000;
const melFreqs = [100, 150, 220, 320, 460, 660, 950, 1350, 1950, 2800, 4000];

// Generate piano-like subband profile for a given MIDI note
function pianoBands(midiNote) {
  const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
  const bands = [];
  for (let b = 0; b < 11; b++) {
    const f = melFreqs[b];
    // Piano: fundamental energy + harmonics roll off
    // Band energy based on distance from harmonic frequencies
    let energy = 0;
    for (let h = 1; h <= 8; h++) {
      const hz = freq * h;
      const dist = Math.abs(f - hz) / hz;
      if (dist < 0.3) energy += Math.max(0, 1 - dist * 3) * Math.pow(0.6, h - 1);
    }
    bands.push(Math.round(Math.max(0, Math.min(31, energy * 31))));
  }
  return bands;
}

// 小蜜蜂 score: [midiNote, durationSec]
// C4=60, D4=62, E4=64, F4=65, G4=67, A4=69, G3=55
const notes = [
  [60, 0.25], [62, 0.25], [64, 0.25], [60, 0.25],
  [60, 0.25], [62, 0.25], [64, 0.25], [60, 0.25],
  [64, 0.25], [65, 0.25], [67, 0.5],
  [64, 0.25], [65, 0.25], [67, 0.5],
  [67, 0.125],[69, 0.125],[67, 0.125],[65, 0.125],[64, 0.25],[60, 0.25],
  [67, 0.125],[69, 0.125],[67, 0.125],[65, 0.125],[64, 0.25],[60, 0.25],
  [60, 0.25], [55, 0.25], [60, 0.5],
  [60, 0.25], [55, 0.25], [60, 0.5],
];

// Calculate total duration
let totalDur = 0;
for (const n of notes) totalDur += n[1];
totalDur += 0.5; // padding
const totalSamples = Math.round(totalDur * sr);
const pcm = Buffer.alloc(totalSamples * 2);

// Harmonic envelope synth
const bandBounds = [80,150,250,400,600,900,1300,1900,2700,3800,5500,8000];

function harmSynth(pcm, freq, bands, amp, envFn, nSamples, offset) {
  const maxH = Math.min(100, Math.floor(sr / 2 / freq));
  // Compute per-harmonic gains from subband envelope
  const hGains = [];
  for (let h = 1; h <= maxH; h++) {
    const hz = freq * h;
    if (hz >= 8000) break;
    let band = 10;
    for (let b = 0; b < 11; b++) { if (hz < bandBounds[b + 1]) { band = b; break; } }
    const be = bands[band] / 31;
    if (be < 0.01) { hGains.push(0); continue; }
    const bLow = bandBounds[band], bHigh = bandBounds[band + 1];
    const pos = (hz - bLow) / (bHigh - bLow);
    const centerW = Math.exp(-4 * (pos - 0.5) * (pos - 0.5));
    const rolloff = Math.pow(0.85, h - 1);
    hGains.push(be * centerW * rolloff * amp);
  }

  for (let i = 0; i < nSamples; i++) {
    let s = 0;
    const env = envFn(i / nSamples);
    for (let h = 0; h < hGains.length; h++) {
      if (hGains[h] < 0.001) continue;
      s += Math.sin(2 * Math.PI * freq * (h + 1) * (i + offset) / sr) * hGains[h] * env * 32768;
    }
    const idx = (offset + i) * 2;
    if (idx + 1 >= pcm.length) break;
    const c = Math.max(-32768, Math.min(32767, Math.round(s)));
    const existing = pcm.readInt16LE(idx);
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, existing + c)), idx);
  }
}

// Synthesize each note
let sampleOffset = 0;
for (const [midi, dur] of notes) {
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const bands = pianoBands(midi);
  const nSamples = Math.round(dur * sr);
  const amp = 0.35;
  harmSynth(pcm, freq, bands, amp, 
    t => Math.min(1, t / 0.02) * Math.exp(-t * 3), // attack + decay
    nSamples, sampleOffset);
  sampleOffset += nSamples;
}

writeWav('piano_xiaomifeng.wav', pcm, sr);
console.log('Generated', totalSamples, 'samples =', (totalSamples/sr).toFixed(1), 's');
console.log('Saved piano_xiaomifeng.wav');

// Also save as EPC-encoded version: encode with known notes then decode
console.log('\n--- EPC Roundtrip Test ---');
// Encode manually: create EPC packets from known notes
const epcFrames = [];
for (const [midi, dur] of notes) {
  const bands = pianoBands(midi);
  const nFrames = Math.round(dur * sr / 480);
  for (let f = 0; f < nFrames; f++) {
    const buf = Buffer.alloc(12);
    buf[0] = 0x02;
    buf[1] = (0 << 4) & 0xF0; // track 0
    buf[2] = ((midi & 0x7F) << 1) | (f === 0 ? 1 : 0); // midiNote + onset
    buf[3] = (100 << 1) & 0xFE; // velocity
    buf[4] = 180; // rms
    // Pack bands
    let bit = 0;
    for (let i = 0; i < 11; i++) {
      for (let b = 0; b < 5; b++) {
        const byteIdx = 5 + (bit >> 3);
        const bitIdx = bit & 7;
        if ((bands[i] >> (4 - b) & 1) !== 0) buf[byteIdx] |= 1 << (7 - bitIdx);
        bit++;
      }
    }
    epcFrames.push(buf);
  }
}
const epcData = Buffer.concat(epcFrames);
console.log('EPC encoded:', epcData.length, 'bytes');

// Wrap in response frames and decode
const po = [];
let o = 0;
// Group 12 EPCs per response frame
for (let i = 0; i < epcFrames.length; i += 12) {
  const batch = epcFrames.slice(i, Math.min(i + 12, epcFrames.length));
  const epcBytes = Buffer.concat(batch);
  const pl = epcBytes.length;
  const f = Buffer.alloc(7 + pl);
  let o2 = 0; f[o2++] = 0xBB; f[o2++] = 0x01; f[o2++] = 0xCC;
  f[o2++] = (pl >> 8) & 0xFF; f[o2++] = pl & 0xFF;
  if (pl > 0) epcBytes.copy(f, o2); o2 += pl;
  let ck = 0; for (let j = 1; j < o2; j++) ck = (ck + f[j]) & 0xFF;
  f[o2++] = ck; f[o2++] = 0x7E;
  po.push(f);
}
const packed = Buffer.concat(po);
console.log('Response frames:', po.length);

// Decode
const outPcm = Buffer.alloc(totalSamples * 2);
const activeTones = new Map();
o = 0;
let outOff = 0;
while (o + 7 <= packed.length) {
  if (packed[o] !== 0xBB) break;
  const dl = (packed[o + 3] << 8) | packed[o + 4], fl = 7 + dl;
  // Parse EPCs, one per 20ms output frame
  for (let eo = o + 5; eo < o + 5 + dl; eo += 12) {
    const buf = packed.slice(eo, eo + 12);
    const tid = (buf[1] >> 4) & 0xF;
    const note = (buf[2] >> 1) & 0x7F;
    const vel = (buf[3] >> 1) & 0x7F;
    const rms = buf[4];
    if (vel === 0 && rms === 0) { activeTones.delete(tid); continue; }
    // Unpack bands
    const bands = []; let bit = 0;
    for (let i = 0; i < 11; i++) { let v=0; for(let b=0;b<5;b++) { v=(v<<1)|((buf[5+(bit>>3)]>>(7-(bit&7)))&1); bit++; } bands.push(v); }
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    activeTones.set(tid, { freq, bands, rms, vel });

    // Synthesize 20ms per EPC tag using harmonic envelope
    const nOut = 480;
    for (const tone of activeTones.values()) {
      const amp = tone.rms / 255 * tone.vel / 127 * 0.35;
      if (amp < 0.001) continue;
      harmSynth(outPcm, tone.freq, tone.bands, amp, () => 1, nOut, outOff);
    }
    outOff += nOut;
  }
  o += fl;
}

writeWav('piano_xiaomifeng_epc.wav', outPcm, sr);
console.log('EPC roundtrip saved: piano_xiaomifeng_epc.wav');

// ===== Analysis comparison: known notes vs HPS-extracted notes =====
console.log('\n=== Score Analysis ===');
console.log('Known Notes → HPS Extracted Notes');
console.log('(generating piano WAV, then running EPC analysis on it)\n');

// FFT helpers (from vocoder test)
function fft(r,i){const n=r.length;for(let j=0,b=n>>1;b<n;b++){let bt=n>>1;for(;j&bt;bt>>=1)j^=bt;j^=bt;if(b<j){[r[b],r[j]]=[r[j],r[b]];[i[b],i[j]]=[i[j],i[b]];}}for(let l=2;l<=n;l<<=1){const a=2*Math.PI/l,wR=Math.cos(a),wI=-Math.sin(a);for(let s=0;s<n;s+=l){let cR=1,cI=0;for(let j=0;j<l/2;j++){const uR=r[s+j],uI=i[s+j],vR=r[s+j+l/2]*cR-i[s+j+l/2]*cI,vI=r[s+j+l/2]*cI+i[s+j+l/2]*cR;r[s+j]=uR+vR;i[s+j]=uI+vI;r[s+j+l/2]=uR-vR;i[s+j+l/2]=uI-vI;const tR=cR*wR-cI*wI;cI=cR*wI+cI*wR;cR=tR;}}}}
function hps(s) {const n=2048,hn=n>>1,r=new Float64Array(n),im=new Float64Array(n);for(let i=0;i<n&&i<s.length;i++)r[i]=s[i]*(0.5*(1-Math.cos(2*Math.PI*i/(n-1))));fft(r,im);const m=new Float64Array(hn);for(let i=0;i<hn;i++)m[i]=Math.sqrt(r[i]*r[i]+im[i]*im[i]);const hp=new Float64Array(hn);for(let i=0;i<hn;i++){let p=m[i];if(p<1)continue;for(let h=2;h<=4;h++){const idx=Math.round(i*h);if(idx>=hn)break;p*=m[idx];}hp[i]=p;}const mn=Math.round(hn*40/sr),mx=Math.round(hn*1500/sr);const pk=[];let mp=0;for(let i=mn+1;i<mx-1;i++){if(hp[i]>hp[i-1]&&hp[i]>hp[i+1]&&hp[i]>0){pk.push({i,v:hp[i]});if(hp[i]>mp)mp=hp[i];}}const th=mp*0.2;const fp=pk.filter(p=>p.v>=th).sort((a,b)=>b.v-a.v);const res=[];for(const p of fp){const dup=res.some(r=>{const rt=p.i>r.i?p.i/r.i:r.i/p.i;return Math.abs(rt-Math.round(rt))<0.08;});if(!dup){res.push({freq:p.i*sr/n,corr:Math.min(1,p.v/(fp[0]?.v||1))});if(res.length>=2)break;}}return res;}

// EPC analysis on the generated piano WAV
const pcmBuf = fs.readFileSync('piano_xiaomifeng.wav');
const pcmData = pcmBuf.slice(44); // skip WAV header
const fsZ=480, fB=fsZ*2;
const ab2=[], activeTracks2=new Map();
let lastNotes = [];

for (let off = 0; off + fB <= pcmData.length; off += fB) {
  const sm=[];
  for(let i=0;i<fsZ;i++){const v=pcmData.readInt16LE(off+i*2);sm.push(v);ab2.push(v);}
  if(ab2.length>2048)ab2.splice(0,ab2.length-2048);

  // Update existing tracks
  for(const [tid,t] of activeTracks2){
    const lag=Math.round(sr/t.f);let c=0,n=0;for(let i=0;i<240;i++){c+=sm[i]*sm[i+lag];n+=sm[i]*sm[i]+sm[i+lag]*sm[i+lag];}
    const corr=n>0?c/Math.sqrt(n):0;
    if(corr>0.3){t.s=0;}else{t.s++;if(t.s>3)activeTracks2.delete(tid);}
  }

  // HPS analysis every 4 frames
  if(ab2.length>=2048 && ((off/fB)%4===0)){
    const tones=hps(ab2);
    for(const t of tones){
      const lag=Math.round(sr/t.freq);let c=0,n=0;for(let i=0;i<240;i++){c+=sm[i]*sm[i+lag];n+=sm[i]*sm[i]+sm[i+lag]*sm[i+lag];}
      if(n>0?c/Math.sqrt(n):0<0.3)continue;
      const dup=[...activeTracks2.values()].some(a=>{const r=t.freq>a.f?t.freq/a.f:a.f/t.freq;return Math.abs(r-Math.round(r))<0.05;});
      if(dup)continue;
      const midi=12*Math.log(t.freq/440)/Math.log(2)+69;
      const note=Math.max(0,Math.min(127,Math.round(midi)));
      const nn=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][note%12]+Math.floor(note/12-1);
      activeTracks2.set(activeTracks2.size%15,{f:t.freq,n:note,s:0});
      lastNotes.push({time:(off/sr/480*20/1000).toFixed(2),note,noteName:nn,freq:Math.round(t.freq)});
    }
  }
}

// Show original vs extracted (first 16 detected)
console.log('Original score (first 16 notes):');
const noteNames={60:'C4',62:'D4',64:'E4',65:'F4',67:'G4',69:'A4',55:'G3'};
for(let i=0;i<16&&i<notes.length;i++){
  const n=notes[i];const nn=noteNames[n[0]]||'?';
  console.log(`  ${(i*0.25).toFixed(2)}s  ${nn}(${n[0]}) dur=${n[1]}s`);
}
if(lastNotes.length===0)console.log('(no notes detected)');
else{
  console.log('\nExtracted (first '+Math.min(16,lastNotes.length)+'):');
  for(let i=0;i<Math.min(16,lastNotes.length);i++){
    const n=lastNotes[i];
    console.log(`  ${n.time}s  ${n.noteName}(${n.note}) ${n.freq}Hz`);
  }
  // Accuracy
  let correct=0;
  for(const ln of lastNotes){
    const hit=notes.some(on=>Math.abs(on[0]-ln.note)<=1);
    if(hit)correct++;
  }
  console.log(`\nAccuracy: ${correct}/${lastNotes.length} (${(correct/lastNotes.length*100).toFixed(0)}%)`);
}

function writeWav(path, pcm, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);
  h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);
  h.writeUInt16LE(1,22);h.writeUInt32LE(sr,24);h.writeUInt32LE(sr*2,28);
  h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);
  h.writeUInt32LE(pcm.length,40);
  writeFileSync(path,Buffer.concat([h,pcm]));
  console.log('saved',path);
}
