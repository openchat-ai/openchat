// Research by 小明: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T08:20:17.248Z

const http = require('http');
const { TLS } = require('tls');

const server = http.createServer((req, res) => {
  const url = 'https://localhost:8080';
  const options = { cert: new TLS({ cert: 'cert.pem' }) };
  const req = new http.Request({ method: 'POST', url: url, body: JSON.stringify({ data: '系统状态'} ) });
  const tlsOptions = { cert: options };
  const tls = new TLS(tlsOptions);
  const req = new http.Request(req, tls);
  req.headers = { 'X-System-State': '检测结果'};
  const response = tls.send(req);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(response.data + '成功连接！');
});

const client = http.createServer(server);
client.listen(3000, () => {
  console.log('服务器运行在 http://localhost:3000');
});
console.log('系统状态检测方法：通过TLS连接或HTTP-REST端点连接，成功确认同一网络环境');