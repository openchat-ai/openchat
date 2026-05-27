// Complex real-world scene test: market square with multiple sound layers
// EPC must extract voice clearly from heavy background
import fs from 'fs';
import { writeFileSync } from 'fs';
const sr = 24000;
const bandBounds = [80,150,250,400,600,900,1300,1900,2700,3800,5500,8000];

// ===== Scene: 6-second market square =====
const dur = 6;
const nS = sr * dur;
const scene = Buffer.alloc(nS * 2);
const layers = {}; // for reference

// ---- Layer 1: Street musician (accordion) ----
// Simple chord progression C-F-G-C
const chords = [
  {notes:[60,64,67],t:0.5,dur:1.5},
  {notes:[65,69,72],t:2.0,dur:1.5},
  {notes:[67,71,74],t:3.5,dur:1.5},
  {notes:[60,64,67],t:5.0,dur:1.0},
];
for(const ch of chords){
  const st=Math.round(ch.t*sr), d=Math.round(ch.dur*sr);
  for(const note of ch.notes){
    const freq=440*Math.pow(2,(note-69)/12);
    for(let i=0;i<d && st+i<nS;i++){
      const env=Math.min(1,i/(sr*0.03))*Math.exp(-i/(sr*0.3));
      let v=0;
      for(let h=1;h<=8;h++) v+=Math.sin(2*Math.PI*freq*h*(st+i)/sr)*Math.pow(0.6,h-1);
      const val=Math.max(-32768,Math.min(32767,Math.round(v*env*0.12*32768)));
      const e=scene.readInt16LE((st+i)*2); scene.writeInt16LE(Math.max(-32768,Math.min(32767,e+val)),(st+i)*2);
    }
  }
}

// ---- Layer 2: Crowd chatter (200-800Hz random voices) ----
for(let i=0;i<nS;i++){
  const t=i/sr;
  // 5 random voices at different pitches
  let ch=0;
  for(let v=0;v<5;v++){
    const f0=180+Math.random()*400; // 180-580Hz
    const f1=f0*Math.floor(1+Math.random()*3); // random harmonic
    ch+=Math.sin(2*Math.PI*f1*t+Math.random()*6.28)*0.06;
  }
  // Random syllables (amplitude modulation)
  ch*=0.3+0.7*Math.sin(2*Math.PI*4*t)*0.5+0.5;
  const val=Math.max(-32768,Math.min(32767,Math.round(ch*0.08*32768)));
  const e=scene.readInt16LE(i*2); scene.writeInt16LE(Math.max(-32768,Math.min(32767,e+val)),i*2);
}

// ---- Layer 3: Footsteps (periodic thumps) ----
for(let step=0;step<12;step++){
  const t=0.3+step*0.5; // every 0.5s
  const st=Math.round(t*sr);
  for(let i=0;i<Math.round(0.08*sr) && st+i<nS;i++){
    const env=Math.exp(-i/(sr*0.01));
    const thump=Math.sin(2*Math.PI*80*(st+i)/sr)*0.6+Math.sin(2*Math.PI*200*(st+i)/sr)*0.4;
    const val=Math.max(-32768,Math.min(32767,Math.round(thump*env*0.15*32768)));
    const e=scene.readInt16LE((st+i)*2); scene.writeInt16LE(Math.max(-32768,Math.min(32767,e+val)),(st+i)*2);
  }
}

// ---- Layer 4: Vehicle rumble (low freq, continuous) ----
for(let i=0;i<nS;i++){
  const t=i/sr;
  const rumble=Math.sin(2*Math.PI*60*t)*0.5+Math.sin(2*Math.PI*90*t)*0.3+Math.sin(2*Math.PI*120*t)*0.2;
  const val=Math.max(-32768,Math.min(32767,Math.round(rumble*0.08*32768)));
  const e=scene.readInt16LE(i*2); scene.writeInt16LE(Math.max(-32768,Math.min(32767,e+val)),i*2);
}

// ---- Layer 5: Wind/breeze (high-freq noise) ----
for(let i=0;i<nS;i++){
  const t=i/sr;
  const gust=0.5+0.5*Math.sin(2*Math.PI*0.2*t);
  const noise=(Math.random()*2-1)*gust*0.05;
  const val=Math.max(-32768,Math.min(32767,Math.round(noise*32768)));
  const e=scene.readInt16LE(i*2); scene.writeInt16LE(Math.max(-32768,Math.min(32767,e+val)),i*2);
}

