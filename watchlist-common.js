'use strict';
const Watchlist={
 entry(data,code){return (data?.watchlist||[]).find(w=>w.code===code);},
 url(data,stock,group='观察'){
  const existing=this.entry(data,stock.code),repo=data.config.repository;
  if(existing)return `https://github.com/${repo}/issues/${Number(existing.number)}`;
  const url=new URL(`https://github.com/${repo}/issues/new`);
  url.searchParams.set('labels',data.config.watchlist_label||'investment-watchlist');
  url.searchParams.set('title','[自选] '+stock.name+' '+stock.code);
  url.searchParams.set('body','<!-- financial-watchlist: '+JSON.stringify({code:stock.code})+' -->\n\n分组：'+group+'\n\n## 关注理由\n\n\n---\n编辑“分组”和关注理由即可修改；关闭本记录可移出自选，重新打开可恢复。请保留顶部股票代码标记。');
  return url.href;
 },
 label(entry){return !entry?'☆ 加自选':entry.state==='open'?'★ 编辑／移除':'☆ 恢复自选';},
 element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;},
 link(text,url){const a=this.element('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;},
 date(value){const d=new Date(value);return Number.isNaN(d.getTime())?'暂无':d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});},
 number(value){return Number.isFinite(value)?value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'暂无';},
 latestAnnual(metric,code){const values=metric?.stocks?.[code]?.values||[];return values.filter(v=>Number.isFinite(v[1])).sort((a,b)=>b[0]-a[0])[0]||null;},
 notes(data,code){return (data.notes||[]).filter(n=>n.kind==='stock'&&n.key===code).sort((a,b)=>String(b.created_at||b.updated_at).localeCompare(String(a.created_at||a.updated_at))||b.number-a.number);}
};
