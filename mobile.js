'use strict';
document.getElementById('mobileStocks').onclick=()=>document.getElementById('stockPanel').classList.add('open');
document.getElementById('closeStocks').onclick=()=>document.getElementById('stockPanel').classList.remove('open');
document.getElementById('mobileFilters').onclick=()=>document.querySelector('.value-filters').classList.toggle('expanded');
// Touch chooses the closest real curve, using the same hit geometry as mouse hover.
let suppressTouchClickUntil=0;
document.getElementById('chart').addEventListener('click',event=>{
 if(performance.now()<suppressTouchClickUntil)event.stopImmediatePropagation();
},true);
document.getElementById('chart').addEventListener('pointerup',event=>{
 if(event.pointerType==='mouse')return;
 suppressTouchClickUntil=performance.now()+700;
 const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
 let nearest=null,best=18;
 for(const segment of state.geometry){const d=distance(x,y,segment.a,segment.b);if(d<best){best=d;nearest=segment;}}
 if(nearest){
  const stock=state.stocks.get(nearest.code),point=Math.abs(x-nearest.a.x)<Math.abs(x-nearest.b.x)?nearest.a:nearest.b;
  setHover(nearest.code);selectCompany(stock);
  let preview=document.getElementById('touchInfo');
  if(!preview){preview=document.createElement('p');preview.id='touchInfo';preview.setAttribute('role','status');document.getElementById('plot').after(preview);}
  preview.textContent=`${stock.name} ${stock.code} · ${point.yr}年 ${metricName()} ${valueText(point.v)} · 总市值 ${cap(stock)}。主营业务与完整年报见下方公司档案。`;
 }else{state.pinned=null;setHover(null);draw();document.getElementById('touchInfo')?.remove();}
});
