import 'dotenv/config';
import fs from 'fs';
import qiniu from 'qiniu';

const accessKey = process.env.QINIU_ACCESS_KEY;
const secretKey = process.env.QINIU_SECRET_KEY;
const bucket = process.env.QINIU_BUCKET || 'openchat';

if (!accessKey || !secretKey) {
  console.error('Missing QINIU_ACCESS_KEY / QINIU_SECRET_KEY in .env');
  process.exit(1);
}

const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
const config = new qiniu.conf.Config({ zone: qiniu.zone.Zone_z0 });
const formUploader = new qiniu.form_up.FormUploader(config);
const putExtra = new qiniu.form_up.PutExtra();

const key = 'oc/config/audio.json';
const content = fs.readFileSync('../../docs/config/audio.json', 'utf8');
const buffer = Buffer.from(content, 'utf8');

const uploadToken = new qiniu.rs.PutPolicy({
  scope: `${bucket}:${key}`,
}).uploadToken(mac);

formUploader.put(uploadToken, key, buffer, putExtra, (err, ret) => {
  if (err) {
    console.error('Upload failed:', err.message || err);
    process.exit(1);
  }
  console.log('Upload OK:', ret.key, ret.hash);
});
