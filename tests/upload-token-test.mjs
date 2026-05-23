import { createHmac } from 'crypto';
import { request as httpsReq } from 'https';

const AK = 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG';
const SK = 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq';
const BUCKET = 'dapin-xp';

function base64Url(b) {
  return Buffer.from(b).toString('base64url').replace(/=+$/, '');
}

// Flutter QiniuDirectClient._uploadToken (FIXED order)
function uploadToken(key) {
  const deadline = Math.floor(Date.now() / 1000) + 7200;
  const policy = JSON.stringify({ scope: BUCKET + ':' + key, deadline });
  const encoded = base64Url(Buffer.from(policy));
  const hmacSha1 = createHmac('sha1', SK).update(encoded).digest();
  // SDK order: accessKey:signature:encodedFlags
  return AK + ':' + base64Url(hmacSha1) + ':' + encoded;
}

async function main() {
  const key = 'oc/test-upload-' + Date.now() + '.json';
  const token = uploadToken(key);
  console.log('Token:', token.slice(0, 50) + '...');

  const boundary = '----Boundary' + Date.now();
  let body = '';
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="token"\r\n\r\n';
  body += token + '\r\n';
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="key"\r\n\r\n';
  body += key + '\r\n';
  body += '--' + boundary + '\r\n';
  body += 'Content-Disposition: form-data; name="file"; filename="blob"\r\n';
  body += 'Content-Type: application/octet-stream\r\n\r\n';
  body += '{"test":true}\r\n';
  body += '--' + boundary + '--\r\n';

  console.log('Uploading...');
  const result = await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'upload.qiniup.com', port: 443, path: '/', method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = httpsReq(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (result.status === 200) {
    console.log('UPLOAD OK');
  } else {
    console.log('FAILED:', result.status, result.body);
  }
}

main().catch(e => console.error('ERROR:', e));
