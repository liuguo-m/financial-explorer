'use strict';
// Company details use the same stock API and metric definitions as industry view.
const companyView={code:null,group:null,epoch:0,shares:null,sharesRequest:null,
 metrics:new Set(['gross_margin','profit_amount','roe','revenue_amount','cashflow_amount','debt_ratio'])};
function companyPeers(){
 const inside=new Set((state.data?.stocks||[]).map(s=>s.code));
 return [...state.stocks.values()].filter(s=>inside.has(s.code)).sort(compareRoster);
}
function updateCompanyNav(){
 const peers=companyPeers(),index=peers.findIndex(s=>s.code===companyView.code);
 $('prevCompany').disabled=state.loading||index<=0;
 $('nextCompany').disabled=state.loading||!peers.length||index===peers.length-1;
 $('companyPosition').textContent=index<0?(companyView.code?'当前公司不在本行业 · 下一只返回行业名单':'点击下一只或右侧公司进入'):
  `行业内 ${index+1} / ${peers.length} · 按右侧排序，含未勾选个股`;
}
function moveCompany(offset){
 if(state.loading)return;
 const peers=companyPeers(),index=peers.findIndex(s=>s.code===companyView.code);
 const target=peers[index<0?0:index+offset];if(target)selectCompany(target);
}
function setCompanyMode(on){
 $('companyPanel').hidden=!on;document.querySelectorAll('.industry-panel').forEach(e=>e.hidden=on);
 $('industryView').setAttribute('aria-pressed',String(!on));$('singleView').setAttribute('aria-pressed',String(on));if(!on)draw();
}
$('industryView').onclick=()=>setCompanyMode(false);
$('singleView').onclick=()=>{setCompanyMode(true);if(!companyView.code)moveCompany(1);};
$('prevCompany').onclick=()=>moveCompany(-1);
$('nextCompany').onclick=()=>moveCompany(1);
function syncCompanyView(){
 if(companyView.group!==state.group){
  companyView.epoch++;companyView.code=null;companyView.group=state.group;
  $('companyDashboard').replaceChildren();$('companyShares').replaceChildren();
 }
 updateCompanyNav();
 if(companyView.code){const s=state.stocks.get(companyView.code);if(s&&!$('companyPanel').hidden)selectCompany(s);}else if(!$('companyPanel').hidden)moveCompany(1);
}
function companyElement(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function companyTable(head,rows){
 const wrap=companyElement('div',undefined,'company-table');const table=companyElement('table');
 const tr=companyElement('tr');for(const label of head)tr.append(companyElement('th',label));table.append(tr);
 for(const row of rows){const tr=companyElement('tr');for(const value of row)tr.append(companyElement('td',value));table.append(tr);}wrap.append(table);return wrap;
}
function miniChart(values,label,unitName,dateMode=false){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 460 190');svg.setAttribute('role','img');svg.setAttribute('aria-label',label+'历史趋势');
 const points=values.filter(v=>Number.isFinite(v[1]));
 if(!points.length)return companyElement('p','暂无有效数据','muted');
 const tx=v=>dateMode?Date.parse(v+'T00:00:00Z'):v;
 const minX=Math.min(...points.map(v=>tx(v[0]))),maxX=Math.max(...points.map(v=>tx(v[0])));
 let lo=Math.min(0,...points.map(v=>v[1])),hi=Math.max(0,...points.map(v=>v[1]));if(lo===hi)hi=lo+1;
 const labels=points.map(([,v])=>fmt(v,dateMode?4:2));
 const spacing=Math.max(56,...labels.map(s=>s.length*7+16));
 const times=points.map(p=>tx(p[0])),gaps=times.slice(1).map((t,i)=>t-times[i]).filter(g=>g>0);
 const span=Math.max(370,gaps.length?(maxX-minX)/Math.min(...gaps)*spacing:370),right=62+span,width=right+55;
 svg.setAttribute('viewBox',`0 0 ${width} 210`);svg.style.minWidth=width+'px';
 const x=t=>62+(tx(t)-minX)/(maxX-minX||1)*span,y=v=>165-(v-lo)/(hi-lo)*120;
 const element=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
 for(const v of [lo,(lo+hi)/2,hi]){element('line',{x1:62,x2:right,y1:y(v),y2:y(v),stroke:'#e0e8ee'});element('text',{x:57,y:y(v)+4,'text-anchor':'end','font-size':11,fill:'#63778a'},fmt(v,2));}
 element('text',{x:62,y:13,'font-size':11,fill:'#63778a'},unitName+' · 线性轴');
 let previous=null;
 for(const [t,v] of points){if(previous&&(dateMode||t===previous[0]+1))element('line',{x1:x(previous[0]),x2:x(t),y1:y(previous[1]),y2:y(v),stroke:'#2875aa','stroke-width':2});
  const dot=element('circle',{cx:x(t),cy:y(v),r:3,fill:'#2875aa'});const title=document.createElementNS(ns,'title');title.textContent=t+'：'+fmt(v,4)+unitName;dot.append(title);previous=[t,v];}
 points.forEach(([t,v],i)=>{
  element('text',{class:'point-value',x:x(t),y:y(v)-10,'text-anchor':'middle','font-size':12,'font-weight':600,fill:'#174b70',stroke:'white','stroke-width':3,'paint-order':'stroke'},labels[i]);
  element('text',{x:x(t),y:195,'text-anchor':'middle','font-size':10,fill:'#63778a'},String(t));
 });
 const wrap=companyElement('div',undefined,'company-chart-scroll');wrap.style.overflowX='auto';wrap.append(svg);
 return wrap;
}
async function showCompanyDashboard(stock){
 companyView.code=stock.code;companyView.group=state.group;const epoch=++companyView.epoch;updateCompanyNav();
 const box=$('companyDashboard');box.replaceChildren(companyElement('p','正在读取该公司各项财务指标…'));
 const controls=companyElement('div',undefined,'company-metrics');
 for(const [key,meta] of Object.entries(state.catalog.metrics)){
  const label=companyElement('label');const input=document.createElement('input');input.type='checkbox';input.checked=companyView.metrics.has(key);
  input.onchange=()=>{input.checked?companyView.metrics.add(key):companyView.metrics.delete(key);showCompanyDashboard(stock);};
  label.append(input,document.createTextNode(meta.name));controls.append(label);
 }
 const chosen=Object.keys(state.catalog.metrics).filter(key=>companyView.metrics.has(key));
 const results=await Promise.all(chosen.map(async key=>{try{return {key,data:await api('/api/stock',{code:stock.code,metric:key})};}catch(e){return {key,error:e.message};}}));
 if(epoch!==companyView.epoch)return;
 box.replaceChildren(controls);
 box.append(companyElement('p','曲线各点标注数值；年份较多时可左右滑动。各指标独立纵轴，金额单位为亿元；年报缺失断线，原值及缺失原因见下表。','muted'));
 const grid=companyElement('div',undefined,'company-grid'),allYears=new Set();
 for(const result of results){const meta=state.catalog.metrics[result.key],card=companyElement('section',undefined,'company-metric-card');card.append(companyElement('h4',meta.name));
  if(result.error){card.append(companyElement('p','读取失败：'+result.error));}else{
   card.append(miniChart(result.data.values,meta.name,meta.unit));
   for(const [year] of result.data.values)allYears.add(year);for(const year of Object.keys(result.data.notes||{}))allYears.add(+year);
  }card.append(companyElement('p',meta.note,'muted'));grid.append(card);
 }
 box.append(grid);
 if(chosen.length){const details=companyElement('details');details.append(companyElement('summary','查看同一股票各年指标数值'));details.open=true;
  const maps=results.map(r=>new Map(r.data?.values||[]));
  details.append(companyTable(['报告年度',...results.map(r=>state.catalog.metrics[r.key].name+'（'+state.catalog.metrics[r.key].unit+'）')],
   [...allYears].sort((a,b)=>b-a).map(year=>[year,...results.map((r,i)=>r.error?'读取失败':maps[i].has(year)?fmt(maps[i].get(year),2):(r.data.notes?.[year]||'暂无'))])));box.append(details);
 }else box.append(companyElement('p','请勾选要对比的指标。'));
}
async function showCompanyShares(stock){
 const box=$('companyShares');box.textContent='正在读取股本快照…';const code=stock.code;
 try{
  // Shares are an optional static snapshot; never fabricate history if absent.
  if(!companyView.shares){
   if(!companyView.sharesRequest)companyView.sharesRequest=fetch(new URL('data/share_history.json',document.baseURI)).then(response=>{if(!response.ok)throw Error('股本快照暂不可用');return response.json();}).catch(error=>{companyView.sharesRequest=null;throw error;});
   companyView.shares=await companyView.sharesRequest;
  }
  const data=companyView.shares;
  if(companyView.code!==code)return;
  box.replaceChildren(companyElement('h4','股本变化'),companyElement('p',data.note,'muted'));
  const history=data.stocks[code];if(!history){box.append(companyElement('p','本地暂无该公司的有效股本历史。'));return;}
  const grid=companyElement('div',undefined,'company-grid');
  for(const [key,name] of [['total_shares','总股本'],['float_shares','流通股本']]){
   const values=history[key]||[],card=companyElement('section',undefined,'company-metric-card');card.append(companyElement('h4',name),miniChart(values,name,'亿股',true));
   const rows=values.map(([day,value],i)=>[day,fmt(value,6),i?fmt(value-values[i-1][1],6):'—',i?fmt((value/values[i-1][1]-1)*100,2)+'%':'—']).reverse();
   const details=companyElement('details');details.open=true;details.append(companyElement('summary','股本数与相邻记录变化'),companyTable(['观测日期','亿股','变化（亿股）','变化率'],rows));card.append(details);grid.append(card);
  }box.append(grid);
 }catch(e){if(companyView.code===code)box.textContent='股本数据读取失败：'+e.message;}
}