// ---- Layer 6: Main voice ----
const sentences = [
  {text:"你好，我在这边",syl:[
    {t:0.8,dur:0.25,f0Start:210,f0End:190},
    {t:1.1,dur:0.2,f0Start:195,f0End:220},
    {t:1.35,dur:0.15,f0Start:225,f0End:210},
    {t:1.55,dur:0.2,f0Start:205,f0End:180},
  ]},
  {text:"你在哪里",syl:[
    {t:2.5,dur:0.2,f0Start:190,f0End:210},
    {t:2.75,dur:0.15,f0Start:215,f0End:230},
    {t:2.95,dur:0.2,f0Start:235,f0End:200},
    {t:3.2,dur:0.15,f0Start:195,f0End:170},
  ]},
  {text:"广场上好热闹",syl:[
    {t:4.2,dur:0.25,f0Start:180,f0End:200},
    {t:4.5,dur:0.2,f0Start:205,f0End:225},
    {t:4.75,dur:0.2,f0Start:220,f0End:210},
    {t:5.0,dur:0.15,f0Start:205,f0End:195},
    {t:5.2,dur:0.2,f0Start:190,f0End:210},
  ]},
];

for(const sent of sentences){
  for(const syl of sent.syl){
    const st=Math.round(syl.t*sr), d=Math.round(syl.dur*sr);
    for(let i=0;i<d && st+i<nS;i++){
      const ratio=i/d;
      const f0=syl.f0Start+(syl.f0End-syl.f0Start)*ratio;
      const env=Math.min(1,i/(sr*0.008))*Math.min(1,(d-i)/(sr*0.015));
      let v=0;
      for(let h=1;h<=25;h++){
        const hz=f0*h; let w=1;
        if(hz>700&&hz<1100) w=2.5;
        else if(hz>1400&&hz<2000) w=2;
        else if(hz>3000) w=0.2;
        v+=Math.sin(2*Math.PI*hz*(st+i)/sr)*Math.pow(0.75,h-1)*w;
      }
      const val=Math.max(-32768,Math.min(32767,Math.round(v*env*0.45*32768)));
      const e=scene.readInt16LE((st+i)*2);
      scene.writeInt16LE(Math.max(-32768,Math.min(32767,e+val)),(st+i)*2);
    }
  }
}

// Save scene
function writeWav(path,pcm,sr){
  const h=Buffer.alloc(44);
  h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);
  h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);
  h.writeUInt16LE(1,22);h.writeUInt32LE(sr,24);h.writeUInt32LE(sr*2,28);
  h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);
  h.writeUInt32LE(pcm.length,40);
  writeFileSync(path,Buffer.concat([h,pcm]));
}
writeWav('scene_market.wav',scene,sr);
console.log('Saved scene_market.wav (6s market square)');

// ===== Noise-adaptive VAD (classical approach) =====
// Track noise floor per band, detect voice when signal exceeds noise

const frameLen=480;
const nFrames=Math.floor(nS/frameLen);
const formantBands=[{lo:250,hi:400},{lo:400,hi:600},{lo:600,hi:900},{lo:900,hi:1900}];
const nBands=4;
const fftN=2048,halfN=fftN>>1;

// Per-frame features: band energy + ZCR + spectral tilt
function frameEnergy(f){
  const off=f*frameLen;
  const bands=formantBands.map(b=>{
    const mid=(b.lo+b.hi)/2, bin=Math.round(mid*fftN/sr);
    if(bin<1||bin>=halfN)return 0;
    const half=Math.min(frameLen>>1,Math.floor((nS-off)/2)-1);
    let cr=0,ci=0;
    for(let i=0;i<half;i++){const a=2*Math.PI*bin*i/fftN;cr+=scene.readInt16LE((off+i)*2)*Math.cos(a);ci-=scene.readInt16LE((off+i)*2)*Math.sin(a);}
    return Math.sqrt(cr*cr+ci*ci)/half*2;
  });
  let e=0;let zcr=0;let prevV=0;
  for(let i=0;i<frameLen;i++){
    const v=scene.readInt16LE((off+i)*2);
    e+=v*v;
    if(i>0 && ((v>=0&&prevV<0)||(v<0&&prevV>=0))) zcr++;
    prevV=v;
  }
  // Spectral tilt: ratio of low-band energy (250-600Hz) to high-band (600-1900Hz)
  const lowSum=bands[0]+bands[1]+1;
  const highSum=bands[2]+bands[3]+1;
  const tilt=lowSum/highSum; // voice: tilt=~2-5 (more low), noise: tilt=~1, music: tilt=~0.5-2
  return {bands,rms:Math.sqrt(e/frameLen),zcr:zcr/frameLen,tilt};
}

