'use strict';
const watchPage={data:null,catalog:null,market:null,annual:{},epoch:0};
const byId=id=>document.getElementById(id);
async function watchFile(name,refresh=false){const r=await fetch(new URL('data/'+name+'.json'+(refresh?'?t='+Date.now():''),document.baseURI),{cache:refresh?'no-cache':'default'});if(!r.ok)throw Error('读取失败：'+name);return r.json();}
function watchCurrentRows(){
 return (watchPage.data.watchlist||[]).filter(w=>w.state==='open').map(w=>{
  const stock=watchPage.catalog.stocks.find(s=>s.code===w.code);if(!stock)return null;
  const rows=watchPage.market.stocks[w.code]||[],latest=rows.at(-1),roe=Watchlist.latestAnnual(watchPage.annual.roe,w.code);
  return {...w,stock,latest,roe,notes:Watchlist.notes(watchPage.data,w.code)};
 }).filter(Boolean);
}
function watchOptions(id,values){const el=byId(id),old=el.value;el.replaceChildren(new Option(id==='watchGroup'?'全部分组':'全部行业',''));for(const value of [...new Set(values)].sort())el.append(new Option(value,value));el.value=[...el.options].some(o=>o.value===old)?old:'';}
function watchRender(){
 const all=watchCurrentRows(),query=byId('watchSearch').value.trim().toLowerCase();
 const rows=all.filter(w=>(!byId('watchGroup').value||w.group===byId('watchGroup').value)&&(!byId('watchIndustry').value||w.stock.industry?.[0]===byId('watchIndustry').value)&&(!query||[w.code,w.stock.name,w.stock.industry?.join('/'),w.group,w.body,...w.notes.map(n=>n.title+' '+n.body)].join(' ').toLowerCase().includes(query)));
 const mode=byId('watchSort').value;
 rows.sort((a,b)=>{if(mode==='added')return b.created_at.localeCompare(a.created_at)||b.number-a.number;const value=w=>mode==='roe'?w.roe?.[1]:w.latest?.[mode==='cap'?5:mode==='pe'?2:3],av=value(a),bv=value(b);if(!Number.isFinite(av))return Number.isFinite(bv)?1:a.code.localeCompare(b.code);if(!Number.isFinite(bv))return -1;return (mode==='cap'||mode==='roe'?bv-av:av-bv)||a.code.localeCompare(b.code);});
 const table=byId('watchTable');table.replaceChildren();const head=Watchlist.element('tr');
 for(const h of ['股票／分组','行业','行情日期','PE(TTM)','PB','股息率估算 %','总市值 亿元','ROE %','毛利率 %','归母净利润 亿元','心得／关注理由','管理'])head.append(Watchlist.element('th',h));table.append(head);
 for(const w of rows){const tr=Watchlist.element('tr'),name=Watchlist.element('td'),open=Watchlist.link(w.stock.name+' '+w.code,'./index.html?stock='+w.code);open.target='_self';name.append(open,Watchlist.element('small',w.group));tr.append(name,Watchlist.element('td',w.stock.industry?.join(' / ')||'暂无'),Watchlist.element('td',w.latest?.[1]||'暂无'));
  for(const index of [2,3,4,5])tr.append(Watchlist.element('td',Watchlist.number(w.latest?.[index])));
  for(const key of ['roe','gross_margin','profit_amount']){const value=Watchlist.latestAnnual(watchPage.annual[key],w.code),td=Watchlist.element('td',Watchlist.number(value?.[1]));if(value)td.append(Watchlist.element('small',value[0]+' 年报'));tr.append(td);}
  const notes=Watchlist.element('td');notes.className='watch-notes-cell';
  const reason=Watchlist.element('details');reason.append(Watchlist.element('summary','关注理由 · '+w.group),Watchlist.element('div',w.body,'note-body'));notes.append(reason);
  for(const n of w.notes){const d=Watchlist.element('details');d.append(Watchlist.element('summary',n.title+' · 创建 '+Watchlist.date(n.created_at||n.updated_at)),Watchlist.element('p','创建：'+Watchlist.date(n.created_at||n.updated_at)+' ｜ 修改：'+Watchlist.date(n.updated_at),'muted'),Watchlist.element('div',n.body,'note-body'),Watchlist.link('查看／修改原心得',n.url));notes.append(d);}
  if(!w.notes.length)notes.append(Watchlist.element('small','暂无股票心得'));tr.append(notes);
  const manage=Watchlist.element('td'),url=Watchlist.url(watchPage.data,w.stock);manage.append(Watchlist.link('编辑分组／理由',url),document.createElement('br'),Watchlist.link('移除（关闭记录）',url),document.createElement('br'));
  const noteUrl=new URL(`https://github.com/${watchPage.data.config.repository}/issues/new`);noteUrl.searchParams.set('labels',watchPage.data.config.label);noteUrl.searchParams.set('title','[心得] '+w.stock.name+' '+w.code+' · '+Watchlist.date(new Date().toISOString()));noteUrl.searchParams.set('body','<!-- financial-note: '+JSON.stringify({kind:'stock',key:w.code})+' -->\n\n## 我的判断\n\n\n## 观察依据与风险\n\n');manage.append(Watchlist.link('新增心得（独立记录）',noteUrl.href));tr.append(manage);table.append(tr);
 }
 byId('watchEmpty').hidden=rows.length>0;byId('watchEmpty').textContent=all.length?'没有符合筛选条件的自选股。':'还没有自选股，可在上方或行业列表加入。';
 byId('watchStatus').textContent=`显示 ${rows.length} / ${all.length} 只 ｜ 全市场数据截至 ${watchPage.market.as_of} ｜ 自选与心得同步 ${Watchlist.date(watchPage.data.synced_at)}`;
}
function watchAddLink(){const raw=byId('watchAddCode').value.trim(),stock=watchPage.catalog?.stocks.find(s=>s.code===raw.split(/\s/)[0]||s.name===raw);const a=byId('watchAdd');a.hidden=!stock||!watchPage.data;if(!a.hidden){a.href=Watchlist.url(watchPage.data,stock,byId('watchAddGroup').value.trim()||'观察');a.textContent=Watchlist.label(Watchlist.entry(watchPage.data,stock.code))+'（GitHub）';}}
byId('watchAddCode').oninput=()=>{const q=byId('watchAddCode').value.trim().toLowerCase(),list=byId('watchStockOptions');list.replaceChildren();for(const s of (watchPage.catalog?.stocks||[]).filter(s=>q&&(s.code+s.name).toLowerCase().includes(q)).slice(0,20))list.append(new Option(s.code+' '+s.name,s.code+' '+s.name));watchAddLink();};
byId('watchAddCode').onchange=watchAddLink;byId('watchAddGroup').oninput=watchAddLink;
for(const id of ['watchSearch','watchGroup','watchIndustry','watchSort'])byId(id).addEventListener(id==='watchSearch'?'input':'change',()=>{if(watchPage.data)watchRender();});
async function loadWatchPage(refresh=false){const epoch=++watchPage.epoch;byId('watchStatus').textContent='正在读取自选和行情…';try{
 const [data,catalog,market,roe,gross,profit]=await Promise.all([watchFile('notes',refresh),watchFile('catalog'),watchFile('market_quarterly',refresh),watchFile('roe'),watchFile('gross_margin'),watchFile('profit_amount')]);if(epoch!==watchPage.epoch)return;
 Object.assign(watchPage,{data,catalog,market,annual:{roe,gross_margin:gross,profit_amount:profit}});const rows=watchCurrentRows();watchOptions('watchGroup',rows.map(w=>w.group));watchOptions('watchIndustry',rows.map(w=>w.stock.industry?.[0]).filter(Boolean));watchRender();watchAddLink();
 }catch(e){if(epoch===watchPage.epoch)byId('watchStatus').textContent=e.message+'，请点击刷新重试。';}}
byId('watchRefresh').onclick=()=>loadWatchPage(true);window.addEventListener('focus',()=>{if(watchPage.data)loadWatchPage(true);});loadWatchPage();
