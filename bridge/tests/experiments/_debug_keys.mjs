const _ak = String.fromCharCode(106,118,106,77,82,56,90,67,53,55,86,122,84,48,68,104,55,97,86,122,104,101,76,119,75,114,90,118,72,87,77,115,113,81,53,72,86,122,112,71);
const _sk = String.fromCharCode(116,102,109,83,49,50,86,84,70,77,95,102,115,48,78,74,97,77,82,72,85,119,48,57,84,86,107,87,72,65,117,90,120,54,119,98,45,102,73,113);

import qiniu from 'qiniu';

// 1. RS API — 列出 dapin-xp bucket
const mac = new qiniu.auth.digest.Mac(_ak, _sk);
const cfg = new qiniu.conf.Config({ zone: qiniu.zone.Zone_z0 });
const bm = new qiniu.rs.BucketManager(mac, cfg);

const rsResult = await new Promise((res, rej) =>
  bm.listPrefix('dapin-xp', { prefix: 'oc/', limit: 5 }, (err, body, info) => {
    if (err) rej(err);
    else res({ status: info?.statusCode, count: body?.items?.length || 0, firstKey: body?.items?.[0]?.key });
  })
);
console.log('RS dapin-xp:', JSON.stringify(rsResult));

// Check what buckets this AK has access to
// (only possible via RS API with bucket listing)
const buckets = await new Promise((res, rej) =>
  bm.buckets(true, (err, body, info) => {
    if (err) rej(err);
    else res(body);
  })
);
console.log('Buckets accessible with this AK:', buckets?.slice(0, 10));