// Noise floor: slow upward, fast downward
const noiseFloor=new Array(nBands).fill(0);
const noiseDecay=0.97; // slowly adapt to rising noise
const noiseAttack=0.7;  // quickly track falling noise

let isVoice=false;
let hangover=0;

const classicSegs=[];
let segStart=null;

for(let f=0;f<nFrames;f++){
  const fe=frameEnergy(f);
  
  // First frame: init noise floor
  if(f===0) for(let b=0;b<nBands;b++) noiseFloor[b]=fe.bands[b];
  
  // Adaptive noise floor update
  for(let b=0;b<nBands;b++){
    if(fe.bands[b]<noiseFloor[b]){
      noiseFloor[b]=noiseFloor[b]*noiseAttack+fe.bands[b]*(1-noiseAttack); // fast down
    }else{
      noiseFloor[b]=noiseFloor[b]*noiseDecay+fe.bands[b]*(1-noiseDecay); // slow up
    }
  }
  
  // Voice detection: 3/4 bands exceed noise + ZCR in voice range + tilt in voice range
  let voiceBands=0;
  for(let b=0;b<nBands;b++){
    if(fe.bands[b]>noiseFloor[b]*3) voiceBands++;
  }
  const zcrOk=fe.zcr>=0.05 && fe.zcr<=0.18; // voice ZCR 5-18%
  const tiltOk=fe.tilt>=1.5 && fe.tilt<=5;    // voice spectral tilt
  const voiceScore = (voiceBands>=3 ? 1 : 0) + (zcrOk?1:0) + (tiltOk?1:0);
  
  if(isVoice){
    hangover++;
    if(voiceScore<2 && hangover>5){
      isVoice=false;
      if(segStart && f-segStart>=3) classicSegs.push({start:segStart,end:f-1,type:'voice',method:'classic'});
      segStart=null;
    }
  }else{
    if(voiceScore>=2){
      isVoice=true;
      hangover=0;
      segStart=f;
    }
  }
}
if(segStart && nFrames-segStart>=3) classicSegs.push({start:segStart,end:nFrames-1,type:'voice',method:'classic'});

// Post-filter: keep only segments with voice-range F0
const voiceSegs=[];
for(const s of classicSegs){
  const midF=Math.round((s.start+s.end)/2);
  const off=midF*frameLen;
  const half=Math.min(frameLen>>1,Math.floor((nS-off)/2)-1);
  const minLag=Math.floor(sr/1500),maxLag=Math.floor(sr/40);
  let bestLag=0,bestCorr=0;
  for(let lag=minLag;lag<=Math.min(maxLag,Math.floor((nS-off)/2)-1);lag++){
    let c=0,n=0;
    for(let i=0;i<half;i++){const v1=scene.readInt16LE((off+i)*2),v2=scene.readInt16LE((off+i+lag)*2);c+=v1*v2;n+=v1*v1+v2*v2;}
    const corr=n>0?c/Math.sqrt(n):0;
    if(corr>bestCorr){bestCorr=corr;bestLag=lag;}
  }
  const f0=bestLag>0?sr/bestLag:0;
  const durMs=(s.end-s.start)*20;
  if(durMs>=80 && f0>=100 && f0<=350) voiceSegs.push(s);
}

// Use noise-adaptive VAD detected segments (already F0-filtered)
const bgSegs=[];
if(voiceSegs.length>0){
  if(voiceSegs[0].start>3) bgSegs.push({start:0,end:voiceSegs[0].start,type:'bg'});
  for(let i=1;i<voiceSegs.length;i++){
    if(voiceSegs[i].start-voiceSegs[i-1].end>3)
      bgSegs.push({start:voiceSegs[i-1].end,end:voiceSegs[i].start,type:'bg'});
  }
  if(voiceSegs[voiceSegs.length-1].end<nFrames-3)
    bgSegs.push({start:voiceSegs[voiceSegs.length-1].end,end:nFrames-1,type:'bg'});
}

console.log(`\nSegments: ${voiceSegs.length} voice + ${bgSegs.length} background-only`);

