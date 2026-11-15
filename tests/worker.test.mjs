import worker, { movedHost, looksParked, pickExtras, buildDiscordPayload, ipRateLimited, resetReportLimits, cleanSuggestedUrl } from '../monitor-worker/worker.js';
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗ FAIL:',m)} };
const T0=Date.UTC(2026,10,13,3,0,0); let clock=T0;
Date.now=()=>clock;
const MIN=60000, DAY=86400000;

function setup(sites, opts={}){
  const kv=new Map(); const reads={n:0};
  const env={MONITOR_KV:{get:async(k,t)=>{reads.n++;const v=kv.get(k);return v==null?null:(t==='json'?JSON.parse(v):v)},put:async(k,v)=>{kv.set(k,v)},delete:async k=>{kv.delete(k)}},DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/1/x',...opts.env};
  const beh={}; sites.forEach(s=>beh[new URL(s.url).hostname]='up');
  const posts=[]; const calls={info:0,discord:0,probe:0,total:0};
  const infoState={fail:false,list:sites};
  globalThis.fetch=async(url,opt)=>{ calls.total++; url=String(url);
    if(url.includes('raw.githubusercontent.com')){calls.info++; if(infoState.fail) return new Response('x',{status:500}); return new Response(JSON.stringify(infoState.list),{status:200});}
    if(url.includes('discord.com')){calls.discord++; posts.push(JSON.parse(opt.body)); return new Response(null,{status:204});}
    calls.probe++; const h=new URL(url).hostname; const b=beh[h];
    if(typeof b==='function') return b();
    if(b==='up') return new Response('<html>hello</html>',{status:200});
    if(b==='down') return new Response('x',{status:503});
    if(b==='blocked') return new Response('no',{status:403});
    if(b==='dead') throw new Error('refused');
    throw new Error('?'+b);
  };
  return {kv,env,beh,posts,calls,infoState,reads,
    tick:async(adv=2*MIN,time)=>{clock+=adv; await worker.scheduled({scheduledTime:time||clock},env);},
    state:()=>JSON.parse(kv.get('state')), sites};
}
const mk=(i,extra={})=>({url:`https://s${i}.example/`,name:`Site ${i}`,section:'Misc',nsfw:false,...extra});
const H=i=>`s${i}.example`;

console.log('pure helpers');
ok(movedHost('http://a.com/','https://a.com/')===null,'http->https is not a move');
ok(movedHost('https://a.com/','https://www.a.com/x')===null,'www is not a move');
ok(movedHost('https://a.com/','https://app.a.com/')===null,'subdomain is not a move');
ok(movedHost('https://a.com/','https://b.net/')==='b.net','different domain is a move');
ok(movedHost('https://a.com/','https://accounts.google.com/x')===null,'login host ignored');
ok(movedHost('https://a.com/','/login?next=/')===null,'relative redirect ignored');
ok(looksParked('<h1>This domain is for sale</h1>',true),'parked phrase detected');
ok(!looksParked('This domain is for sale',false),'big page (incomplete read) never parked');

console.log('1. fast confirmation of a dead site');
{ const S=setup([mk(1),mk(2),mk(3)]); await S.tick();await S.tick();
  ok(S.posts.length===0,'no events while everything is up');
  S.beh[H(1)]='down'; const t0=clock; let n=0;
  while(!S.posts.length && n<30){await S.tick();n++}
  const mins=(clock-t0)/MIN;
  ok(S.posts.length===1 && /Went down/.test(S.posts[0].embeds[0].title),'down event posted');
  ok(mins<=12,`confirmed in ${mins} minutes (old worker: ~29 hours)`);
  ok(S.state().map[S.sites[0].url.replace(/^https?:\/\//,'').replace(/\/$/,'')].status==='down','state says down');
}
console.log('2. fast recovery of a confirmed-dead site');
{ const S=setup([mk(1),mk(2)]); await S.tick();await S.tick(); S.beh[H(1)]='down'; for(let i=0;i<8;i++) await S.tick();
  const before=S.posts.length; S.beh[H(1)]='up'; let t0=clock,n=0;
  while(S.posts.length===before && n<80){await S.tick();n++}
  const mins=(clock-t0)/MIN;
  ok(S.posts.length===before+1 && /Back online/.test(S.posts[before].embeds[0].title),'recovery event posted');
  ok(mins<=70,`recovery noticed after ${mins} minutes (old worker: up to ~10 hours)`);
}
console.log('3. blocked sites are never treated as dead');
{ const S=setup([mk(1),mk(2)]); await S.beh; S.beh[H(1)]='blocked';
  for(let d=0;d<30;d++){ for(let i=0;i<6;i++) await S.tick(); clock+=DAY; }
  const st=S.state(); const e=st.map['s1.example'];
  ok(e && e.status==='blocked','still tracked, status blocked after 30 days');
  ok(!e.deadSince,'no dead timer on a blocked site');
  ok(st.removed.length===0,'never queued for removal');
}
console.log('4. truly dead site is queued for removal after 21 days');
{ const S=setup([mk(1),mk(2)]); await S.tick(); await S.tick(); S.beh[H(1)]='dead';
  let removedAt=null; for(let d=0;d<30&&!removedAt;d++){ for(let i=0;i<4;i++) await S.tick(); if(S.state().removed.length) removedAt=d; clock+=DAY; }
  ok(removedAt!==null && removedAt>=20 && removedAt<=23,`removed after ~${removedAt} days`);
  ok(S.posts.some(p=>p.embeds.some(e=>/Dead for 21/.test(e.title))),'removal event posted');
}
console.log('5. parked domains');
{ const S=setup([mk(1),mk(2),mk(3)]); await S.tick();await S.tick();
  S.beh[H(1)]=()=>new Response('<html><h1>This domain is for sale!</h1></html>',{status:200});
  S.beh[H(2)]=()=>new Response('<html>'+'x'.repeat(20000)+' this domain is for sale</html>',{status:200});
  for(let i=0;i<12;i++) await S.tick();
  const st=S.state();
  ok(st.map['s1.example'].status==='down' && /parked/.test(st.map['s1.example'].detail),'tiny parking page -> down (parked)');
  ok(st.map['s2.example'].status==='up','large page that mentions the phrase stays up');
  ok(S.posts.some(p=>p.embeds[0].description.includes('parked domain')),'Discord says parked');
}
console.log('6. moved sites');
{ const S=setup([mk(1),mk(2),mk(3)]); await S.tick();await S.tick();
  S.beh[H(1)]=()=>new Response(null,{status:301,headers:{location:'https://newhome.net/'}});
  S.beh[H(2)]=()=>new Response(null,{status:301,headers:{location:'https://s2.example/home'}});
  S.beh[H(3)]=()=>new Response(null,{status:302,headers:{location:'https://accounts.google.com/login'}});
  for(let i=0;i<40;i++) await S.tick();
  const moved=S.posts.filter(p=>p.embeds.some(e=>/Moved/.test(e.title)));
  ok(moved.length===1,'exactly one "moved" post');
  ok(moved[0].embeds[0].description.includes('newhome.net') && !moved[0].embeds[0].description.includes('Site 2')&&!moved[0].embeds[0].description.includes('Site 3'),'only the real move is reported');
  ok(S.state().map['s1.example'].status==='up','moved site still counts as up');
}
console.log('7. orphan cleanup (and the safety guard)');
{ const S=setup([mk(1),mk(2),mk(3),mk(4)]); for(let i=0;i<4;i++) await S.tick();
  ok(Object.keys(S.state().map).length===4,'4 sites tracked');
  S.infoState.list=[mk(1),mk(2),mk(3)]; clock+=7*60*MIN; for(let i=0;i<3;i++) await S.tick();
  ok(!('s4.example' in S.state().map),'removed site\'s results dropped');
  const big=Array.from({length:200},(_,i)=>mk(i+10)); const S2=setup(big); for(let i=0;i<15;i++) await S2.tick();
  const n0=Object.keys(S2.state().map).length;
  S2.infoState.list=big.slice(0,20); clock+=7*60*MIN; await S2.tick();
  ok(Object.keys(S2.state().map).length>=n0-0 && n0>=100,'truncated list (10%) does NOT wipe history');
}
console.log('8. info.json failure handling + /health');
{ const S=setup([mk(1),mk(2)]); await S.tick(); S.infoState.fail=true; clock+=7*60*MIN;
  await S.tick(); const c1=S.calls.info; await S.tick(); await S.tick(); await S.tick();
  ok(S.calls.info-c1===0,'does not hammer GitHub: no retry within 10 minutes');
  let h=await worker.fetch(new Request('https://w/health'),S.env,{waitUntil(){}}); let b=await h.json();
  ok(h.status===503 && !b.ok && b.problems.some(p=>/info\.json/.test(p)),'/health reports the info.json problem');
  clock+=11*MIN; S.infoState.fail=false; await S.tick(); h=await worker.fetch(new Request('https://w/health'),S.env,{waitUntil(){}}); b=await h.json();
  ok(h.status===200 && b.ok,'/health recovers after a good fetch');
  ok(b.total===2 && b.version===3,'/health payload');
  // stale
  clock+=45*MIN; h=await worker.fetch(new Request('https://w/health'),S.env,{waitUntil(){}}); b=await h.json();
  ok(h.status===503 && b.problems.some(p=>/no check has finished/.test(p)),'/health flags a stalled worker');
  const s=await (await worker.fetch(new Request('https://w/summary'),S.env,{waitUntil(){}})).json();
  ok(s.stale===true,'/summary carries stale:true');
}
console.log('9. subrequest budget (free tier cap = 50)');
{ const many=Array.from({length:60},(_,i)=>mk(i)); const S=setup(many); many.forEach((s,i)=>S.beh[H(i)]='dead');
  let max=0; for(let i=0;i<12;i++){ S.calls.total=0; await S.tick(); max=Math.max(max,S.calls.total); }
  ok(max<=50,`worst tick used ${max} subrequests (limit 50)`);
  const S2=setup(many); await S2.tick(); S2.calls.total=0; many.forEach((s,i)=>S2.beh[H(i)]='dead'); clock+=7*60*MIN; S2.calls.total=0; await S2.tick(); 
  ok(S2.calls.total<=50,`tick with list refetch + retries used ${S2.calls.total}`);
}
console.log('10. sweep covers every site; cursor keeps moving with re-checks');
{ const many=Array.from({length:50},(_,i)=>mk(i)); const S=setup(many); S.beh[H(3)]='down'; S.beh[H(7)]='down';
  for(let i=0;i<14;i++) await S.tick(); const st=S.state();
  ok(Object.keys(st.map).length===50,'all 50 sites probed within 14 ticks');
}
console.log('11. /status edge cache ignores ?_= cache-busters');
{ const S=setup([mk(1),mk(2)]); await S.tick(); const store=new Map();
  globalThis.caches={default:{match:async k=>store.get(k.url)?.clone(),put:async(k,r)=>{store.set(k.url,r)}}};
  const ctx={waitUntil:p=>p}; const r0=S.reads.n;
  const a=await worker.fetch(new Request('https://w/status?_=111'),S.env,ctx); await new Promise(r=>setTimeout(r,10));
  const mid=S.reads.n; const b=await worker.fetch(new Request('https://w/status?_=222'),S.env,ctx);
  ok(a.status===200 && (await b.json()).total===2,'both requests answer');
  ok(S.reads.n===mid && mid>r0,'second request served from cache (no KV reads)');
  ok(/max-age=60/.test(a.headers.get('cache-control')||''),'cache-control: 60s');
  ok(a.headers.get('access-control-allow-origin')==='*','CORS kept');
  delete globalThis.caches;
}
console.log('12. pickExtras limits');
{ const map={},sites=new Map(); for(let i=0;i<30;i++){const s=mk(i);s.slug=`s${i}.example`;sites.set(s.slug,s);map[s.slug]={status:i<15?'up':'down',streak:i<15?1:5,checkedAt:new Date(clock-3*60*MIN).toISOString()}}
  const ex=pickExtras(map,sites,clock); ok(ex.length===8,'max 5 re-checks + 3 recovery probes = 8'); }
console.log('13. old fast path still safe: single failure never alerts');
{ const S=setup([mk(1),mk(2)]); await S.tick();await S.tick(); let flip=0; S.beh[H(1)]=()=>{flip++; return flip===1?new Response('x',{status:503}):new Response('ok',{status:200})};
  for(let i=0;i<10;i++) await S.tick(); ok(S.posts.length===0,'one blip -> no alert'); }

console.log('14. visitor reports (POST /report)');
{ const S=setup([mk(1),mk(2),{...mk(3),nsfw:true,name:'Adult Three'}]); await S.tick(); resetReportLimits();
  const post=(body,hdr={})=>worker.fetch(new Request('https://w/report',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':hdr.ip||'1.1.1.1',...(hdr.origin?{origin:hdr.origin}:{})},body:typeof body==='string'?body:JSON.stringify(body)}),S.env,{waitUntil(){}});
  S.posts.length=0;
  let r=await post({url:'https://s1.example/',reason:'down',note:'dead for days [click](http://x) @everyone'});
  let j=await r.json(); ok(r.status===200&&j.ok,'valid report accepted');
  ok(S.posts.length===1 && S.posts[0].embeds[0].title.includes('Broken or down'),'posted to Discord');
  ok(S.posts[0].allowed_mentions.parse.length===0 && !JSON.stringify(S.posts[0]).includes('](http://x)'),'note is sanitised, no pings');
  ok(JSON.stringify(S.posts[0]).includes('Site 1'),'includes site name');
  r=await post({url:'https://nope.example/',reason:'down'}); ok(r.status===400,'unknown site refused');
  r=await post({url:'https://s1.example/',reason:'bogus'}); ok(r.status===400,'bad reason refused');
  const n=S.posts.length; r=await post({url:'https://s1.example/',reason:'down',website:'spam'}); ok(r.status===200&&S.posts.length===n,'honeypot: silent, nothing posted');
  r=await post('{not json'); ok(r.status===400,'bad JSON refused');
  r=await post({url:'https://s1.example/',reason:'down',note:'x'.repeat(3000)}); ok(r.status===413,'oversized body refused');
  S.env.ALLOWED_ORIGINS='https://mysite.com'; r=await post({url:'https://s1.example/',reason:'down'},{origin:'https://evil.com',ip:'9.9.9.9'}); ok(r.status===403,'wrong origin refused');
  r=await post({url:'https://s1.example/',reason:'down'},{origin:'https://mysite.com',ip:'9.9.9.9'}); ok(r.status===200,'allowed origin accepted'); delete S.env.ALLOWED_ORIGINS;
  resetReportLimits(); const codes=[]; for(let i=0;i<5;i++) codes.push((await post({url:'https://s2.example/',reason:'other'},{ip:'5.5.5.5'})).status);
  ok(codes.slice(0,3).every(c=>c===200)&&codes[3]===429,'4th report from one IP in 10 minutes -> 429 ('+codes.join(',')+')');
  S.posts.length=0; await post({url:'https://s3.example/',reason:'scam'},{ip:'6.6.6.6'});
  ok(S.posts.length===1 && !JSON.stringify(S.posts[0]).includes('Adult Three') && JSON.stringify(S.posts[0]).includes('Adult site'),'adult site name hidden in the report');
  resetReportLimits(); const day=new Date(clock).toISOString().slice(0,10); S.kv.set('rpt:'+day,'100'); r=await post({url:'https://s1.example/',reason:'down'},{ip:'7.7.7.7'}); ok(r.status===429,'daily cap of 100 reached -> 429');
  delete S.env.DISCORD_WEBHOOK_URL; r=await post({url:'https://s1.example/',reason:'down'},{ip:'8.8.8.8'}); ok(r.status===503,'no webhook configured -> 503 (page falls back to Discord ticket)');
  S.env.DISCORD_WEBHOOK_URL_ALERTS='https://discord.com/api/webhooks/2/alerts'; S.kv.delete('rpt:'+day); S.posts.length=0; r=await post({url:'https://s1.example/',reason:'down'},{ip:'4.4.4.4'}); ok(r.status===200,'alerts webhook alone is enough');
  const pre=await worker.fetch(new Request('https://w/report',{method:'OPTIONS'}),S.env,{}); ok(/POST/.test(pre.headers.get('access-control-allow-methods')),'CORS preflight allows POST');
}

console.log('15. suggest a site (POST /suggest)');
{ const S=setup([{url:'https://listed.com/',name:'Listed',section:'Misc',nsfw:false},{url:'https://www.other.org/',name:'Other',section:'Misc',nsfw:false}]); await S.tick(); resetReportLimits();
  const post=(body,ip='1.1.1.1')=>worker.fetch(new Request('https://w/suggest',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':ip},body:typeof body==='string'?body:JSON.stringify(body)}),S.env,{waitUntil(){}});
  S.posts.length=0;
  let r=await post({url:'https://coolnewsite.org/path',name:'Cool *New* [Site](http://x) @everyone',section:'Anime',note:'great `site`'}); let j=await r.json();
  ok(r.status===200&&j.ok&&!j.exists,'valid suggestion accepted');
  const sent=JSON.stringify(S.posts[0]);
  ok(S.posts.length===1&&sent.includes('Site suggestion')&&sent.includes('coolnewsite.org/path'),'posted to Discord');
  ok(S.posts[0].embeds[0].description.startsWith('`')&&!/\]\(http/.test(sent)&&S.posts[0].allowed_mentions.parse.length===0,'address shown as code (not clickable), text sanitised, no pings');
  S.posts.length=0; r=await post({url:'listed.com'}); j=await r.json(); ok(j.ok&&j.exists&&S.posts.length===0,'already-listed site: told so, nothing posted (also without https://)');
  r=await post({url:'www.listed.com/'}); j=await r.json(); ok(j.exists,'www. variant counts as listed');
  for(const bad of ['javascript:alert(1)','http://localhost/','http://127.0.0.1/','http://192.168.0.1/','https://user:pw@evil.com/','not a url','ftp://x.com/','https://[::1]/','https://nodot/','https://a.b.invalid/','https://x.com/`oops`']){
    const rr=await post({url:bad},'2.2.2.2'); if(rr.status!==400){ ok(false,'should refuse '+bad); } }
  ok(true,'unsafe or private addresses refused');
  resetReportLimits(); S.posts.length=0; const n=S.posts.length; r=await post({url:'https://x.org/',website:'bot'}); ok(r.status===200&&S.posts.length===n,'honeypot silent');
  resetReportLimits(); const codes=[]; for(let i=0;i<5;i++) codes.push((await post({url:`https://new${i}.org/`},'5.5.5.5')).status);
  ok(codes[3]===429&&codes[0]===200,'4th suggestion from one IP -> 429 ('+codes.join(',')+')');
  resetReportLimits(); const day=new Date(clock).toISOString().slice(0,10); S.kv.set('sug:'+day,'50'); r=await post({url:'https://brandnew.org/'},'6.6.6.6'); ok(r.status===429,'daily cap of 50 -> 429');
  ok(cleanSuggestedUrl('Cool-Site.com/Path#frag')==='https://cool-site.com/Path' && cleanSuggestedUrl('foo.test')===null && cleanSuggestedUrl('other.org')!==null,'URL cleaning: lowercases host, drops #fragment, refuses reserved names');
  r=await post({url:'other.org'},'3.3.3.3'); j=await r.json(); ok(j.exists,'listed with www. in the list, suggested without it -> already listed');
}

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
