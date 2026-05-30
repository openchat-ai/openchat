import fs from 'fs';

const segments = [
  { name: 'T1_intro_start', start: 0, dur: 10 },
  { name: 'T2_intro_full', start: 10, dur: 20 },
  { name: 'T3_verse1', start: 52, dur: 31 },
  { name: 'T4_chorus1', start: 83, dur: 20 },
  { name: 'T5_solo', start: 200, dur: 20 },
  { name: 'T6_outro', start: 330, dur: 20 },
];

function parseWavHeader(buf) {
  let offset = 12; // skip RIFF header
  let sr = 0, bits = 0, ch = 0, dataOffset = 0;
  while (offset < buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      sr = buf.readUInt32LE(offset + 12);
      ch = buf.readUInt16LE(offset + 10);
      bits = buf.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      break;
    }
    offset += 8 + chunkSize;
  }
  return { sr, bits, ch, dataOffset };
}

function cutSegment(srcPath, outPath, startSec, durSec) {
  const fd = fs.openSync(srcPath, 'r');
  const pre = Buffer.alloc(4096);
  const readLen = fs.readSync(fd, pre, 0, 4096, 0);
  const hdr = parseWavHeader(pre.subarray(0, readLen));
  const { sr, bits, ch, dataOffset } = hdr;
  const bps = bits / 8;
  const startByte = dataOffset + Math.round(startSec * sr) * ch * bps;
  const numFrames = Math.round(durSec * sr);
  const dataSize = numFrames * ch * bps;

  // Build new header (standard 44-byte PCM WAV header)
  const outHdr = Buffer.alloc(44);
  outHdr.write('RIFF', 0);
  outHdr.writeUInt32LE(36 + dataSize, 4);
  outHdr.write('WAVE', 8);
  outHdr.write('fmt ', 12);
  outHdr.writeUInt32LE(16, 16);
  outHdr.writeUInt16LE(1, 20);
  outHdr.writeUInt16LE(ch, 22);
  outHdr.writeUInt32LE(sr, 24);
  outHdr.writeUInt32LE(sr * ch * bps, 28);
  outHdr.writeUInt16LE(ch * bps, 32);
  outHdr.writeUInt16LE(bits, 34);
  outHdr.write('data', 36);
  outHdr.writeUInt32LE(dataSize, 40);

  const data = Buffer.alloc(dataSize);
  fs.readSync(fd, data, 0, dataSize, startByte);
  fs.closeSync(fd);

  fs.writeFileSync(outPath, Buffer.concat([outHdr, data]));
  console.log(`  ${outPath}: ${startSec}s -> ${(startSec + durSec)}s (${(dataSize/1024/1024).toFixed(1)}MB)`);
}

console.log('Cutting segments from jzlg.wav...');
for (const seg of segments) cutSegment('jzlg.wav', `jzlg_${seg.name}.wav`, seg.start, seg.dur);
console.log('Done.');
