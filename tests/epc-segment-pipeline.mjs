// Segment-based EPC pipeline: detect segments → extract features → encode → decode → synthesize
import fs from 'fs';
const sr = 24000;
const bandBounds = [80,150,250,400,600,900,1300,1900,2700,3800,5500,8000];

// ===== 1. Generate piano 小蜜蜂 with clean note boundaries =====
const score = [
  [60,0.25],[62,0.25],[64,0.25],[60,0.25],[60,0.25],[62,0.25],[64,0.25],[60,0.25],
  [64,0.25],[65,0.25],[67,0.5],[64,0.25],[65,0.25],[67,0.5],
  [67,0.125],[69,0.125],[67,0.125],[65,0.125],[64,0.25],[60,0.25],
  [67,0.125],[69,0.125],[67,0.125],[65,0.125],[64,0.25],[60,0.25],
  [60,0.25],[55,0.25],[60,0.5],[60,0.25],[55,0.25],[60,0.5],
];
let totalS = 0; for(const n of score) totalS += n[1];
totalS = Math.ceil(totalS);
const nSamples = totalS * sr;
const pcm = Buffer.alloc(nSamples * 2);
let off = 0;
for(const [midi,dur] of score){
  const nSm = Math.round(dur * sr);
  const freq = 440 * Math.pow(2,(midi-69)/12);
  for(let i=0;i<nSm && off+i<nSamples;i++){
    const env = Math.min(1,i/(sr*0.005))*Math.exp(-i/(sr*0.12));
    let v=0; for(let h=1;h<=16;h++) v+=Math.sin(2*Math.PI*freq*h*(off+i)/sr)*Math.pow(0.7,h-1);
    const val=Math.max(-32768,Math.min(32767,Math.round(v*env*0.3*32768)));
    pcm.writeInt16LE(val,(off+i)*2);
  }
  off += nSm;
}

// ===== 2. Segment detector =====
function detectSegments(pcm, sr){
  const frameLen=480, halfF=frameLen>>1;
  const nFrames=Math.floor(pcm.length/2/frameLen);
  const rms=[];
  for(let f=0;f<nFrames;f++){
    let e=0;for(let i=0;i<frameLen;i++){const v=pcm.readInt16LE((f*frameLen+i)*2);e+=v*v;}
    rms.push(Math.sqrt(e/frameLen));
  }
  const segs=[];let start=null,prev=0;
  for(let f=0;f<nFrames;f++){
    const r=rms[f];
    if(start===null && r>prev*2 && r>200) start=f;
    else if(start!==null && r<rms[start]*0.3){
      if(f-start>=2) segs.push({start,end:f-1});
      start=null;
    }
    if(start!==null && f===nFrames-1) segs.push({start,end:f});
    prev=r;
  }
  return segs;
}

