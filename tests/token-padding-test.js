var crypto = require('crypto');
var https = require('https');
var AK = 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG';
var SK = 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlNoPad(buf) {
  return b64url(buf).replace(/=+$/, '');
}

// Create tokens with and without padding
var deadline = Math.floor(Date.now()/1000) + 7200;
var policy = JSON.stringify({scope: 'dapin-xp', deadline: deadline});
var encoded = Buffer.from(policy).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
var hmac = crypto.createHmac('sha1', SK).update(encoded).digest();

var tokenWithPad = AK + ':' + b64url(hmac) + ':' + encoded;
var tokenNoPad = AK + ':' + b64urlNoPad(hmac) + ':' + encoded;

console.log('Token with =:  ' + tokenWithPad.slice(0, 70) + '...');
console.log('Token without: ' + tokenNoPad.slice(0, 70) + '...');

function upload(token, label) {
  var key = 'oc/test-pad-' + Date.now() + '-' + label + '.json';
  var bnd = '----Boundary' + Date.now();
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

  return new Promise((resolve) => {
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
        resolve({key: key, status: res.statusCode, body: d, label: label});
      });
    });
    req.on('error', function(e) { resolve({key: key, status: 0, body: e.message, label: label}); });
    req.write(body);
    req.end();
  });
}

async function main() {
  var r1 = await upload(tokenWithPad, 'with-pad');
  console.log('With pad:    ' + r1.status + (r1.status === 200 ? ' OK' : ' ' + r1.body.slice(0, 50)));
  
  var r2 = await upload(tokenNoPad, 'no-pad');
  console.log('Without pad: ' + r2.status + (r2.status === 200 ? ' OK' : ' ' + r2.body.slice(0, 50)));
}

main().catch(console.error);
