var crypto = require('crypto');
var https = require('https');
var AK = 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG';
var SK = 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq';
function b64(b) { return Buffer.from(b).toString('base64url').replace(/=+$/, ''); }
function tok(key) {
  var dl = Math.floor(Date.now()/1000) + 7200;
  var pol = JSON.stringify({scope:'dapin-xp:'+key,deadline:dl});
  var enc = b64(Buffer.from(pol));
  var sig = b64(crypto.createHmac('sha1',SK).update(enc).digest());
  return AK + ':' + sig + ':' + enc;
}
var key = 'oc/test-final-' + Date.now() + '.json';
var token = tok(key);
console.log('Token:', token.slice(0,50)+'...');

var bnd = '----Test' + Date.now();
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
body += '{"test":true}' + '\r\n';
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
    console.log('Upload:', res.statusCode, res.statusCode === 200 ? 'OK' : d.slice(0, 100));
    if (res.statusCode !== 200) {
      console.log('Full response:', d);
    }
  });
});
req.on('error', function(e) { console.log('NETWORK ERROR:', e.message); });
req.write(body);
req.end();