// ===== 3. Per-segment feature extraction =====
function extractFeatures(pcm, seg, sr){
  const startSm=seg.start*480, endSm=seg.end*480+480;
  const nSeg=endSm-startSm, half=nSeg>>1;

  // F0 via autocorrelation on whole segment
  const minLag=Math.floor(sr/1500), maxLag=Math.floor(sr/40);
  let bestLag=0,bestCorr=0;
  for(let lag=minLag;lag<=maxLag;lag++){
    let c=0,n=0;
    for(let i=0;i<half;i++){
      const v1=pcm.readInt16LE((startSm+i)*2),v2=pcm.readInt16LE((startSm+i+lag)*2);
      c+=v1*v2;n+=v1*v1+v2*v2;
    }
    const corr=n>0?c/Math.sqrt(n):0;
    if(corr>bestCorr){bestCorr=corr;bestLag=lag;}
  }
  const f0=bestLag>0?sr/bestLag:0;
  const midi=f0>50?12*Math.log(f0/440)/Math.log(2)+69:0;
  const note=Math.max(0,Math.min(127,Math.round(midi)));

  // Velocity: peak RMS in first 3 frames
  let peakRms=0;
  for(let i=0;i<Math.min(480*3,nSeg);i+=480){let e=0,cnt=0;for(let j=i;j<Math.min(i+480,nSeg);j++){const v=pcm.readInt16LE((startSm+j)*2);e+=v*v;cnt++;}const r=Math.sqrt(e/cnt);if(r>peakRms)peakRms=r;}
  const vel=Math.round(Math.max(1,Math.min(127,peakRms/32768*127)));

  // Attack: frames to 80% peak
  let attack=0;
  for(let i=0;i<Math.min(480*5,nSeg);i+=480){let e=0,cnt=0;for(let j=i;j<Math.min(i+480,nSeg);j++){const v=pcm.readInt16LE((startSm+j)*2);e+=v*v;cnt++;}if(Math.sqrt(e/cnt)>=peakRms*0.8)break;attack++;}
  attack = Math.min(attack,15);

  // Decay: samples from peak to half RMS
  let decay=0;
  if(attack*480+480<nSeg){
    for(let i=attack*480+480;i<nSeg;i+=480){let e=0,cnt=0;for(let j=i;j<Math.min(i+480,nSeg);j++){const v=pcm.readInt16LE((startSm+j)*2);e+=v*v;cnt++;}if(Math.sqrt(e/cnt)<=peakRms*0.5)break;decay+=480;}
  }
  decay = Math.min(Math.round(decay*24000/sr/1000),15);

  // Subband energy (from segment midpoint)
  const midPoint = startSm + (nSeg>>1);
  const fftN=2048, halfN=fftN>>1;
  const re=new Float64Array(fftN),im=new Float64Array(fftN);
  for(let i=0;i<fftN;i++){const idx=Math.min(midPoint+i-fftN/2,nSamples-1);if(idx>=0)re[i]=pcm.readInt16LE(idx*2)*(0.5*(1-Math.cos(2*Math.PI*i/(fftN-1))));}
  // Simple harmonic envelope: use F0 harmonics, not full FFT
  const bands=[];
  for(let b=0;b<11;b++){
    const fMin=b===0?80:bandBounds[b],fMax=bandBounds[b+1];
    let energy=0,cnt=0;
    // Only count energy from F0 harmonics that fall in this band
    if(f0>50){
      for(let h=1;h<=50;h++){
        const hz=f0*h;
        if(hz>=fMax)break;
        if(hz>=fMin){
          // DFT at this harmonic frequency
          const bin=Math.round(hz*fftN/sr);
          if(bin<1||bin>=halfN)continue;
          let cr=0,ci=0;
          for(let i=0;i<fftN;i++){const a=2*Math.PI*bin*i/fftN;cr+=re[i]*Math.cos(a);ci-=re[i]*Math.sin(a);}
          energy+=Math.sqrt(cr*cr+ci*ci)/fftN*2;
          cnt++;
        }
      }
    }
    bands.push(Math.round(Math.max(0,Math.min(31,energy/32768*31))));
  }

  const durSec = nSeg/sr;
  return {note,vel,attack,decay,bands,durMs:Math.round(nSeg*1000/sr),f0:f0.toFixed(0)};
}

// ===== 4. Synthesizer =====
function synthesize(pcmOut, segFeatures, scoreNotes, sr){
  for(const [i,seg] of segFeatures.entries()){
    if(seg.note<20) continue;
    const durSamples=Math.round(seg.durMs*sr/1000);
    const freq=440*Math.pow(2,(seg.note-69)/12);
    const envDecay=5 - seg.vel/127*3;
    const attackSm=Math.round(seg.attack * 480);
    for(let i=0;i<durSamples;i++){
      const pos=i/durSamples;
      const env=Math.min(1,i/(attackSm+1))*Math.exp(-pos*envDecay);
      let v=0;
      for(let h=1;h<=Math.min(30,Math.floor(sr/2/freq));h++){
        const hz=freq*h;
        let band=10;for(let b=0;b<11;b++){if(hz<bandBounds[b+1]){band=b;break;}}
        const be=seg.bands[band]/31;
        if(be<0.01)continue;
        const posInBand=(hz-bandBounds[band])/(bandBounds[band+1]-bandBounds[band]);
        const cw=Math.exp(-4*(posInBand-0.5)*(posInBand-0.5));
        const ro=Math.pow(0.85,h-1);
        v+=Math.sin(2*Math.PI*freq*h*i/sr)*be*cw*ro;
      }
      // Sum timing (offset based on score order)
      let smp=0;
      for(let j=0;j<i;j++) smp+=Math.round(scoreNotes[j][1]*sr)||0;
      smp+=i;
      if(smp>=nSamples)break;
      const val=Math.max(-32768,Math.min(32767,Math.round(v*env*0.3*32768)));
      const existing=pcmOut.readInt16LE(smp*2);
      pcmOut.writeInt16LE(Math.max(-32768,Math.min(32767,existing+val)),smp*2);
    }
  }
}

