import crypto from 'node:crypto';
import https from 'node:https';

const ak = 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG';
const sk = 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq';
const bucket = 'dapin-xp';
const key = 'oc/config/_speedtest.json';
const payload = JSON.stringify({ t: Date.now(), data: 'x'.repeat(40000) }); // ~40KB

// Test 1: Qiniu form upload
function formUpload() {
  return new Promise((resolve, reject) => {
    const policy = Buffer.from(JSON.stringify({ scope: bucket + ':' + key, deadline: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const sig = crypto.createHmac('sha1', sk).update(policy).digest('base64url');
    const token = `${ak}:${sig}:${policy}`;

    const boundary = '----' + Date.now();
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="token"\r\n\r\n${token}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\n${key}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.json"\r\nContent-Type: application/json\r\n\r\n${payload}`,
      `--${boundary}--`,
    ].join('\r\n');

    const start = Date.now();
    const req = https.request({
      hostname: 'upload-z0.qiniup.com', method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': Buffer.byteLength(parts) },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ time: Date.now() - start, status: res.statusCode, body: d })); });
    req.on('error', reject);
    req.end(parts);
  });
}

// Test 2: S3 presigned PUT (simplified)
function s3Put() {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';
    const dateStamp = amzDate.substring(0, 8);
    const region = 'cn-east-1', service = 's3';
    const endpoint = 'dapin-xp.s3.cn-east-1.qiniucs.com';
    const method = 'PUT';
    const expires = 300;
    const canonicalUri = '/' + key;

    const params = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${ak}/${dateStamp}/${region}/${service}/aws4_request`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': expires.toString(),
      'X-Amz-SignedHeaders': 'host',
    };

    const sortedKeys = Object.keys(params).sort();
    const canonicalQueryString = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');

    const canonicalRequest = [method, canonicalUri, canonicalQueryString, `host:${endpoint}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

    const hk = (key, str) => crypto.createHmac('sha256', key).update(str).digest();
    const kDate = hk('AWS4' + sk, dateStamp);
    const kRegion = hk(kDate, region);
    const kService = hk(kRegion, service);
    const kSigning = hk(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const url = `https://${endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

    const start = Date.now();
    const req = https.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ time: Date.now() - start, status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  console.log('=== Upload Speed Test (40KB payload) ===\n');

  console.log('1) Qiniu form upload (upload-z0.qiniup.com)...');
  const r1 = await formUpload();
  console.log(`   Status: ${r1.status} | Time: ${r1.time}ms`);

  console.log('\n2) S3 presigned PUT (s3.cn-east-1.qiniucs.com)...');
  const r2 = await s3Put();
  console.log(`   Status: ${r2.status} | Time: ${r2.time}ms`);

  // Cleanup
  console.log('\n--- Cleanup: delete test file ---');
  // DELETE via S3 pre-signed
  // (simplified - just report)
  console.log('Done');
})();
