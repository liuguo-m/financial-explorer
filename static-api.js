'use strict';
// Same public data contract as the local server; no credentials or backend required.
const staticFiles=new Map();
function staticFile(name){
 if(!staticFiles.has(name))staticFiles.set(name,fetch(new URL('data/'+name+'.json',document.baseURI)).then(r=>{if(!r.ok)throw Error('数据读取失败：'+name);return r.json();}).catch(e=>{staticFiles.delete(name);throw e;}));
 return staticFiles.get(name);
}
async function staticApi(path,params){
 const catalog=await staticFile('catalog');
 catalog.metrics.dividend_yield={name:'分红率（股息率估算）',unit:'%',periodLabel:'年度末／最新',note:'近365天已实施税前现金分红估算额÷总市值。历史年份取第四季度末记录，最新年份取最新交易日；不是分红÷归母利润的股利支付率。缺失不补零。黑色虚线为有效个股的简单中位数。'};
 if(path==='/api/catalog')return catalog;
 if(path==='/api/business'){
  const descriptions=await staticFile('business');
  return descriptions[params.code]||{lines:[],source:`https://basic.10jqka.com.cn/new/${params.code}/operate.html`,error:'当前快照暂未收录主营业务简介，请点击来源查看。'};
 }
 if(params.metric==='dividend_yield')return dividendYieldApi(path,params,catalog);
 const metric=await staticFile(params.metric);
 function stock(code){const profile=catalog.stocks.find(s=>s.code===code);if(!profile)throw Error('未知股票');return {...profile,...(metric.stocks[code]||{values:[],notes:{}})};}
 if(path==='/api/stock')return stock(params.code);
 if(path==='/api/chart'){
  const group=catalog.groups.find(g=>g.id===params.group);if(!group)throw Error('未知行业');
  const known=new Set(catalog.stocks.map(s=>s.code));
  return {...metric.groups[params.group],stocks:group.codes.filter(c=>known.has(c)).map(stock)};
 }
 throw Error('未知数据请求');
}

async function dividendYieldApi(path,params,catalog){
 const market=await staticFile('market_quarterly'),currentYear=Number(market.as_of.slice(0,4));
 function stock(code){
  const profile=catalog.stocks.find(s=>s.code===code);if(!profile)throw Error('未知股票');
  const annual=new Map();
  for(const r of market.stocks[code]||[]){const year=Number(r[1].slice(0,4));
   if((r[0]!=='最新'&&r[0].endsWith('-12-31'))||year===currentYear){
    if(!annual.has(year)||r[1]>annual.get(year)[1])annual.set(year,r);
   }
  }
  const values=[],notes={},dates={};
  for(const [year,r] of [...annual].sort((a,b)=>a[0]-b[0])){dates[year]=r[1];if(Number.isFinite(r[4]))values.push([year,r[4]]);else notes[year]='分红记录缺失或估算条件不足';}
  return {...profile,values,notes,dates};
 }
 if(path==='/api/stock')return stock(params.code);
 if(path!=='/api/chart')throw Error('未知数据请求');
 const group=catalog.groups.find(g=>g.id===params.group);if(!group)throw Error('未知行业');
 const known=new Set(catalog.stocks.map(s=>s.code));const stocks=group.codes.filter(c=>known.has(c)).map(stock),byYear=new Map();
 for(const s of stocks)for(const [year,v] of s.values){if(!byYear.has(year))byYear.set(year,[]);byYear.get(year).push(v);}
 const median=[...byYear].sort((a,b)=>a[0]-b[0]).map(([year,values])=>{values.sort((a,b)=>a-b);const n=values.length;return [year,(values[Math.floor((n-1)/2)]+values[Math.floor(n/2)])/2,n];});
 return {stocks,median,selection:{best_code:null,top3_codes:[],best_status:'股息率不作高低优选；请结合盈利、分红持续性及实际观测日期判断。'},reason:null,reference_selection:false,
  method:catalog.metrics.dividend_yield.note+' 市场数据截至 '+market.as_of+'。'+market.note};
}
