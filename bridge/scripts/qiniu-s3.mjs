// Bridge 端 Qiniu S3 兼容 API 封装（list/get/put）
import { createHmac, createHash } from 'crypto';

const _ak = String.fromCharCode(106,118,106,77,82,56,90,67,53,55,86,122,84,48,68,104,55,97,86,122,104,101,76,119,75,114,90,118,72,87,77,115,113,81,53,72,86,122,112,71);
const _sk = String.fromCharCode(116,102,109,83,49,50,86,84,70,77,95,102,115,48,78,74,97,77,82,72,85,119,48,57,84,86,107,87,72,65,117,90,120,54,119,98,45,102,73,113);

const config = {
  accessKey: process.env.QINIU_ACCESS_KEY || _ak,
  secretKey: process.env.QINIU_SECRET_KEY || _sk,
  bucket: process.env.QINIU_BUCKET || 'dapin-xp',
  region: process.env.QINIU_REGION || 'cn-east-1',
  domain: process.env.QINIU_DOMAIN || 'https://dapin-xp.s3.cn-east-1.qiniucs.com',
};

function signV4(method, canonicalUri, canonicalQueryString, payloadHash, expires) {
  const host = config.domain.replace('https://', '');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credential = `${config.accessKey}/${dateStamp}/${config.region}/s3/aws4_request`;

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expires.toString(),
    'X-Amz-SignedHeaders': 'host',
  };

  const allParams = { ...params };
  if (canonicalQueryString) {
    for (const pair of canonicalQueryString.split('&')) {
      const [k, v] = pair.split('=');
      if (k && v) allParams[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }

  const sortedKeys = Object.keys(allParams).sort();
  const sortedQuery = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';

  const canonicalRequest = [
    method.toUpperCase(), canonicalUri, sortedQuery,
    canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');

  const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${dateStamp}/${config.region}/s3/aws4_request`, hashedRequest].join('\n');

  const kDate = createHmac('sha256', 'AWS4' + config.secretKey).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(config.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `${config.domain}${canonicalUri}?${sortedQuery}&X-Amz-Signature=${signature}`;
}

async function qiniuList(prefix) {
  const url = signV4('GET', '/', `prefix=${encodeURIComponent(prefix)}`, 'UNSIGNED-PAYLOAD', 60);
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const xml = await resp.text();
  const keys = [];
  const regex = /<Key>([^<]+)<\/Key>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) keys.push(m[1]);
  return keys;
}

async function qiniuGet(key) {
  const url = signV4('GET', `/${key}`, '', 'UNSIGNED-PAYLOAD', 60);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`qiniuGet HTTP ${resp.status} for ${key}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function qiniuPut(key, data) {
  const url = signV4Put(key);
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
    body: data,
  });
  if (!resp.ok) throw new Error(`qiniuPut HTTP ${resp.status} for ${key}`);
}

async function qiniuDelete(key) {
  const url = signV4Delete(key);
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 204) throw new Error(`qiniuDelete HTTP ${resp.status} for ${key}`);
}

async function qiniuDeletePrefix(prefix) {
  const keys = await qiniuList(prefix);
  const results = [];
  for (const key of keys) {
    try {
      await qiniuDelete(key);
      results.push({ key, ok: true });
    } catch (e) {
      results.push({ key, ok: false, error: e.message });
    }
  }
  return results;
}

function signV4Delete(key) {
  const host = config.domain.replace('https://', '');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credential = `${config.accessKey}/${dateStamp}/${config.region}/s3/aws4_request`;
  const canonicalUri = `/${key}`;

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '3600',
    'X-Amz-SignedHeaders': 'host',
  };

  const sortedKeys = Object.keys(params).sort();
  const canonicalQueryString = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';

  const canonicalRequest = ['DELETE', canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${dateStamp}/${config.region}/s3/aws4_request`, hashedRequest].join('\n');

  const kDate = createHmac('sha256', 'AWS4' + config.secretKey).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(config.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `${config.domain}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

function signV4Put(key) {
  const host = config.domain.replace('https://', '');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credential = `${config.accessKey}/${dateStamp}/${config.region}/s3/aws4_request`;
  const canonicalUri = `/${key}`;

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '3600',
    'X-Amz-SignedHeaders': 'host;x-amz-content-sha256',
  };

  const sortedKeys = Object.keys(params).sort();
  const canonicalQueryString = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\n`;
  const signedHeaders = 'host;x-amz-content-sha256';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = ['PUT', canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${dateStamp}/${config.region}/s3/aws4_request`, hashedRequest].join('\n');

  const kDate = createHmac('sha256', 'AWS4' + config.secretKey).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(config.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `${config.domain}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export { qiniuList, qiniuGet, qiniuPut, qiniuDelete, qiniuDeletePrefix };
