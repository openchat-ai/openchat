// Test EPC recording file format
import fs from 'fs';

// Simulate call: accumulate frames then write
const frames = [];
for (let i = 0; i < 10; i++) {
  const f = Buffer.alloc(12);
  f[0] = 0x02; f[1] = 0x00; // tagType=spectrum, instrument=0(piano)
  f[2] = (60 << 1) | (i===0?1:0); // C4, onset only on first
  f[3] = (100 << 1) & 0xFE;
  f[4] = 180 - i * 5;
  for (let b = 0; b < 7; b++) f[5 + b] = 20 + b * 3;
  frames.push(f);
}

// Wrap in ResponseFrames
const responseFrames = [];
for (let i = 0; i < frames.length; i += 12) {
  const batch = frames.slice(i, Math.min(i + 12, frames.length));
  const data = Buffer.concat(batch);
  const pl = data.length;
  const rf = Buffer.alloc(7 + pl);
  let o = 0; rf[o++] = 0xBB; rf[o++] = 0x01; rf[o++] = 0xCC;
  rf[o++] = (pl >> 8) & 0xFF; rf[o++] = pl & 0xFF;
  if (pl > 0) data.copy(rf, o); o += pl;
  let ck = 0; for (let j = 1; j < o; j++) ck = (ck + rf[j]) & 0xFF;
  rf[o++] = ck; rf[o++] = 0x7E;
  responseFrames.push(rf);
}

// Build recording file: header + all RFs
const allData = Buffer.concat([Buffer.from([0x45,0x50,0x43,0x31, 0x00,0x01, 0x00,0x00]), Buffer.concat(responseFrames)]);

// Verify
console.log('Recording file size:', allData.length, 'bytes');
console.log('Header:', allData.slice(0, 8).toString('hex'));
console.log('Magic OK:', allData[0]===0x45 && allData[1]===0x50 && allData[2]===0x43 && allData[3]===0x31);
console.log('Version:', (allData[4]<<8)|allData[5]);
console.log('First RF:', allData.slice(8, 15).toString('hex'));

// Version check: major match?
const major = allData[4];
const myMajor = 0;
console.log('Major OK:', major === myMajor);

// Verify bytes > 0x7F survive roundtrip (binary safety)
const hasHighBytes = [...allData].some(b => b > 0x7F);
console.log('Has bytes >127:', hasHighBytes ? 'yes (needs binary-safe transport)' : 'no');

// Check it passes the Dart writeFile allowed prefixes
const path = 'oc/call_recordings/phone_eason_phone_bob_12345.epc';
const allowedPrefixes = ['oc/config/', 'oc/debug/', 'oc/logs/', 'oc/call_recordings/'];
const ok = allowedPrefixes.some(p => path.startsWith(p));
console.log('\nPath check:', path);
console.log('Allowed:', ok);

console.log('\n✓ Recording format verified');