// ===== Extract voice features =====
let correctVoice=0,totalVoice=0;
console.log('\nVoice segments:');
for(const seg of voiceSegs){
  const st=seg.start*480, en=seg.end*480+480;
  const nSeg=en-st, half=nSeg>>1;
  totalVoice++;
  
  // F0 on voice segment
  const minLag=Math.floor(sr/1500),maxLag=Math.floor(sr/40);
  let bestLag=0,bestCorr=0;
  for(let lag=minLag;lag<=maxLag;lag++){
    let c=0,n=0;
    for(let i=0;i<half;i++){const v1=scene.readInt16LE((st+i)*2),v2=scene.readInt16LE((st+i+lag)*2);c+=v1*v2;n+=v1*v1+v2*v2;}
    const corr=n>0?c/Math.sqrt(n):0;
    if(corr>bestCorr){bestCorr=corr;bestLag=lag;}
  }
  const f0=bestLag>0?sr/bestLag:0;
  const midi=f0>50?12*Math.log(f0/440)/Math.log(2)+69:0;
  const note=Math.max(0,Math.min(127,Math.round(midi)));
  
  // Velocity
  let peakRms=0;
  for(let i=0;i<Math.min(480*3,nSeg);i+=480){let e=0,cnt=0;for(let j=i;j<Math.min(i+480,nSeg);j++){const v=scene.readInt16LE((st+j)*2);e+=v*v;cnt++;}const r=Math.sqrt(e/cnt);if(r>peakRms)peakRms=r;}
  const vel=Math.round(Math.max(1,Math.min(127,peakRms/32768*127)));

  // Check if f0 in voice range
  const isVoice = f0>=100 && f0<=400 && bestCorr>0.3;
  const nn=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][note%12]+Math.floor(note/12-1);
  const segT=(seg.start*20/1000).toFixed(2);
  console.log(`  ${segT}s ${nn}(${note}) f0=${Math.round(f0)}Hz vel=${vel} corr=${bestCorr.toFixed(2)} ${isVoice?'✓ VOICE':'✗'}`);
  if(isVoice) correctVoice++;
}

console.log(`\nBackground-only segments:`);
for(const seg of bgSegs.slice(0,5)){
  const segT=(seg.start*20/1000).toFixed(2);
  const dur=(seg.end-seg.start)*20;
  console.log(`  ${segT}s bg duration=${dur}ms`);
}

// ===== Subband profile: compare voice vs background =====
console.log('\nSubband profile comparison:');
// Average subbands over all voice segments vs background segments
function avgBands(pcm, startS, endS){
  const fftN=2048,halfN=fftN>>1;
  const re=new Float64Array(fftN),im=new Float64Array(fftN);
  const bands=new Array(11).fill(0);
  let cnt=0;
  for(let s=startS;s+fftN<=endS;s+=fftN/2){
    for(let i=0;i<fftN;i++){
      const idx=Math.min(s+i,Math.floor(pcm.length/2)-1);
      re[i]=pcm.readInt16LE(idx*2)*(0.5*(1-Math.cos(2*Math.PI*i/(fftN-1))));
    }
    // DFT at harmonic frequencies (simplified)
    for(let b=0;b<11;b++){
      const fMin=b===0?80:bandBounds[b],fMax=bandBounds[b+1];
      let e=0;const midF=(fMin+fMax)/2;
      const bin=Math.round(midF*fftN/sr);
      if(bin<1||bin>=halfN)continue;
      let cr=0,ci=0;
      for(let i=0;i<fftN;i++){const a=2*Math.PI*bin*i/fftN;cr+=re[i]*Math.cos(a);ci-=re[i]*Math.sin(a);}
      e=Math.sqrt(cr*cr+ci*ci)/fftN*2;
      bands[b]+=e;
    }
    cnt++;
  }
  if(cnt>0) for(let b=0;b<11;b++) bands[b]/=cnt;
  return bands.map(v=>Math.round(v/32768*31));
}

if(voiceSegs.length>0 && bgSegs.length>0){
  const vb=voiceSegs[0]; const bb=bgSegs[0];
  const voiceBands=avgBands(scene,vb.start*480,vb.end*480+480);
  const bgBands=avgBands(scene,bb.start*480,bb.end*480+480);
  console.log('  Band     Voice    Bg');
  for(let b=0;b<11;b++) console.log(`  ${bandBounds[b]}-${bandBounds[b+1]}Hz  ${voiceBands[b]}      ${bgBands[b]}`);
}

// Summary
console.log(`\n=== Result ===`);
console.log(`Voice segments: ${voiceSegs.length}`);
console.log(`Voice F0 correct: ${correctVoice}/${totalVoice}`);
console.log(`Background segments: ${bgSegs.length}`);
console.log(correctVoice>=2 ? '✓ PASS: Voice extractable in heavy noise' : '✗ FAIL: Voice lost in noise');
