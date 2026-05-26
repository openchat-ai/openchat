import { qiniuSignaling } from '../src/core/qiniu-signaling.js';
const bucket = {name:'dapin-xp',domain:'https://dapin-xp.s3.cn-east-1.qiniucs.com'};
for (let i = 0; i < 20; i++) {
  const keys = await qiniuSignaling.listObjects('oc/audio/');
  const enc = keys.filter(k => k.key.endsWith('.enc') && !k.key.includes('0097'));
  if (enc.length > 0) {
    const k = enc[enc.length - 1];
    const raw = await qiniuSignaling.readFrom(bucket, k.key);
    const j = JSON.parse(raw.toString());
    const actualSize = j.data.length * 3 / 4;
    console.log('SEQ', k.key.split('_').pop().replace('.enc',''), 'SIZE', actualSize.toFixed(0), 'bytes');
    break;
  }
  await new Promise(r => setTimeout(r, 2000));
}
process.exit(0);
