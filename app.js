'use strict';
const $=id=>document.getElementById(id);
const state={catalog:null,data:null,stocks:new Map(),hover:null,pinned:null,geometry:[],request:0,profileRequest:0,group:'',metric:'roe',loading:false};
state.excluded=new Set();state.visible=new Set();state.screening=new Map();
const filterIds=['minValue','maxValue','minMedian','maxMedian'];
function evaluateStock(values,from,to,bounds){
 const a=values.filter(([y,v])=>y>=from&&y<=to&&Number.isFinite(v)).map(v=>v[1]).sort((a,b)=>a-b);
 if(!a.length)return {pass:false,n:0,reason:'所选年份无有效数据'};
 const n=a.length,min=a[0],max=a[n-1],median=(a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2;
 const reasons=[];
 if(bounds.minValue!==null&&min<bounds.minValue)reasons.push('年度最低值低于下限');
 if(bounds.maxValue!==null&&max>bounds.maxValue)reasons.push('年度最高值高于上限');
 if(bounds.minMedian!==null&&median<bounds.minMedian)reasons.push('中位数低于下限');
 if(bounds.maxMedian!==null&&median>bounds.maxMedian)reasons.push('中位数高于上限');
 return {pass:!reasons.length,n,min,max,median,reason:reasons.join('；')};
}
function clearFilterInputs(){for(const id of filterIds)$(id).value='';}
function refreshVisibility(){
 const bounds=Object.fromEntries(filterIds.map(id=>[id,$(id).value.trim()===''?null:Number($(id).value)]));
 const invalid=filterIds.some(id=>$(id).validity.badInput||(bounds[id]!==null&&!Number.isFinite(bounds[id])))||
  [['minValue','maxValue'],['minMedian','maxMedian']].some(([a,b])=>bounds[a]!==null&&bounds[b]!==null&&bounds[a]>bounds[b]);
 state.visible=new Set();state.screening=new Map();let eligible=0;
 for(const s of state.stocks.values()){
  const result=evaluateStock(s.values,+$('from').value,+$('to').value,bounds);
  if(invalid){result.pass=false;result.reason='筛选条件无效：请检查上下限';}
  state.screening.set(s.code,result);
  if(result.pass){eligible++;if(!state.excluded.has(s.code))state.visible.add(s.code);}
 }
 if(!state.visible.has(state.hover))state.hover=null;
 $('tooltip').hidden=true;
 $('filterSummary').textContent=invalid?'筛选条件无效：请输入有效数字，且下限不能高于上限。':
  `${$('from').value}—${$('to').value} 年 · 单位 ${unit()} · 达标 ${eligible} / ${state.stocks.size} 只，已勾选 ${state.visible.size} 只。仅统计有效年报，缺失不填零；行业中位数及重点名单保持原行业口径。`;
}
function refreshSelection(){if(!state.data)return;renderRoster();draw();}
for(const id of filterIds)$(id).oninput=refreshSelection;
$('resetFilters').onclick=()=>{clearFilterInputs();refreshSelection();};
const metricInfo=()=>state.catalog?.metrics[state.metric]||{name:'ROE',unit:'%'};
const metricName=()=>metricInfo().name;
const unit=()=>metricInfo().unit;
const valueText=v=>fmt(v,2)+unit();
const fmt=(v,n=1)=>v==null?'暂无':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:n,minimumFractionDigits:n});
const cap=s=>s.cap_yi==null?'市值缺失':`${fmt(s.cap_yi)} 亿 · ${s.cap_date||'日期缺失'}`;
async function api(path,params={}){return staticApi(path,params);}

