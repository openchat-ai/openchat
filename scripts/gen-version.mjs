// Generate version.dart with pre-signed S3 URLs.
// Uses only Node.js built-in crypto (no npm dependencies).
import { createHash, createHmac } from 'crypto';
import { writeFileSync } from 'fs';

const AK = 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG';
const SK = 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq';
const BUCKET = 'dapin-xp';
const EP = 'dapin-xp.s3.cn-east-1.qiniucs.com';
const REGION = 'cn-east-1';

function sha256(d) { return createHash('sha256').update(d).digest('hex'); }
function hmac(k, d) { return createHmac('sha256', k).update(d).digest(); }

function presignedListUrl(prefix, expires) {
  const n = new Date();
  const az = n.toISOString().replace(/[:-]|\.\d{3}/g, '') + 'Z';
  const ds = az.slice(0, 8);
  const params = {
    'prefix': prefix,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${AK}/${ds}/${REGION}/s3/aws4_request`,
    'X-Amz-Date': az,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const qs = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const cr = ['GET', '/', qs, `host:${EP}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const cs = `${ds}/${REGION}/s3/aws4_request`;
  const st = ['AWS4-HMAC-SHA256', az, cs, sha256(cr)].join('\n');
  const kD = hmac('AWS4' + SK, ds);
  const kR = hmac(kD, REGION);
  const kS = hmac(kR, 's3');
  const kG = hmac(kS, 'aws4_request');
  const sig = hmac(kG, st).toString('hex');
  return `https://${EP}/?${qs}&X-Amz-Signature=${sig}`;
}

const tag = 'apk-' + new Date().toISOString().replace(/[:-]/g, '').slice(0, 15);
const listUsersUrl = presignedListUrl('oc/users/', 86400);
const listDebugUrl = presignedListUrl('oc/debug/', 86400);

const outPath = process.argv[2] || 'openchat-flutter/lib/core/version.dart';
writeFileSync(outPath,
  '// Auto-generated. Do not edit.\n' +
  `const appVersion = '${tag}';\n` +
  `const qiniuListUsersUrl = '${listUsersUrl}';\n` +
  `const qiniuListDebugUrl = '${listDebugUrl}';\n`
);
console.log('version.dart generated:', tag);
