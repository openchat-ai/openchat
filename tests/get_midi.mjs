import https from 'https';
import fs from 'fs';

// Try multiple sources
const sources = [
  'https://bitmidi.com/uploads/46061.mid',
  'https://www.midi-karaoke.info/mid/20e12aed.mid',
  'https://files.khinsider.com/midifiles/eagles/hotelcalifornia.mid',
];

let tried = 0;
for (const url of sources) {
  try {
    const res = await new Promise((resolve, reject) => {
      https.get(url, { timeout: 8000 }, (r) => {
        if (r.statusCode === 200) resolve(r);
        else if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          const redirect = r.headers.location.startsWith('http') ? r.headers.location : new URL(r.headers.location, url).href;
          https.get(redirect, { timeout: 8000 }, (r2) => resolve(r2)).on('error', reject);
        } else reject(new Error('HTTP ' + r.statusCode));
      }).on('error', reject);
    });
    const chunks = [];
    for await (const c of res) chunks.push(c);
    fs.writeFileSync('hotel_california.mid', Buffer.concat(chunks));
    console.log('Downloaded from', url, '-', chunks.reduce((s, x) => s + x.length, 0), 'bytes');
    process.exit(0);
  } catch (e) {
    console.log('Failed:', url, '-', e.message);
    tried++;
  }
}
console.log('All sources failed');
