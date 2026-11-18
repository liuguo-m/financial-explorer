'use strict';
const notesState={data:null,request:null,context:'',search:'',mode:'auto',epoch:0};
function noteTarget(){
 const group=state.catalog?.groups.find(g=>g.id===state.group);
 if(notesState.mode!=='industry'&&!$('companyPanel').hidden&&companyView.code){
  const stock=state.catalog?.stocks.find(s=>s.code===companyView.code);
  if(stock)return {kind:'stock',key:stock.code,name:stock.name+' '+stock.code};
 }
 return group?{kind:'industry',key:group.id,name:group.id}:null;
}
function newNoteUrl(target){
 const config=notesState.data.config;
 const url=new URL(`https://github.com/${config.repository}/issues/new`);
 const marker='<!-- financial-note: '+JSON.stringify({kind:target.kind,key:target.key})+' -->';
 url.searchParams.set('labels',config.label);
 url.searchParams.set('title','[心得] '+target.name+' · '+noteDate(new Date().toISOString()));
 url.searchParams.set('body',marker+'\n\n## 我的判断\n\n\n## 观察依据\n\n\n## 风险与待验证问题\n\n\n---\n关联股票/行业由顶部标记确定，请保留该标记。');
 return url.href;
}
function noteText(tag,text,cls){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}
function noteDate(text){const d=new Date(text);return Number.isNaN(d.getTime())?'':d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});}
function renderNotes(){
 const target=noteTarget(),box=$('notesList');box.replaceChildren();
 $('notesTitle').textContent=target?'心得 · '+target.name:'备注与心得';
 const write=$('writeNote');write.hidden=!target||!notesState.data;
 if(write.hidden){$('notesStatus').textContent=target?'正在读取心得…':'选择行业或股票后可查看心得。';return;}
 write.href=newNoteUrl(target);
 $('notesStatus').textContent=`公开展示，仅收录 ${notesState.data.config.owner_login} 的笔记。最近同步：${noteDate(notesState.data.synced_at)}。`;
 const query=notesState.search.trim().toLocaleLowerCase();
 const notes=notesState.data.notes.filter(n=>n.kind===target.kind&&n.key===target.key&&(!query||(n.title+'\n'+n.body).toLocaleLowerCase().includes(query)));
 if(!notes.length){box.append(noteText('p',query?'没有匹配的心得。':'暂无心得，点击“写心得”在 GitHub 保存第一条。','muted'));return;}
 for(const n of notes){const detail=document.createElement('details');detail.className='note-item';
  detail.append(noteText('summary',n.title+' · 创建 '+noteDate(n.created_at||n.updated_at)));
  detail.append(noteText('p','创建：'+noteDate(n.created_at||n.updated_at)+' ｜ 最近修改：'+noteDate(n.updated_at)+'（北京时间）','muted'));
  // Notes are untrusted text. Do not render HTML, scripts or event handlers.
  detail.append(noteText('div',n.body,'note-body'));
  const link=noteText('a','在 GitHub 查看／修改／归档');
  link.href=`https://github.com/${notesState.data.config.repository}/issues/${Number(n.number)}`;link.target='_blank';link.rel='noopener noreferrer';detail.append(link);box.append(detail);
 }
}
async function loadNotes(force=false){
 const epoch=++notesState.epoch;
 try{
  if(force||!notesState.request)notesState.request=fetch(new URL('data/notes.json'+(force?'?t='+Date.now():''),document.baseURI),{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('心得暂时无法读取');return r.json();});
  const data=await notesState.request;if(epoch!==notesState.epoch)return;
  notesState.data=data;renderNotes();window.dispatchEvent(new Event('notes-ready'));
 }catch(e){if(epoch===notesState.epoch){notesState.request=null;$('notesStatus').textContent='读取失败：'+e.message+'，请点击刷新重试。';}}
}
function updateNotesContext(){
 const target=noteTarget(),key=target?target.kind+':'+target.key:'';
 if(key!==notesState.context){notesState.context=key;notesState.search='';$('notesSearch').value='';}
 renderNotes();if(!notesState.data&&!notesState.request)loadNotes();
}
$('refreshNotes').onclick=()=>loadNotes(true);
$('notesSearch').oninput=()=>{notesState.search=$('notesSearch').value;renderNotes();};
$('notesScope').onchange=()=>{notesState.mode=$('notesScope').value;updateNotesContext();};
window.addEventListener('focus',()=>{if(notesState.data)loadNotes(true);});
loadNotes();