function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
function childOptions(level,parent){const el=$('l'+level);el.replaceChildren();option(el,'',`全部${level===2?'二':'三'}级（查看${level===2?'一':'二'}级）`);state.catalog.groups.filter(g=>g.level===level&&g.parent===parent).forEach(g=>option(el,g.id,g.name));el.disabled=!parent;}
function groupId(){return $('l3').value||$('l2').value||$('l1').value;}
function industryNeighbors(){
 const current=state.catalog?.groups.find(g=>g.id===groupId());
 const peers=current?state.catalog.groups.filter(g=>g.level===current.level):[];
 return {current,peers,index:peers.findIndex(g=>g.id===current?.id)};
}
function updateIndustryNav(){
 const {current,peers,index}=industryNeighbors();
 $('industryPosition').textContent=current?`申万${['','一','二','三'][current.level]}级 · ${index+1} / ${peers.length}`:'';
 for(const [id,offset] of [['prevIndustry',-1],['nextIndustry',1]]){
  const target=peers[index+offset];
  $(id).disabled=state.loading||!current||!target;
  $(id).title=target?target.id:'已到本级行业边界';
 }
}
function switchIndustry(offset){
 if(state.loading)return;
 const {peers,index}=industryNeighbors(),target=peers[index+offset];
 if(!target)return;
 const parts=target.id.split('/');
 $('l1').value=parts[0];childOptions(2,parts[0]);
 $('l2').value=target.level>=2?parts.slice(0,2).join('/'):'';
 childOptions(3,$('l2').value);
 $('l3').value=target.level===3?target.id:'';
 load();
}
$('prevIndustry').onclick=()=>switchIndustry(-1);
$('nextIndustry').onclick=()=>switchIndustry(1);
function tags(code){if(!state.data)return '';const s=state.data.selection;return [s.best_code===code?s.best_status:'',s.top3_codes.includes(code)?'市值第'+(s.top3_codes.indexOf(code)+1):''].filter(Boolean).join(' / ');}
function important(code){return !!tags(code);}
function color(code){const s=state.data.selection;if(code===s.best_code)return '#db6b20';const k=s.top3_codes.indexOf(code);if(k>=0)return ['#236dce','#9852ad','#219a83'][k];let n=0;for(const c of code)n=(n*31+c.charCodeAt(0))>>>0;return `hsl(${n%360} 45% 48%)`;}
function message(text){$('status').textContent=text;}
async function load(preserve=false){
 const token=++state.request;state.loading=true;const codes=preserve&&groupId()===state.group?[...state.stocks.keys()]:null;
 updateIndustryNav();
 const metric=$('metric').value,group=groupId();message('正在读取年报、计算行业重点…');
 try{const data=await api('/api/chart',{group,metric});
  let stocks=data.stocks;if(codes){const inside=new Map(stocks.map(s=>[s.code,s]));stocks=await Promise.all(codes.map(c=>inside.get(c)||api('/api/stock',{code:c,metric})));}
  if(token!==state.request)return;if(state.metric!==metric)clearFilterInputs();if(!codes)state.excluded=new Set();state.metric=metric;state.group=group;state.data=data;state.stocks=new Map(stocks.map(s=>[s.code,s]));state.hover=null;state.pinned=null;state.profileRequest++;
  $('companyTitle').textContent='公司档案';$('companyMeta').textContent='悬停曲线预览，点击曲线或右侧公司名称查看主营业务。';$('business').replaceChildren();$('annual').replaceChildren();
  const name=state.catalog.groups.find(g=>g.id===group);$('title').textContent=`${name.name} · 年报${metricName()}`;
  $('subtitle').textContent=`申万${['','一','二','三'][name.level]}级 · ${group} · 行业有效样本 ${data.stocks.filter(s=>s.values.length).length} 只`;
  const end=state.catalog.last_year;$('method').textContent=`优选按 ${end-6}—${end} 年计算：至少5个有效年报，最新年指标、归母净利润、净资产均为正，非ST、非退市，且有基准日市值。在所选行业内评分：指标中位数50%＋低四分位距25%＋最新年指标15%＋正值年份比例10%。同分依次比较中位数、样本量、市值和代码。不满足完整条件时明确标为观察候选。该优选仅代表此指标的水平与稳定性，未评估买入估值。`;
  if(metric==='debt_ratio')$('method').textContent=`低负债优选按 ${end-6}—${end} 年计算：至少5个非负有效年报，最新年资产负债率低于100%、归母净利润和净资产为正，非ST、非退市且有基准日市值。同业评分：较低资产负债率中位数50%＋低四分位距25%＋较低最新年负债率15%＋负债率低于100%的年份比例10%。零负债率有效；负值保留绘图但不参与优选。条件不足标为观察候选。图表与详情均显示原始资产负债率，不对数值取反。低负债仅反映此指标，不能单独判定公司最优，银行等金融行业需结合业务模式解读。`;
  if(data.reference_selection)$('method').textContent='本指标不按越高越好或越低越好评选公司。橙色曲线为有本指标数据样本中的ROE参考优选，沿用近7年ROE水平、稳定性、最新值和盈利状态规则；并非当前指标最优。市值前三仍按当前指标有效样本计算。';
  $('method').textContent+=' '+metricInfo().note;
  $('metricNote').textContent=metricInfo().note+(metricInfo().records===0?' 当前数据库暂无该指标有效数据。':'');
  renderPicks();years(false);renderRoster();draw();message('就绪 · 悬停曲线加粗高亮，点击查看主营业务；右侧勾选控制曲线显示。');
 }catch(e){if(token===state.request)message('读取失败：'+e.message);}finally{if(token===state.request){state.loading=false;updateIndustryNav();}}
}
function renderPicks(){const box=$('picks');box.replaceChildren();const sel=state.data.selection;for(const c of [...new Set([sel.best_code,...sel.top3_codes].filter(Boolean))]){const s=state.data.stocks.find(x=>x.code===c);const b=document.createElement('button');b.className='pick';b.style.borderLeft=`4px solid ${color(c)}`;b.textContent=`${tags(c)} · ${s.name} ${c} · ${cap(s)}`;b.onclick=()=>selectCompany(s);box.append(b);}if(!sel.best_code){const p=document.createElement('p');p.textContent=sel.best_status;box.append(p);}if(state.data.reason){const p=document.createElement('p');p.className='muted';p.textContent=`当前指标样本 ${state.data.reason.n} 年 · 中位数 ${valueText(state.data.reason.median)} · 四分位距 ${fmt(state.data.reason.iqr,2)} ${unit()==='%'?'个百分点':unit()}`;box.append(p);}}
function years(keep=true){let all=[...state.stocks.values()].flatMap(s=>s.values.map(v=>v[0])).concat(state.data.median.map(v=>v[0]));if(!all.length)all=[state.catalog.last_year];const lo=Math.min(...all),hi=Math.max(...all);const oldFrom=+$('from').value,oldTo=+$('to').value;for(const id of ['from','to']){$(id).replaceChildren();for(let y=lo;y<=hi;y++)option($(id),y,y);}$('from').value=keep&&oldFrom>=lo&&oldFrom<=hi?oldFrom:lo;$('to').value=keep&&oldTo>=lo&&oldTo<=hi?oldTo:hi;}
function compareRoster(a,b){
 const descending=(x,y)=>Number.isFinite(x)?(Number.isFinite(y)?y-x:-1):(Number.isFinite(y)?1:0);
 const mode=$('stockSort').value;
 const stat=mode==='min'?'min':mode==='median'?'median':null;
 const metricOrder=stat?descending(state.screening.get(a.code)?.[stat],state.screening.get(b.code)?.[stat]):0;
 return metricOrder||descending(a.cap_yi,b.cap_yi)||a.code.localeCompare(b.code);
}
$('stockSort').onchange=()=>{if(state.data)renderRoster();};
function renderRoster(){refreshVisibility();const box=$('roster');box.replaceChildren();const list=[...state.stocks.values()].sort(compareRoster);$('count').textContent=`${state.visible.size} / ${list.length} 只`;
 for(const s of list){const result=state.screening.get(s.code);const row=document.createElement('div');row.className='stock'+(result.pass?'':' filtered');row.dataset.code=s.code;row.style.borderLeftColor=color(s.code);
 const check=document.createElement('input');check.type='checkbox';check.checked=state.visible.has(s.code);check.disabled=!result.pass;check.setAttribute('aria-label','显示 '+s.name+' '+s.code);check.title=result.pass?'勾选显示，取消隐藏':result.reason;
 check.onchange=()=>{if(check.checked)state.excluded.delete(s.code);else state.excluded.add(s.code);refreshSelection();};
 const b=document.createElement('button');b.className='name';b.append(document.createTextNode(`${s.name} ${s.code}`));const sub=document.createElement('small');sub.textContent=cap(s);const tag=document.createElement('small');tag.textContent=tags(s.code);b.append(sub,tag);
 const stats=document.createElement('small');stats.textContent=result.n?`有效${result.n}年 · 最低 ${fmt(result.min,2)} · 中位 ${fmt(result.median,2)} · 最高 ${fmt(result.max,2)} ${unit()}`:result.reason;b.append(stats);
 if(result.n&&!result.pass){const why=document.createElement('small');why.className='filter-reason';why.textContent=result.reason;b.append(why);}
 b.onclick=()=>selectCompany(s);row.onmouseenter=()=>setHover(s.code);row.onmouseleave=()=>setHover(null);row.append(check,b);box.append(row);}}
