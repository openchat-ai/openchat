// Compare: Lossless MDCT vs NeuralAudioCodec on jzlg_5s.wav
import fs from 'fs';
import { NeuralAudioCodec } from '../bridge/src/core/audio/neural-audio-codec.js';

function readWav(path) {
  const buf = fs.readFileSync(path);
  let off=12,sr,bits,ch,dataOff,frames;
  while(off<buf.length){const id=buf.toString('ascii',off,off+4);const sz=buf.readUInt32LE(off+4);if(id==='fmt '){sr=buf.readUInt32LE(off+12);ch=buf.readUInt16LE(off+10);bits=buf.readUInt16LE(off+22);}if(id==='data'){dataOff=off+8;frames=sz/(bits/8)/ch;break;}off+=8+sz;}
  const bps=bits/8,mono=new Float64Array(frames);
  for(let i=0;i<frames;i++){let s=0;for(let c=0;c<ch;c++)s+=buf.readInt16LE(dataOff+(i*ch+c)*2);mono[i]=s/ch/32768;}
  return mono;
}
function writeWav(path, samples, sr) {
  const n=samples.length;const d=Buffer.alloc(n*2);
  for(let i=0;i<n;i++)d.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(samples[i]*32768))),i*2);
  const h=Buffer.alloc(44);h.write('RIFF',0);h.writeUInt32LE(36+n*2,4);h.write('WAVE',8);
  h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);
  h.writeUInt32LE(sr,24);h.writeUInt32LE(sr*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);
  h.write('data',36);h.writeUInt32LE(n*2,40);
  fs.writeFileSync(path,Buffer.concat([h,d]));
}

// === MDCT (lossless, from pitch-experiments.mjs) ===
const MDCT_N=1024, STRIDE=MDCT_N;
function mdct(x){const X=new Float64Array(MDCT_N);for(let k=0;k<MDCT_N;k++){let s=0;for(let n=0;n<2*MDCT_N;n++)s+=x[n]*Math.sin(Math.PI*(n+0.5)/(2*MDCT_N))*Math.cos(Math.PI/MDCT_N*(n+0.5+MDCT_N/2)*(k+0.5));X[k]=s;}return X;}
function imdct(X){const y=new Float64Array(2*MDCT_N);for(let n=0;n<2*MDCT_N;n++){let s=0;for(let k=0;k<MDCT_N;k++)s+=X[k]*Math.cos(Math.PI/MDCT_N*(n+0.5+MDCT_N/2)*(k+0.5));y[n]=s*(2/MDCT_N)*Math.sin(Math.PI*(n+0.5)/(2*MDCT_N));}return y;}
function mdctDecodeFrame(X,prevY){const y=imdct(X);const out=new Float64Array(MDCT_N);for(let i=0;i<MDCT_N;i++)out[i]=(prevY?prevY[MDCT_N+i]:0)+y[i];return out;}
function mdctEncodeDecode(signal){const totalSamples=signal.length;const numFrames=Math.ceil((totalSamples-2*MDCT_N)/STRIDE)+1;let prevY=null,recon=[];for(let fi=0;fi<numFrames;fi++){const start=fi*STRIDE;const frame=new Float64Array(2*MDCT_N);for(let i=0;i<2*MDCT_N;i++)frame[i]=(start+i)<totalSamples?signal[start+i]:0;const X=mdct(frame);const out=mdctDecodeFrame(X,prevY);recon.push(...out);prevY=imdct(X);}return new Float64Array(recon);}

// === Main ===
console.log('Loading jzlg_5s.wav...');
const orig = readWav('jzlg_5s.wav');
const SR = 48000;

console.log(`Original: ${orig.length} samples = ${(orig.length/SR).toFixed(1)}s\n`);

// 1. MDCT lossless encode/decode
console.log('[1] MDCT Lossless (perfect reconstruction)...');
const t0 = Date.now();
const mdctRecon = mdctEncodeDecode(orig);
const t1 = Date.now();
writeWav('mdct_lossless.wav', mdctRecon, SR);
console.log(`  Time: ${(t1-t0)/1000}s`);
let mdctSNR = 0; let mdctMaxErr = 0; const n = Math.min(orig.length, mdctRecon.length);
for(let i=0;i<n;i++){ const e=orig[i]-mdctRecon[i]; mdctSNR+=e*e; mdctMaxErr=Math.max(mdctMaxErr,Math.abs(e)); }
const mdctOrigE=orig.slice(0,n).reduce((s,v)=>s+v*v,0);
mdctSNR = mdctSNR > 1e-20 ? 10*Math.log10(mdctOrigE/mdctSNR) : Infinity;
console.log(`  SNR: ${mdctSNR === Infinity ? '∞' : mdctSNR.toFixed(1)}dB`);
console.log(`  Max err: ${mdctMaxErr.toExponential(2)}`);
console.log(`  Saved: mdct_lossless.wav\n`);

// 2. NeuralAudioCodec (production, 8bit)
console.log('[2] NeuralAudioCodec 8-bit (production)...');
const codec = new NeuralAudioCodec({ sampleRate: 24000, frameSize: 20 });
await codec.initialize();
const ratio = 2;
const mono24 = new Float64Array(Math.floor(orig.length / ratio));
for(let i=0;i<mono24.length;i++){let s=0;for(let j=0;j<ratio;j++)s+=orig[i*ratio+j]||0;mono24[i]=s/ratio;}
const pcm = Buffer.alloc(mono24.length*2);
for(let i=0;i<mono24.length;i++)pcm.writeInt16LE(Math.round(mono24[i]*32768),i*2);
const t2 = Date.now();
codec.config.quantizationBits = 8;
const enc = await codec.encode(pcm);
const dec = await codec.decode(enc.data);
const t3 = Date.now();
// Upsample
const out24k = dec.pcm.length/2;
const codecRecon = new Float64Array(out24k * ratio);
for(let i=0;i<out24k;i++){const v=dec.pcm.readInt16LE(i*2)/32768;for(let j=0;j<ratio;j++)codecRecon[i*ratio+j]=v;}
writeWav('neural_8bit.wav', codecRecon, SR);
console.log(`  Time: ${(t3-t2)/1000}s`);
let nacSNR = 0; const n2 = Math.min(orig.length, codecRecon.length);
for(let i=0;i<n2;i++){const e=orig[i]-codecRecon[i];nacSNR+=e*e;}
const nacOrigE = orig.slice(0,n2).reduce((s,v)=>s+v*v,0);
nacSNR = nacSNR > 1e-20 ? 10*Math.log10(nacOrigE/nacSNR) : Infinity;
console.log(`  SNR: ${nacSNR === Infinity ? '∞' : nacSNR.toFixed(1)}dB`);
console.log(`  Compression: ${(pcm.length/enc.data.length).toFixed(1)}x`);
console.log(`  Saved: neural_8bit.wav\n`);

console.log('--- Comparison ---');
console.log(`MDCT:  ${mdctSNR === Infinity ? '∞ dB (perfect)' : mdctSNR.toFixed(1)+' dB'}  ${(mdctRecon.length*2/1024/1024).toFixed(2)}MB WAV`);
console.log(`Neural: ${nacSNR === Infinity ? '∞ dB' : nacSNR.toFixed(1)+' dB'}  ${(codecRecon.length*2/1024/1024).toFixed(2)}MB WAV (${(enc.data.length/1024).toFixed(1)}KB EPC)`);
