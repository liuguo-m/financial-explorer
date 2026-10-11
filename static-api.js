'use strict';
// Same public data contract as the local server; no credentials or backend required.
const staticFiles=new Map();
function staticFile(name){
 if(!staticFiles.has(name))staticFiles.set(name,fetch(new URL('data/'+name+'.json',document.baseURI)).then(r=>{if(!r.ok)throw Error('数据读取失败：'+name);return r.json();}).catch(e=>{staticFiles.delete(name);throw e;}));
 return staticFiles.get(name);
}
async function staticApi(path,params){
 const catalog=await staticFile('catalog');
 if(path==='/api/catalog')return catalog;
 if(path==='/api/business'){
  const descriptions=await staticFile('business');
  return descriptions[params.code]||{lines:[],source:`https://basic.10jqka.com.cn/new/${params.code}/operate.html`,error:'当前快照暂未收录主营业务简介，请点击来源查看。'};
 }
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