function setHover(code){if(!state.visible.has(code))code=null;if(state.hover===code)return;state.hover=code;draw();for(const row of $('roster').children)row.classList.toggle('active',row.dataset.code===(code||state.pinned));}
let searchTimer;
$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{const q=$('search').value.trim().toLowerCase();$('results').replaceChildren();if(!q)return;const found=state.catalog.stocks.filter(s=>(s.code+s.name).toLowerCase().includes(q)).slice(0,25);for(const s of found){const b=document.createElement('button');b.textContent=`${state.stocks.has(s.code)?'✓':'＋'} ${s.name} ${s.code} · ${fmt(s.cap_yi)} 亿`;b.onclick=async()=>{if(state.loading)return;const epoch=state.request;try{const stock=await api('/api/stock',{code:s.code,metric:state.metric});if(epoch!==state.request)return;state.stocks.set(s.code,stock);state.excluded.delete(s.code);$('search').value='';$('results').replaceChildren();years();renderRoster();draw();message('已加入 '+stock.name+' · '+(stock.values.length?'可悬停曲线查看原值':'当前指标暂无年报数据'));selectCompany(stock);}catch(e){message(e.message);}};$('results').append(b);}if(!found.length)$('results').textContent='没有匹配的股票';},120);};
function annualTable(s){const table=document.createElement('table');const head=document.createElement('tr');for(const t of ['报告年度',`${metricName()}（${unit()}）`]){const th=document.createElement('th');th.textContent=t;head.append(th);}table.append(head);const values=new Map(s.values);const years=[...new Set([...values.keys(),...Object.keys(s.notes||{}).map(Number)])].sort((a,b)=>b-a);for(const y of years){const row=document.createElement('tr');for(const t of [y,values.has(y)?fmt(values.get(y),2):(s.notes[y]||'暂无数据')]){const td=document.createElement('td');td.textContent=t;row.append(td);}table.append(row);}$('annual').replaceChildren(table);}
async function selectCompany(s){state.pinned=s.code;draw();$('companyTitle').textContent=`${s.name} · ${s.code}`;$('companyMeta').textContent=`总市值 ${cap(s)} ｜ ${s.industry.join(' / ')||'暂无行业归属'} ｜ ${tags(s.code)}`;annualTable(s);$('business').textContent='正在读取主营业务简介…';const token=++state.profileRequest;try{const d=await api('/api/business',{code:s.code});if(token!==state.profileRequest)return;const box=$('business');box.replaceChildren();let more=null;for(const [i,line] of d.lines.entries()){const p=document.createElement('p');p.textContent=line;if(i<2)box.append(p);else{if(!more){more=document.createElement('details');const summary=document.createElement('summary');summary.textContent='产品与经营范围详情';more.append(summary);box.append(more);}more.append(p);}}if(d.error){const p=document.createElement('p');p.textContent=d.error;box.append(p);const retry=document.createElement('button');retry.textContent='重试';retry.onclick=()=>selectCompany(s);box.append(retry);}const a=document.createElement('a');a.href=d.source;a.target='_blank';a.rel='noopener noreferrer';a.textContent=' 主营业务来源：同花顺'+(d.fetched_at?' · 获取于 '+d.fetched_at.slice(0,10):'');box.append(a);}catch(e){if(token===state.profileRequest)$('business').textContent='简介读取失败：'+e.message;}}
function draw(){if(!state.data)return;const canvas=$('chart'),ctx=canvas.getContext('2d');const w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
 const left=78,right=22,top=25,bottom=42,pw=w-left-right,ph=h-top-bottom;
 let from=+$('from').value,to=+$('to').value;if(from>to){[from,to]=[to,from];}
 const all=[...state.stocks.values()].filter(s=>state.visible.has(s.code));const vals=all.flatMap(s=>s.values.filter(v=>v[0]>=from&&v[0]<=to).map(v=>v[1])).concat(state.data.median.filter(v=>v[0]>=from&&v[0]<=to).map(v=>v[1]));
 const threshold=unit()==='倍'?1:30;
 const compressed=$('scale').value==='symlog'||($('scale').value==='auto'&&vals.some(v=>Math.abs(v)>threshold*5));
 const transform=v=>compressed?Math.sign(v)*(Math.abs(v)<=threshold?Math.abs(v)/threshold:1+Math.log10(Math.abs(v)/threshold)):v;
 const inverse=v=>compressed?Math.sign(v)*(Math.abs(v)<=1?Math.abs(v)*threshold:threshold*Math.pow(10,Math.abs(v)-1)):v;
 let lo=transform(Math.min(0,...vals)),hi=transform(Math.max(0,...vals));if(lo===hi){lo-=1;hi+=1;}const pad=(hi-lo)*.08;lo-=pad;hi+=pad;
 const x=y=>left+(y-from+.35)/(to-from+.7)*pw, y=v=>top+(hi-transform(v))/(hi-lo)*ph;
 ctx.font='11px "Microsoft YaHei",sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';for(let i=0;i<=6;i++){const v=lo+(hi-lo)*i/6,py=top+ph-ph*i/6;ctx.strokeStyle='#e7edf3';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(w-right,py);ctx.stroke();ctx.fillStyle='#6b8095';ctx.fillText(fmt(inverse(v),Math.abs(inverse(v))<100?1:0)+(unit()==='%'?'%':''),left-8,py);}
 ctx.strokeStyle='#b4c4d2';ctx.beginPath();ctx.moveTo(left,y(0));ctx.lineTo(w-right,y(0));ctx.stroke();ctx.textAlign='center';for(let yr=from;yr<=to;yr++){if((yr-from)%Math.max(1,Math.ceil((to-from+1)/Math.max(3,pw/55)))===0||yr===to){ctx.fillStyle='#75889a';ctx.fillText(yr,x(yr),h-19);}}
 ctx.textAlign='left';ctx.fillStyle='#506b81';ctx.fillText(metricName()+'（'+unit()+'）',left,11);state.geometry=[];
 const focus=state.hover||(state.visible.has(state.pinned)?state.pinned:null);all.sort((a,b)=>Number(important(a.code))-Number(important(b.code))||0);if(focus){const k=all.findIndex(s=>s.code===focus);if(k>=0)all.push(...all.splice(k,1));}
 function line(code,values,col,width,alpha,dashed=false){ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=width;ctx.globalAlpha=alpha;ctx.setLineDash(dashed?[6,5]:[]);let prev=null;ctx.beginPath();for(const [yr,v] of values){if(yr<from||yr>to)continue;const p={x:x(yr),y:y(v),yr,v,code};if(prev&&yr===prev.yr+1){ctx.moveTo(prev.x,prev.y);ctx.lineTo(p.x,p.y);if(code)state.geometry.push({a:prev,b:p,code});}if(code)state.geometry.push({a:p,b:p,code});prev=p;}ctx.stroke();ctx.setLineDash([]);for(const [yr,v] of values){if(yr<from||yr>to)continue;ctx.beginPath();ctx.arc(x(yr),y(v),width>2?3:1.5,0,Math.PI*2);ctx.fill();}ctx.restore();}
 for(const s of all){const hot=s.code===focus;line(s.code,s.values,color(s.code),hot?4.5:important(s.code)?2.6:1,focus?(hot?1:.12):important(s.code)?1:.25);}
 line(null,state.data.median,'#24354a',1.8,focus?.4:.95,true);
 if(!all.length){ctx.textAlign='center';ctx.fillText('没有勾选的达标个股；可放宽筛选或勾选个股',w/2,h/2);}
 $('axisnote').textContent=(compressed?`纵轴采用对称对数：±${threshold}${unit()}内线性，外侧压缩；保留原值。`:'纵轴线性。')+' 缺失年份断线，极端值保留；黑色虚线始终为原行业中位数。';
}
function distance(px,py,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=dx||dy?Math.max(0,Math.min(1,((px-a.x)*dx+(py-a.y)*dy)/(dx*dx+dy*dy))):0;return Math.hypot(px-a.x-t*dx,py-a.y-t*dy);}
let mouseFrame=0;
$('chart').onmousemove=e=>{const px=e.offsetX,py=e.offsetY;cancelAnimationFrame(mouseFrame);mouseFrame=requestAnimationFrame(()=>{let best=null,dist=9;for(const seg of state.geometry){const d=distance(px,py,seg.a,seg.b);if(d<dist){dist=d;best=seg;}}setHover(best?.code||null);const tip=$('tooltip');tip.hidden=!best;if(best){const s=state.stocks.get(best.code),p=Math.abs(px-best.a.x)<Math.abs(px-best.b.x)?best.a:best.b;tip.replaceChildren();for(const t of [`${s.name} ${s.code} · ${tags(s.code)}`,`${p.yr} 年 ${metricName()} ${valueText(p.v)}`,`总市值 ${cap(s)}`]){const div=document.createElement('div');div.textContent=t;tip.append(div);}tip.style.left=Math.max(0,Math.min(px+15,$('plot').clientWidth-300))+'px';tip.style.top=Math.max(0,Math.min(py+15,$('plot').clientHeight-100))+'px';}});};
$('chart').onmouseleave=()=>{cancelAnimationFrame(mouseFrame);setHover(null);$('tooltip').hidden=true;};$('chart').onclick=()=>{if(state.hover)selectCompany(state.stocks.get(state.hover));else{state.pinned=null;draw();}};
$('l1').onchange=()=>{childOptions(2,$('l1').value);childOptions(3,'');load();};$('l2').onchange=()=>{childOptions(3,$('l2').value);load();};$('l3').onchange=()=>load();$('metric').onchange=()=>load(true);$('scale').onchange=draw;
for(const id of ['from','to'])$(id).onchange=()=>{if(+$('from').value>+$('to').value)$(id==='from'?'to':'from').value=$(id).value;refreshSelection();};
$('allYears').onclick=()=>{years(false);refreshSelection();};
$('reset').onclick=()=>{if(!state.loading){clearFilterInputs();load();}};
$('selectAll').onclick=()=>{if(state.loading)return;state.excluded.clear();refreshSelection();};
$('onlyPicks').onclick=()=>{if(!state.data||state.loading)return;state.excluded=new Set([...state.stocks.keys()].filter(c=>!important(c)));state.pinned=null;refreshSelection();};
$('clear').onclick=()=>{if(state.loading)return;state.excluded=new Set(state.stocks.keys());state.hover=null;state.pinned=null;refreshSelection();};
$('download').onclick=()=>{const a=document.createElement('a');a.download=$('title').textContent+'.png';a.href=$('chart').toDataURL('image/png');a.click();};
new ResizeObserver(draw).observe($('plot'));
async function init(){try{state.catalog=await api('/api/catalog');$('metric').replaceChildren();for(const [key,m] of Object.entries(state.catalog.metrics))option($('metric'),key,m.name+'（'+m.unit+'）');$('stamp').textContent=`总市值基准日 ${state.catalog.cap_date} ｜ 单位：亿元 · 分类快照 ${state.catalog.snapshot}`;state.catalog.groups.filter(g=>g.level===1).forEach(g=>option($('l1'),g.id,g.name));const initial=state.catalog.groups.find(g=>g.level===1&&g.name==='食品饮料');if(initial)$('l1').value=initial.id;childOptions(2,$('l1').value);childOptions(3,'');await load();}catch(e){message('启动失败：'+e.message);}}
init();
