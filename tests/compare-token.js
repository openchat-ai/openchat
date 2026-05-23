var crypto = require('crypto');
var qiniu = require('../bridge/node_modules/qiniu');

var AK = 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG';
var SK = 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq';

// SDK token
var mac = new qiniu.auth.digest.Mac(AK, SK);
var policy = new qiniu.rs.PutPolicy({scope:'dapin-xp:oc/test-sdk.json',deadline:Math.floor(Date.now()/1000)+7200});
var flags = policy.getFlags();
var flagsJson = JSON.stringify(flags);

// SDK's urlsafeBase64Encode
var urlsafeBase64Encode = function(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
// SDK's hmacSha1
var hmacSha1 = function(text, secretKey) {
  return crypto.createHmac('sha1', secretKey).update(text).digest('base64');
};
// SDK's base64ToUrlSafe
var base64ToUrlSafe = function(str) {
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

var encodedFlags = urlsafeBase64Encode(flagsJson);
var encoded = hmacSha1(encodedFlags, SK);
var encodedSign = base64ToUrlSafe(encoded);
var sdkToken = [AK, encodedSign, encodedFlags].join(':');

console.log('SDK token:', sdkToken);
console.log('Flags JSON:', flagsJson);
console.log('Encoded flags:', encodedFlags);
console.log('Signature:', encodedSign);

// Now test with the upload
var https = require('https');
var key = 'oc/test-compare-' + Date.now() + '.json';
var token = [AK, base64ToUrlSafe(hmacSha1(urlsafeBase64Encode(JSON.stringify({scope:'dapin-xp:'+key,deadline:flags.deadline})), SK)), urlsafeBase64Encode(JSON.stringify({scope:'dapin-xp:'+key,deadline:flags.deadline}))].join(':');

var boundary = '----B' + Date.now();
var body = '';
body += '--' + boundary + '\r\n';
body += 'Content-Disposition: form-data; name="token"\r\n\r\n';
body += token + '\r\n';
body += '--' + boundary + '\r\n';
body += 'Content-Disposition: form-data; name="key"\r\n\r\n';
body += key + '\r\n';
body += '--' + boundary + '\r\n';
body += 'Content-Disposition: form-data; name="file"; filename="blob"\r\n';
body += 'Content-Type: application/octet-stream\r\n\r\n';
body += JSON.stringify({test:true}) + '\r\n';
body += '--' + boundary + '--\r\n';

var opts = {
  hostname: 'upload.qiniup.com', port: 443, path: '/', method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': Buffer.byteLength(body)
  }
};
var req = https.request(opts, function(res) {
  var data = '';
  res.on('data', function(c) { data += c; });
  res.on('end', function() {
    console.log('Upload:', res.statusCode, res.statusCode === 200 ? 'OK' : data.slice(0, 100));
  });
});
req.on('error', function(e) { console.error('Error:', e); });
req.write(body);
req.end();
