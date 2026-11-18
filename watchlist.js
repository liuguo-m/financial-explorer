'use strict';
function watchlistControl(stock,compact=false){
 const data=notesState.data;
 if(!data){const span=Watchlist.element('span','☆','watch-toggle');span.title='正在读取自选股';return span;}
 const entry=Watchlist.entry(data,stock.code),a=Watchlist.link(Watchlist.label(entry),Watchlist.url(data,stock));
 if(compact)a.textContent=entry?.state==='open'?'★':'☆';a.title=Watchlist.label(entry)+'（GitHub）';a.className='watch-toggle';a.setAttribute('aria-label',Watchlist.label(entry)+' '+stock.name);return a;
}
function renderWatchIndustry(){
 const box=$('industryWatchList');if(!box||!state.data)return;box.replaceChildren();
 const allowed=new Set(state.data.stocks.map(s=>s.code)),query=$('industryWatchSearch').value.trim().toLowerCase();
 const members=(notesState.data?.watchlist||[]).filter(w=>w.state==='open'&&allowed.has(w.code));
 $('industryWatchCount').textContent=members.length+' 只';
 for(const entry of members){const stock=state.catalog.stocks.find(s=>s.code===entry.code);if(!stock||query&&!(stock.code+stock.name+entry.group+entry.body).toLowerCase().includes(query))continue;
  const row=Watchlist.element('div',undefined,'watch-industry-row'),b=Watchlist.element('button',stock.name+' '+stock.code);
  b.onclick=async()=>{const s=state.stocks.get(stock.code)||await api('/api/stock',{code:stock.code,metric:state.metric});selectCompany(s);};
  row.append(b,Watchlist.element('small',entry.group),watchlistControl(stock));box.append(row);
 }
 if(!box.children.length)box.append(Watchlist.element('p',query?'没有匹配的自选股。':'本行业暂无自选股，点击下方个股旁的“☆ 加自选”。','muted'));
}
function updateWatchlist(){
 renderWatchIndustry();const box=$('companyWatchActions');if(!box)return;box.replaceChildren();
 const stock=state.catalog?.stocks.find(s=>s.code===companyView.code);if(stock)box.append(watchlistControl(stock));
}
$('industryWatchSearch').oninput=renderWatchIndustry;
window.addEventListener('notes-ready',()=>{if(state.data)renderRoster();updateWatchlist();});
if(state.data){renderRoster();updateWatchlist();}
