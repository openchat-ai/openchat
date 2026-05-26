import { qiniuSignaling } from '../src/core/qiniu-signaling.js';
const bucket = {name:'dapin-xp',domain:'https://dapin-xp.s3.cn-east-1.qiniucs.com'};
const keys = await qiniuSignaling.listObjects('oc/audio/');
const enc = keys.filter(k => k.key.endsWith('.enc')).sort((a,b) => b.key.localeCompare(a.key));
const latest = enc.slice(0, 3);
for (const k of latest) {
  const raw = await qiniuSignaling.readFrom(bucket, k.key);
  const j = JSON.parse(raw.toString());
  const actual = j.data.length * 3 / 4;
  const sizeKB = (actual / 1000).toFixed(0);
  const mode = sizeKB > 30 ? 'RAW' : sizeKB > 5 ? 'OPUS' : 'NEURAL';
  console.log(k.key.split('/').pop(), sizeKB + 'KB', mode);
}
