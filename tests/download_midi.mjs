import https from 'https';
import fs from 'fs';
const url = 'https://www.midishow.com/en/midi/hotel-california-midi-download-136021';
https.get(url, { timeout: 10000 }, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    // Find direct MIDI download link
    const m = data.match(/href="([^"]+\.mid)"/i);
    if (m) {
      const midiUrl = m[1].startsWith('http') ? m[1] : 'https://www.midishow.com' + m[1];
      console.log('Downloading:', midiUrl);
      https.get(midiUrl, (r2) => {
        const chunks = [];
        r2.on('data', (c) => chunks.push(c));
        r2.on('end', () => {
          fs.writeFileSync('hotel_california.mid', Buffer.concat(chunks));
          console.log('OK -', chunks.reduce((s, x) => s + x.length, 0), 'bytes');
        });
      });
    } else {
      console.log('No MIDI link found');
    }
  });
}).on('error', (e) => console.log('Error:', e.message));
