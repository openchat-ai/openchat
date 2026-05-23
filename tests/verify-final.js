var qiniu = require('./bridge/node_modules/qiniu');
var crypto = require('crypto');
var https = require('https');
var AK = 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG';
var SK = 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq';

// Flutter algorithm with FIXED deadline (capped at 3600, same as SDK)
var dl = Math.floor(Date.now() / 1000) + 3600;
var pol = JSON.stringify({ scope: 'dapin-xp', deadline: dl });
var flags = Buffer.from(pol).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
var sigBytes = crypto.createHmac('sha1', SK).update(flags).digest();
var sig = Buffer.from(sigBytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
var myToken = AK + ':' + sig + ':' + flags;

// SDK token with same deadline
var mac = new qiniu.auth.digest.Mac(AK, SK);
var sdkToken = new qiniu.rs.PutPolicy({ scope: 'dapin-xp', deadline: dl }).uploadToken(mac);

console.log('Token matches SDK:', myToken === sdkToken);
console.log('My sig:', sig);
console.log('SDK sig:', sdkToken.split(':')[1]);
console.log('My flags:', flags);
console.log('SDK flags:', sdkToken.split(':')[2]);

if (myToken !== sdkToken) {
  console.log('MISMATCH! Debugging:');
  console.log('Policy:', pol);
  console.log('SDK flags decoded:', Buffer.from(sdkToken.split(':')[2], 'base64').toString());
  process.exit(1);
}

console.log('TOKEN MATCHES SDK - uploading...');

function upload(token) {
  return new Promise(function(resolve) {
    var key = 'oc/test-verify-' + Date.now() + '.json';
    var bnd = '----B' + Date.now();
    var body = '';
    body += '--' + bnd + '\r\n';
    body += 'Content-Disposition: form-data; name="token"\r\n\r\n';
    body += token + '\r\n';
    body += '--' + bnd + '\r\n';
    body += 'Content-Disposition: form-data; name="key"\r\n\r\n';
    body += key + '\r\n';
    body += '--' + bnd + '\r\n';
    body += 'Content-Disposition: form-data; name="file"; filename="blob"\r\n';
    body += 'Content-Type: application/octet-stream\r\n\r\n';
    body += '{"test":true}\r\n';
    body += '--' + bnd + '--\r\n';

    var opts = {
      hostname: 'upload.qiniup.com', port: 443, path: '/', method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + bnd,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(opts, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        resolve({ status: res.statusCode, body: d });
      });
    });
    req.on('error', function(e) { resolve({ status: 0, body: e.message }); });
    req.write(body);
    req.end();
  });
}

upload(myToken).then(function(r) {
  console.log('Upload:', r.status, r.status === 200 ? 'OK' : r.body.slice(0, 100));
  if (r.status === 200) {
    console.log('ALL VERIFIED - Flutter code will work');
  } else {
    console.log('UPLOAD FAILED - need more debugging');
  }
}).catch(console.error);