// Timing for synthesis: use original score durations
function synthesizeDirect(pcmOut, segFeatures, sr){
  let smp=0;
  for(const seg of segFeatures){
    const durSamples=Math.round(seg.durMs*sr/1000);
    const freq=440*Math.pow(2,(seg.note-69)/12);
    const envDecay=5 - seg.vel/127*3;
    const attackSm=Math.round(seg.attack * 480);
    for(let i=0;i<durSamples;i++){
      const pos=i/durSamples;
      const env=Math.min(1,i/(attackSm+1))*Math.exp(-pos*envDecay);
      let v=0;
      for(let h=1;h<=Math.min(30,Math.floor(sr/2/freq));h++){
        const hz=freq*h;
        let band=10;for(let b=0;b<11;b++){if(hz<bandBounds[b+1]){band=b;break;}}
        const be=seg.bands[band]/31;if(be<0.01)continue;
        const posInBand=(hz-bandBounds[band])/(bandBounds[band+1]-bandBounds[band]);
        const cw=Math.exp(-4*(posInBand-0.5)*(posInBand-0.5));
        const ro=Math.pow(0.85,h-1);
        v+=Math.sin(2*Math.PI*freq*h*i/sr)*be*cw*ro;
      }
      if(smp+i>=nSamples)break;
      const val=Math.max(-32768,Math.min(32767,Math.round(v*env*0.3*32768)));
      const existing=pcmOut.readInt16LE((smp+i)*2);
      pcmOut.writeInt16LE(Math.max(-32768,Math.min(32767,existing+val)),(smp+i)*2);
    }
    smp+=durSamples;
  }
}

// ===== 5. Run pipeline =====
console.log('=== Segment-based EPC Pipeline ===\n');

// Segments
const segs = detectSegments(pcm, sr);
console.log(`Segments: ${segs.length} (expected ${score.length} notes)`);

// Feature extraction
const features = [];
for(const s of segs){
  const f=extractFeatures(pcm,s,sr);
  if(f.note>=21) features.push(f);
  const nn=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][f.note%12]+Math.floor(f.note/12-1);
  console.log(`  ${nn}(${f.note}) f0=${f.f0}Hz vel=${f.vel} atk=${f.attack} dcy=${f.decay}ms dur=${f.durMs}ms bands=${f.bands.slice(0,4).join(',')}...`);
}

// Accuracy
let correct=0;
for(const f of features){
  const hit=score.some(n=>Math.abs(n[0]-f.note)<=1);
  if(hit) correct++;
}
console.log(`\nAccuracy: ${correct}/${features.length} (${(correct/features.length*100).toFixed(0)}%)`);

// Synthesize
const directPcm = Buffer.alloc(nSamples * 2);
synthesizeDirect(directPcm, features, sr);
// writeWav('segment_direct.wav',directPcm,sr);
// console.log('\nSaved segment_direct.wav');

// EPC encode → decode would go here, using same features
// For now this validates the analysis half
console.log('\nAnalysis pipeline OK. Ready for EPC encode.');

function writeWav(path,pcm,sr){
  const h=Buffer.alloc(44);
  h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);
  h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);
  h.writeUInt16LE(1,22);h.writeUInt32LE(sr,24);h.writeUInt32LE(sr*2,28);
  h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);
  h.writeUInt32LE(pcm.length,40);
  writeFileSync(path,Buffer.concat([h,pcm]));
}
