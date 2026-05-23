export function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenChat Bridge</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#06080f;color:#d0d4e0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:20px;background-image:radial-gradient(ellipse at 50% 0%, #121832 0%, #06080f 70%)}
.container{width:100%;max-width:720px}
header{text-align:center;padding:30px 0 20px}
header h1{font-size:28px;font-weight:700;background:linear-gradient(135deg, #7c8aff, #c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.subtitle{color:#6a7a9a;font-size:13px;margin-top:4px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:24px 0}
.card{position:relative;background:#0c0f1a;border-radius:12px;padding:18px;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px}
.card.uptime::before{background:linear-gradient(90deg,#7c8aff,#c084fc)}
.card.sessions::before{background:linear-gradient(90deg,#2ed573,#7bed9f)}
.card.ws::before{background:linear-gradient(90deg,#ffa502,#ff7f50)}
.card.providers::before{background:linear-gradient(90deg,#1e90ff,#00d2ff)}
.card.residents::before{background:linear-gradient(90deg,#c084fc,#ff7f50)}
.label{font-size:11px;color:#5a6a8a;text-transform:uppercase;letter-spacing:1px}
.value{font-size:28px;font-weight:700;margin-top:6px}
.card.uptime .value{color:#7c8aff}
.card.sessions .value{color:#2ed573}
.card.ws .value{color:#ffa502}
.card.providers .value{color:#1e90ff}
.card.residents .value{color:#c084fc}
.latest{background:#0c0f1a;border-radius:12px;padding:18px;margin:16px 0}
.latest h3{font-size:14px;color:#5a6a8a;margin-bottom:12px}
.latest table{width:100%;border-collapse:collapse;font-size:13px}
.latest td{padding:6px 8px;border-bottom:1px solid #1a1f2e}
.latest td:first-child{color:#7c8aff;font-family:monospace}
footer{text-align:center;color:#3a4a5a;font-size:12px;padding:20px}
</style>
</head>
<body>
<div class="container">
<header><h1>OpenChat Bridge</h1><div class="subtitle">Dashboard</div></header>
<div class="cards">
  <div class="card uptime"><div class="label">Uptime</div><div class="value" id="v-uptime">--<span class="unit">s</span></div></div>
  <div class="card sessions"><div class="label">Sessions</div><div class="value" id="v-sessions">--</div></div>
  <div class="card ws"><div class="label">WS Clients</div><div class="value" id="v-ws">--</div></div>
  <div class="card providers"><div class="label">Providers</div><div class="value" id="v-providers">--</div></div>
  <div class="card residents"><div class="label">Residents</div><div class="value" id="v-residents">--</div></div>
</div>
</div>
<script>
async function load(){
  try{
    const r=await fetch('/api/dashboard');
    const d=await r.json();
    const u=d.uptime||0;
    const h=Math.floor(u/3600),m=Math.floor((u%3600)/60),s=u%60;
    document.getElementById('v-uptime').innerHTML=h+'h&nbsp;'+m+'m&nbsp;'+s+'s';
    document.getElementById('v-sessions').textContent=d.sessions||0;
    document.getElementById('v-ws').textContent=d.wsClients||0;
    document.getElementById('v-providers').textContent=d.providers||0;
    document.getElementById('v-residents').textContent=d.residents||0;
  }catch(e){document.querySelector('.cards').innerHTML='<p style=color:#ff4757>Failed to load: '+e.message+'</p>'}
}
load();
setInterval(load,5000);
</script>
<footer>OpenChat Bridge</footer>
</body></html>`;
}
