import { createHmac, createHash } from 'crypto';

const config = {
  accessKey: process.env.QINIU_ACCESS_KEY,
  secretKey: process.env.QINIU_SECRET_KEY,
  bucket: process.env.QINIU_BUCKET || 'dapin-xp',
  region: process.env.QINIU_REGION || 'cn-east-1',
  domain: process.env.QINIU_DOMAIN || 'https://dapin-xp.s3.cn-east-1.qiniucs.com',
};

const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
const dateStamp = amzDate.slice(0, 8);
const credential = `${config.accessKey}/${dateStamp}/${config.region}/s3/aws4_request`;
const host = config.domain.replace('https://', '');

const allParams = {
  'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
  'X-Amz-Credential': credential,
  'X-Amz-Date': amzDate,
  'X-Amz-Expires': '60',
  'X-Amz-SignedHeaders': 'host',
  'list-type': '2',
  prefix: 'oc/',
};

const sortedKeys = Object.keys(allParams).sort();
const sortedQuery = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`).join('&');

const canonicalHeaders = `host:${host}\n`;
const canonicalRequest = ['GET', '/', sortedQuery, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${dateStamp}/${config.region}/s3/aws4_request`, hashedRequest].join('\n');

const kDate = createHmac('sha256', 'AWS4' + config.secretKey).update(dateStamp).digest();
const kRegion = createHmac('sha256', kDate).update(config.region).digest();
const kService = createHmac('sha256', kRegion).update('s3').digest();
const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

const url = `${config.domain}/?${sortedQuery}&X-Amz-Signature=${signature}`;
console.log('URL:', url.slice(0, 150) + '...');

const resp = await fetch(url);
console.log('Status:', resp.status, resp.statusText);
const text = await resp.text();
console.log('Body:', text.slice(0, 800));
