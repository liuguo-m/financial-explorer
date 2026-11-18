'use strict';
const commodityState={items:[],selected:null,cache:new Map(),request:0};
const el=id=>document.getElementById(id);
const fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('zh-CN',{maximumFractionDigits:d}):'—';
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function percent(w){return w?.complete?fmt(w.percentile,1)+'%':'覆盖不足';}
function link(text,url){const a=node('a',text);a.href=url;return a;}
async function readJSON(url){const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw Error('读取失败 '+r.status);return r.json();}
function list(){
 const q=el('searchCommodity').value.trim().toLowerCase(),only=el('onlyAttention').checked;
 const items=commodityState.items.filter(x=>(x.name+x.symbol).toLowerCase().includes(q)&&(!only||x.attention));
 el('commodityRows').replaceChildren();el('empty').hidden=items.length>0;
 for(const x of items){const tr=node('tr');tr.classList.toggle('selected',commodityState.selected===x.id);
  const title=node('td'),button=node('button',x.name);button.onclick=()=>select(x.id);title.append(button,node('small',x.basis+' · '+x.frequency));tr.append(title);
  const price=node('td',fmt(x.price)+' '+x.unit);price.append(node('small',x.latest_date||'暂无数据'));tr.append(price);
  for(const y of [1,5,10]){const w=x.windows?.[y];tr.append(node('td',percent(w),w?.complete&&w.percentile<=10?'low-rank':''));}
  tr.append(node('td',x.error?'检查失败，保留历史':x.stale?'数据过期':x.attention?'关注：三周期低位':'未满足关注条件',x.error||x.stale?'commodity-error':''));el('commodityRows').append(tr);
 }
}
async function select(id){
 const ticket=++commodityState.request,x=commodityState.items.find(i=>i.id===id);commodityState.selected=id;list();
 el('chartTitle').textContent=x.name+' · 价格历史';el('basis').replaceChildren(document.createTextNode(`${x.basis}｜${x.frequency}｜${x.first_date||'—'} 至 ${x.latest_date||'—'}｜${x.count} 条｜`),link('数据来源',x.source_url),document.createTextNode(x.history_note?' ｜'+x.history_note:''));
 el('hints').replaceChildren(...x.hints.map(h=>node('div',`${h.direction}：${h.target}。${h.note}`,'hint-row')));
 el('related').replaceChildren();for(const r of x.related||[]){const p=node('p');p.append(link(`${r.name} ${r.code}`,`./index.html?stock=${encodeURIComponent(r.code)}`),document.createTextNode(`${r.direction}：${r.note} `),link('业务依据',r.source),document.createTextNode(' 核对：'+r.reviewed));el('related').append(p);}
 el('windowStats').replaceChildren(...[1,5,10].map(y=>{const w=x.windows?.[y];const box=node('div',undefined,'window-stat');box.append(node('strong',`${y}年：${percent(w)}`),node('p',w?`区间位置 ${fmt(w.position,1)}% · ${w.samples} 个样本`:'暂无数据'),node('small',w?`最低 ${fmt(w.min)} / 最高 ${fmt(w.max)} ${x.unit}`:''));return box;}));
 el('chart').textContent='加载历史…';el('chartReadout').textContent='移动或点按曲线查看价格。';
 try{if(!commodityState.cache.has(id))commodityState.cache.set(id,await readJSON(`./data/commodity_${id}.json`));if(ticket===commodityState.request)draw(x);}catch(e){if(ticket===commodityState.request)el('chart').textContent=e.message;}
}
function draw(item){
 const data=commodityState.cache.get(item.id).rows;const period=el('chartWindow').value;const end=new Date(data.at(-1)[0]+'T00:00:00Z'),cutoff=new Date(end);if(period!=='all')cutoff.setUTCFullYear(end.getUTCFullYear()-Number(period));
 const rows=period==='all'?data:data.filter(r=>new Date(r[0]+'T00:00:00Z')>=cutoff);
 const W=Math.max(320,el('chart').clientWidth),H=W<600?250:280,left=65,right=20,top=24,bottom=45,prices=rows.map(r=>r[1]);let lo=Math.min(...prices),hi=Math.max(...prices),pad=(hi-lo)*.08||1;lo-=pad;hi+=pad;
 const first=Date.parse(rows[0][0]),last=Date.parse(rows.at(-1)[0]),px=d=>left+(Date.parse(d)-first)/(last-first||1)*(W-left-right),py=v=>top+(hi-v)/(hi-lo)*(H-top-bottom);
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',item.name+'历史价格曲线');
 function add(tag,attrs,text){const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n;}
 for(let j=0;j<5;j++){const v=lo+(hi-lo)*j/4,y=py(v);add('line',{x1:left,x2:W-right,y1:y,y2:y,stroke:'#dfe7ef'});add('text',{x:left-8,y:y+4,'text-anchor':'end','font-size':12,fill:'#526578'},fmt(v));}
 add('path',{d:rows.map((r,i)=>`${i&&(Date.parse(r[0])-Date.parse(rows[i-1][0]))/86400000<=item.max_gap_days?'L':'M'}${px(r[0]).toFixed(2)},${py(r[1]).toFixed(2)}`).join(' '),fill:'none',stroke:'#24718b','stroke-width':2});
 const w=item.windows?.[period];if(w?.complete){const sorted=[...prices].sort((a,b)=>a-b),p=sorted[Math.floor((sorted.length-1)*.1)];add('line',{x1:left,x2:W-right,y1:py(p),y2:py(p),stroke:'#14957d','stroke-dasharray':'6 4'});add('text',{x:left+6,y:py(p)-7,'font-size':12,fill:'#087e68',stroke:'white','stroke-width':3,'paint-order':'stroke'},'10%分位参考价 '+fmt(p));}
 const ticks=W<600?2:4;for(let i=0;i<=ticks;i++){const r=rows[Math.round((rows.length-1)*i/ticks)];add('text',{x:px(r[0]),y:H-13,'text-anchor':i===0?'start':i===ticks?'end':'middle','font-size':12,fill:'#526578'},r[0]);}
 const latest=rows.at(-1);add('circle',{cx:px(latest[0]),cy:py(latest[1]),r:4,fill:'#bd6829'});add('text',{x:W-right-5,y:Math.max(15,py(latest[1])-9),'text-anchor':'end','font-size':13,fill:'#a54f12'},fmt(latest[1]));
 const cursor=add('line',{x1:left,x2:left,y1:top,y2:H-bottom,stroke:'#9b743f',visibility:'hidden'});
 svg.addEventListener('pointermove',e=>{const rect=svg.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*W;let best=rows[0];for(const r of rows)if(Math.abs(px(r[0])-x)<Math.abs(px(best[0])-x))best=r;cursor.setAttribute('x1',px(best[0]));cursor.setAttribute('x2',px(best[0]));cursor.setAttribute('visibility','visible');el('chartReadout').textContent=`${best[0]} · ${item.name} ${fmt(best[1])} ${item.unit}`;});
 el('chart').replaceChildren(svg);
}
async function init(){try{const data=await readJSON('./data/commodities.json');commodityState.items=data.items;for(const x of data.items){const age=(Date.now()-Date.parse(x.latest_date+'T00:00:00+08:00'))/86400000;if(!Number.isFinite(age)||age>x.stale_days+1){x.stale=true;x.attention=false;}}el('updated').textContent='最近检查：'+new Date(data.checked_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'（北京时间）。工作日18:00自动检查；行情日期见下表。';const hits=data.items.filter(x=>x.attention);el('alerts').replaceChildren();if(!hits.length)el('alerts').textContent='当前没有同时满足三周期低位条件的品种。';for(const x of hits){const b=node('button',x.name+' · 关注','attention-chip');b.onclick=()=>select(x.id);el('alerts').append(b);}list();if(data.items.length)await select(hits[0]?.id||data.items[0].id);}catch(e){el('alerts').textContent='商品数据加载失败：'+e.message;}}
el('searchCommodity').oninput=list;el('onlyAttention').onchange=list;el('chartWindow').onchange=()=>{const x=commodityState.items.find(i=>i.id===commodityState.selected);if(x&&commodityState.cache.has(x.id))draw(x);};init();

window.addEventListener('resize',()=>{const x=commodityState.items.find(i=>i.id===commodityState.selected);if(x&&commodityState.cache.has(x.id))draw(x);});
