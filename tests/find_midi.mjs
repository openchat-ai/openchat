import https from 'https';
https.get('https://www.midishow.com/en/midi/hotel-california-midi-download-136021',{timeout:10000},r=>{
  let d='';
  r.on('data',c=>d+=c);
  r.on('end',()=>{
    const patterns=[/data-url=["']([^"']+)["']/g,/data-file=["']([^"']+)["']/g,/data-midi=["']([^"']+)["']/g];
    for(const p of patterns){
      const matches=[...d.matchAll(p)];
      for(const m of matches) console.log('Found:',m[1]);
    }
    const dl=d.match(/download[^}]+url\s*:\s*["']([^"']+)["']/);
    if(dl) console.log('URL pattern:',dl[1]);
    const action=d.match(/action=["']([^"']+)["']/g);
    if(action) action.forEach(a=>console.log('Action:',a));
  });
}).on('error',e=>console.log('Err:',e.message));
