export function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenChat Bridge</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  background:#06080f;
  color:#d0d4e0;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  min-height:100vh;
  display:flex;
  flex-direction:column;
  align-items:center;
  padding:20px;
  background-image:radial-gradient(ellipse at 50% 0%, #121832 0%, #06080f 70%);
}
.container{width:100%;max-width:720px}
header{
  text-align:center;
  padding:30px 0 20px;
}
header h1{
  font-size:28px;
  font-weight:700;
  background:linear-gradient(135deg, #7c8aff, #c084fc);
  -webkit-background-clip:text;
  -webkit-text-fill-color:transparent;
  background-clip:text;
  letter-spacing:2px;
}
header .subtitle{
  font-size:12px;
  color:#5a6080;
  margin-top:4px;
  letter-spacing:4px;
  text-transform:uppercase;
}
.grid{
  display:grid;
  grid-template-columns:repeat(2,1fr);
  gap:12px;
  margin:10px 0;
}
.card{
  background:linear-gradient(135deg, #0f1425 0%, #141a30 100%);
  border:1px solid #1e2540;
  border-radius:12px;
  padding:18px 16px;
  position:relative;
  overflow:hidden;
  transition:border-color .3s;
}
.card::before{
  content:'';
  position:absolute;
  top:0;left:0;right:0;
  height:2px;
}
.card:hover{border-color:#2d3560}
.card .label{
  font-size:11px;
  color:#6b7394;
  text-transform:uppercase;
  letter-spacing:1px;
  margin-bottom:6px;
}
.card .value{
  font-size:32px;
  font-weight:700;
  letter-spacing:1px;
}
.card .unit{
  font-size:13px;
  font-weight:400;
  opacity:.5;
  margin-left:4px;
}
.card.iq::before{background:linear-gradient(90deg,#7c8aff,#c084fc)}
.card.iq .value{color:#7c8aff}
.card.age::before{background:linear-gradient(90deg,#ffa502,#ff7f50)}
.card.age .value{color:#ffa502}
.card.solved::before{background:linear-gradient(90deg,#2ed573,#7bed9f)}
.card.solved .value{color:#2ed573}
.card.pool::before{background:linear-gradient(90deg,#4fc3f7,#00d2ff)}
.card.pool .value{color:#4fc3f7}
.progress-bar{
  margin-top:10px;
  height:4px;
  background:#1e2540;
  border-radius:2px;
  overflow:hidden;
}
.progress-bar .fill{
  height:100%;
  background:linear-gradient(90deg,#2ed573,#7bed9f);
  border-radius:2px;
  transition:width .6s ease;
}
.pool-detail{font-size:12px;color:#6b7394;margin-top:6px}
.fairies-card{
  background:linear-gradient(135deg, #0f1425 0%, #141a30 100%);
  border:1px solid #1e2540;
  border-radius:12px;
  padding:18px 16px;
  margin:12px 0;
}
.fairies-card .label{
  font-size:11px;
  color:#6b7394;
  text-transform:uppercase;
  letter-spacing:1px;
  margin-bottom:14px;
}
.fairy-row{
  display:flex;
  justify-content:center;
  gap:16px;
  flex-wrap:wrap;
}
.fairy{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:6px;
}
.fairy .dot{
  width:36px;height:36px;
  border-radius:50%;
  border:2px solid #1e2540;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:14px;
  transition:all .3s;
  background:#0f1425;
}
.fairy .dot.on{
  border-color:#2ed573;
  background:rgba(46,213,115,.15);
  box-shadow:0 0 12px rgba(46,213,115,.25);
  animation:pulse 2s infinite;
}
.fairy .dot.on::after{
  content:'';
  width:8px;height:8px;
  border-radius:50%;
  background:#2ed573;
}
.fairy .dot.off{
  border-color:#2d2040;
  color:#4a3a5a;
}
.fairy .name{
  font-size:11px;
  color:#6b7394;
  text-align:center;
}
.fairy .port{
  font-size:10px;
  color:#3a4060;
}
@keyframes pulse{
  0%,100%{box-shadow:0 0 12px rgba(46,213,115,.25)}
  50%{box-shadow:0 0 20px rgba(46,213,115,.45)}
}
.footer{
  text-align:center;
  padding:16px 0;
  font-size:11px;
  color:#3a4060;
}
.knowledge-card{
  background:linear-gradient(135deg, #0f1425 0%, #141a30 100%);
  border:1px solid #1e2540;
  border-radius:12px;
  padding:18px 16px;
  margin:12px 0;
}
.knowledge-card .label{
  font-size:11px;
  color:#6b7394;
  text-transform:uppercase;
  letter-spacing:1px;
  margin-bottom:10px;
}
.knowledge-bars{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.knowledge-bar{
  flex:1;min-width:60px;
  display:flex;flex-direction:column;align-items:center;gap:4px
}
.knowledge-bar .bar-track{
  width:100%;height:60px;background:#1a1f35;
  border-radius:6px 6px 0 0;overflow:hidden;
  display:flex;flex-direction:column-reverse
}
.knowledge-bar .bar-fill{border-radius:2px;transition:height .4s}
.bar-fill.math{background:linear-gradient(180deg,#7c8aff,#4a5adf)}
.bar-fill.logic{background:linear-gradient(180deg,#c084fc,#8b5cf6)}
.bar-fill.reason{background:linear-gradient(180deg,#2ed573,#1ea44f)}
.bar-fill.general{background:linear-gradient(180deg,#ffa502,#e08e00)}
.knowledge-bar .bar-label{font-size:10px;color:#5a6080;text-align:center}
.knowledge-bar .bar-count{font-size:14px;font-weight:700;color:#d0d4e0}
.knowledge-recent{font-size:11px;color:#6b7394;max-height:70px;overflow-y:auto}
.knowledge-recent .kr-item{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #15192e}
.knowledge-recent .kr-domain{
  font-size:9px;padding:1px 6px;border-radius:8px;margin-left:6px;white-space:nowrap
}
.kr-domain.math{background:rgba(124,138,255,.15);color:#7c8aff}
.kr-domain.logic{background:rgba(192,132,252,.15);color:#c084fc}
.kr-domain.code{background:rgba(255,107,122,.15);color:#ff6b7a}
.kr-domain.visual{background:rgba(79,195,247,.15);color:#4fc3f7}
.kr-domain.network{background:rgba(0,210,255,.15);color:#00d2ff}
.kr-domain.ai{background:rgba(124,138,255,.15);color:#7c8aff}
.kr-domain.solve{background:rgba(46,213,115,.15);color:#2ed573}
.kr-domain.general{background:rgba(255,165,2,.15);color:#ffa502}
.neural-card{
  background:linear-gradient(135deg, #0f1425 0%, #141a30 100%);
  border:1px solid #1e2540;
  border-radius:12px;
  padding:18px 16px;
  margin:12px 0;
}
.neural-card .label{
  font-size:11px;
  color:#6b7394;
  text-transform:uppercase;
  letter-spacing:1px;
  margin-bottom:10px;
}
.neural-stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.neural-stat{flex:1;min-width:70px;text-align:center}
.neural-stat .ns-val{font-size:18px;font-weight:700}
.neural-stat .ns-label{font-size:10px;color:#5a6080;margin-top:2px}
.ns-up{color:#2ed573}.ns-warn{color:#ffa502}.ns-info{color:#7c8aff}
.neural-chart{height:40px;background:#1a1f35;border-radius:6px;position:relative;overflow:hidden}
.neural-chart svg{width:100%;height:100%}
.bar-fill.code{background:linear-gradient(180deg,#ff6b7a,#d94a5a)}
.bar-fill.visual{background:linear-gradient(180deg,#4fc3f7,#0288d1)}
.bar-fill.network{background:linear-gradient(180deg,#00d2ff,#0091ea)}
.bar-fill.ai{background:linear-gradient(180deg,#c084fc,#7c4dff)}
.bar-fill.solve{background:linear-gradient(180deg,#2ed573,#1ea44f)}
.footer .dot-refresh{display:inline-block;width:6px;height:6px;border-radius:50%;background:#2ed573;margin-right:6px;animation:pulse 1.5s infinite}
.iq-badge{
  display:inline-block;
  font-size:12px;
  padding:2px 8px;
  border-radius:10px;
  margin-left:8px;
  font-weight:500;
}
.iq-badge.genius{background:rgba(124,138,255,.15);color:#c084fc}
.iq-badge.excellent{background:rgba(124,138,255,.15);color:#7c8aff}
.iq-badge.normal{background:rgba(100,120,160,.15);color:#7a8ab0}
.iq-badge.low{background:rgba(255,165,2,.1);color:#ffa502}
.iq-badge.poor{background:rgba(255,71,87,.1);color:#ff4757}
.btn-shutdown{
  background:rgba(255,71,87,.15);
  border:1px solid rgba(255,71,87,.4);
  color:#ff6b7a;
  padding:4px 12px;
  border-radius:6px;
  cursor:pointer;
  font-size:11px;
  letter-spacing:1px;
  transition:all .2s;
}
.btn-shutdown:hover{background:rgba(255,71,87,.3);color:#ff4757;border-color:#ff4757}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>OpenChat Bridge</h1>
  <div class="subtitle">Seven Fairies Dashboard</div>
</header>
<div class="grid">
  <div class="card iq"><div class="label">IQ</div><div class="value" id="v-iq">--<span class="iq-badge" id="b-iq"></span></div></div>
  <div class="card age"><div class="label">Age</div><div class="value" id="v-age">--<span class="unit">yrs</span></div></div>
  <div class="card solved"><div class="label">Solved</div><div class="value" id="v-solved">--</div></div>
  <div class="card pool"><div class="label">Problem Pool</div><div class="value" id="v-pool">--</div>
    <div class="progress-bar"><div class="fill" id="fill-bar" style="width:0%"></div></div>
    <div class="pool-detail" id="pool-detail"></div>
  </div>
</div>
<div class="fairies-card">
  <div class="label">Seven Fairies</div>
  <div class="fairy-row" id="fairy-row"></div>
</div>
<div class="knowledge-card">
  <div class="label">Knowledge · 知识档案 <span style=color:#7c8aff id=k-total></span></div>
  <div class="knowledge-bars" id="kb-bars"></div>
  <div class="knowledge-recent" id="kb-recent"></div>
</div>
<div class="neural-card">
  <div class="label">Neural Network · 神经网络</div>
  <div class="neural-stats" id="neural-stats"></div>
  <div class="neural-chart" id="neural-chart"></div>
</div>
<div class="neural-card">
  <div class="label">Domain Models · 领域分模型</div>
  <div class="knowledge-bars" id="models-bars"></div>
</div>
<div class="neural-card">
  <div class="label">Reasoning Chain · 推理链</div>
  <div class="neural-stats" id="chain-stats"></div>
</div>
<div class="footer"><span class="dot-refresh"></span>Live · Auto Refresh 3s &nbsp; <button class="btn-shutdown" onclick="S()">Shutdown All</button></div>
</div>
<script>
async function R(){
  try{
    const d=await(await fetch('/api/dashboard')).json();
    document.getElementById('v-iq').innerHTML=d.iq+B(d.iq);
    document.getElementById('v-age').innerHTML=d.age+'<span class=unit>yrs</span>';
    document.getElementById('v-solved').textContent=d.solved;
    document.getElementById('v-pool').textContent=d.poolSize;
    const pct=d.poolSize>0?Math.round(d.solved/d.poolSize*100):0;
    document.getElementById('fill-bar').style.width=pct+'%';
    document.getElementById('pool-detail').textContent='Pending: '+d.pending;
    if(d.fairies){
      const ports=Object.keys(d.fairies).sort((a,b)=>a-b);
      let fr='';
      for(const p of ports){
        const f=d.fairies[p];
        const on=f.alive;
        fr+='<div class=fairy data-port='+p+' onclick="K('+p+')"><div class="dot '+(on?'on':'off')+'"></div><div class=name>'+f.name+'</div><div class=port>:'+p+'</div></div>';
      }
      document.getElementById('fairy-row').innerHTML=fr;
    }
    if(d.knowledge){
      document.getElementById('k-total').textContent=d.knowledge.evoCount+'⧉'+d.knowledge.offlineCount;
      const domains=d.knowledge.domains||{};
      const max=Math.max(1,...Object.values(domains));
      const colors=['math','logic','code','visual','network','ai','general'];
      let bars='';
      for(const domain of colors){
        const cnt=domains[domain]||0;
        if(!cnt)continue;
        const pct=Math.round(cnt/max*100);
        const c=colors.includes(domain)?domain:'general';
        bars+='<div class=knowledge-bar><div class=bar-count>'+cnt+'</div><div class=bar-track><div class="bar-fill '+c+'" style=height:'+pct+'%></div></div><div class=bar-label>'+domain+'</div></div>';
      }
      document.getElementById('kb-bars').innerHTML=bars;
      const recents=d.knowledge.recent||[];
      let rec='';
      for(const r of recents){
        const t=new Date(r.solvedAt);
        const src=r.source==='evolution'?'<span style=color:#7c8aff;font-size:9px>🧠</span>':'<span style=color:#ffa502;font-size:9px>📋</span>';
        rec+='<div class=kr-item><span>'+src+' '+h(r.task,36)+'</span><span><span class="kr-domain '+r.domain+'">'+r.domain+'</span> '+fmt(t)+'</span></div>';
      }
      document.getElementById('kb-recent').innerHTML=rec;
    }
    if(d.neural){
      const n=d.neural;
      document.getElementById('neural-stats').innerHTML=
        '<div class=neural-stat><div class="ns-val ns-up">'+n.samples+'</div><div class=ns-label>Samples / 样本</div></div>'+
        '<div class=neural-stat><div class="ns-val '+(n.accNow>=60?'ns-up':'ns-warn')+'">'+n.accNow+'%</div><div class=ns-label>Accuracy / 准确率</div></div>'+
        '<div class=neural-stat><div class="ns-val ns-info">'+n.durH+'h</div><div class=ns-label>Training / 训练时长</div></div>'+
        '<div class=neural-stat><div class="ns-val ns-info">'+n.entries+'</div><div class=ns-label>Rounds / 轮次</div></div>'+
        (n.weightsSize?'<div class=neural-stat><div class="ns-val ns-info">'+(n.weightsSize/1024).toFixed(0)+'KB</div><div class=ns-label>Weights / 权重</div></div>':'');
      const t=n.trend||[];
      if(t.length>1){
        const maxA=Math.max(...t.map(p=>p.a));
        const minA=Math.min(...t.map(p=>p.a));
        const range=maxA-minA||1;
        let pts='';
        for(let i=0;i<t.length;i++){
          const x=i/(t.length-1)*100;
          const y=100-(t[i].a-minA)/range*90;
          pts+=x+','+y+' ';
        }
        document.getElementById('neural-chart').innerHTML='<svg viewBox="0 0 100 100" preserveAspectRatio=none><polyline points="'+pts+'" fill=none stroke=#7c8aff stroke-width=2 vector-effect=non-scaling-stroke></polyline></svg>';
      }
    }
    if(d.models&&d.models.domains){
      const dd=d.models.domains;
      const keys=Object.keys(dd).sort((a,b)=>dd[b].samples-dd[a].samples);
      const maxS=Math.max(1,...keys.map(k=>dd[k].samples));
      const colors={math:'math',logic:'logic',code:'code',visual:'visual',network:'network',ai:'ai',solve:'general',general:'general'};
      let bars='';
      for(const k of keys){
        if(!dd[k].samples&&!dd[k].hasModel)continue;
        const pct=Math.round(dd[k].samples/maxS*100);
        const c=colors[k]||'general';
        bars+='<div class=knowledge-bar><div class=bar-count>'+dd[k].samples+'</div><div class=bar-track><div class="bar-fill '+c+'" style=height:'+pct+'%></div></div><div class=bar-label>'+k+'</div></div>';
      }
      if(!bars)bars='<span style=font-size:11px;color:#5a6080>No domain models yet · 暂无领域模型</span>';
      document.getElementById('models-bars').innerHTML=bars;
    }
    if(d.chain){
      const c=d.chain;
      document.getElementById('chain-stats').innerHTML=
        '<div class=neural-stat><div class="ns-val ns-up">'+c.deductiveHits+'</div><div class=ns-label>Theorem Hits / 定理命中</div></div>'+
        '<div class=neural-stat><div class="ns-val '+(c.inductiveDiscoveries>0?'ns-up':'ns-info')+'">'+c.inductiveDiscoveries+'</div><div class=ns-label>Discovered / 归纳发现</div></div>'+
        '<div class=neural-stat><div class="ns-val ns-info">'+c.theoremCount+'</div><div class=ns-label>Theorem DB / 定理库</div></div>'+
        '<div class=neural-stat><div class="ns-val '+(c.hitRate>=50?'ns-up':'ns-warn')+'">'+c.hitRate+'%</div><div class=ns-label>Hit Rate / 命中率</div></div>'+
        (c.pendingCount?'<div class=neural-stat><div class="ns-val ns-warn">'+c.pendingCount+'</div><div class=ns-label>Pending / 待归纳</div></div>':'');
    }
  }catch(e){}
}
async function K(port){
  if(confirm('复活仙女 :'+port+' ?')){
    await fetch('/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'revive',port})});
    R();
  }
}
async function S(){
  if(!confirm('关闭所有 7 个 Bridge？'))return;
  document.querySelector('.btn-shutdown').disabled=true;
  document.querySelector('.btn-shutdown').textContent='Shutting down...';
  const d=await(await fetch('/api/dashboard')).json();
  const ports=Object.keys(d.fairies||{}).sort((a,b)=>a-b);
  for(const p of ports){
    try{await fetch('http://localhost:'+p+'/shutdown',{method:'POST'})}catch(e){}
  }
  await fetch('/shutdown',{method:'POST'}).catch(()=>{});
}
function B(iq){
  let cls,label;
  if(iq>=130){cls='genius';label='\u8d85\u5e38';}
  else if(iq>=110){cls='excellent';label='\u4f18\u79c0';}
  else if(iq>=90){cls='normal';label='\u6b63\u5e38';}
  else if(iq>=70){cls='low';label='\u504f\u4f4e';}
  else{cls='poor';label='\u4e0d\u8db3';}
  return ' <span class="iq-badge '+cls+'">'+label+'</span>';
}
function h(s,n){return s.length>n?s.slice(0,n)+'\u2026':s}
function fmt(d){const h=('0'+d.getHours()).slice(-2),m=('0'+d.getMinutes()).slice(-2);return h+':'+m}
R();setInterval(R,3000);
</script>
</body>
</html>`;
}
