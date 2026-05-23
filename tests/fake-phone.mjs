// Fake phone for testing — registers in Qiniu, sends call-request to real phone
// Usage: node tests/fake-phone.mjs <targetPeerId>

import crypto from 'crypto';

const AK = 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG';
const SK = 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq';
const BUCKET = 'dapin-xp';
const ENDPOINT = 'dapin-xp.s3.cn-east-1.qiniucs.com';
const REGION = 'cn-east-1';

const peerId = `fake_${Date.now()}`;

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function fmtDate(d) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
}

function fmtAmz(d) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function authHeaders(method, path, bodySha) {
  const now = new Date();
  const amzDate = fmtAmz(now) + 'Z';
  const dateStamp = fmtDate(now);
  const bodyHash = bodySha || sha256('');
  const signedHeaders = 'host;x-amz-date;x-amz-content-sha256';

  const canonicalRequest = [
    method, path, '',
    `host:${ENDPOINT}`,
    `x-amz-content-sha256:${bodyHash}`,
    `x-amz-date:${amzDate}`,
    '', signedHeaders, bodyHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');

  const kDate = hmacSha256('AWS4' + SK, dateStamp);
  const kRegion = hmacSha256(kDate, REGION);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${AK}/${credentialScope},SignedHeaders=${signedHeaders},Signature=${signature}`,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': bodyHash,
  };
}

async function s3Put(key, body) {
  const path = '/' + BUCKET + '/' + key;
  const headers = authHeaders('PUT', path, sha256(body));
  headers['Content-Type'] = 'application/json';
  const res = await fetch(`https://${ENDPOINT}${path}`, { method: 'PUT', headers, body });
  if (!res.ok) throw new Error(`PUT ${key}: HTTP ${res.status}`);
}

async function main() {
  const targetPeerId = process.argv[2];
  if (!targetPeerId) {
    console.log('Usage: node tests/fake-phone.mjs <targetPeerId>');
    console.log('Get your phone peerId from Qiniu: https://dapin-xp.s3.cn-east-1.qiniucs.com/oc/users/');
    process.exit(1);
  }

  // Register fake peer
  const regBody = JSON.stringify({
    peerId, status: 'online',
    publicIp: '127.0.0.1', udpPort: 0,
    ts: Date.now(),
  });
  await s3Put(`oc/users/${peerId}.json`, regBody);
  console.log(`Registered as ${peerId}`);

  // Send call-request to real phone
  const callBody = JSON.stringify({
    action: 'call-request',
    fromPeerId: peerId,
    publicIp: '127.0.0.1', udpPort: 0,
    ts: Date.now(),
  });
  await s3Put(`oc/calls/${targetPeerId}/${peerId}.json`, callBody);
  console.log(`Sent call-request to ${targetPeerId}`);

  // Poll for response
  console.log('Waiting for call-accept...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const path = '/' + BUCKET + '/oc/calls/' + peerId + '/';
      const headers = authHeaders('GET', path);
      const res = await fetch(`https://${ENDPOINT}${path}`, { headers });
      if (res.ok) {
        const xml = await res.text();
        const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
        for (const key of keys) {
          const gp = '/' + BUCKET + '/' + key;
          const gh = authHeaders('GET', gp);
          const gr = await fetch(`https://${ENDPOINT}${gp}`, { headers: gh });
          if (gr.ok) {
            const msg = JSON.parse(await gr.text());
            if (msg.action === 'call-accept') {
              console.log('Call accepted!');
              return;
            }
          }
        }
      }
    } catch (_) {}
  }
  console.log('No response received');
}

main().catch(console.error);
