import { qiniuSignaling } from '../bridge/src/core/qiniu-signaling.js';
import { writeFileSync } from 'fs';

const listUsersUrl = qiniuSignaling.getListSignedUrl('oc/users/', 86400);
const listDebugUrl = qiniuSignaling.getListSignedUrl('oc/debug/', 86400);
const tag = 'apk-' + new Date().toISOString().replace(/[:-]/g, '').slice(0, 15);

const outPath = process.argv[2] || 'openchat-flutter/lib/core/version.dart';
writeFileSync(outPath,
  '// Auto-generated. Do not edit.\n' +
  `const appVersion = '${tag}';\n` +
  `const qiniuListUsersUrl = '${listUsersUrl}';\n` +
  `const qiniuListDebugUrl = '${listDebugUrl}';\n`
);

console.log('version.dart generated:', tag);
