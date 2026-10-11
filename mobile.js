'use strict';
document.getElementById('mobileStocks').onclick=()=>document.getElementById('stockPanel').classList.add('open');
document.getElementById('closeStocks').onclick=()=>document.getElementById('stockPanel').classList.remove('open');
document.getElementById('mobileFilters').onclick=()=>document.querySelector('.value-filters').classList.toggle('expanded');
// Touch chooses the closest real curve, using the same hit geometry as mouse hover.
document.getElementById('chart').addEventListener('pointerup',event=>{
 if(event.pointerType==='mouse')return;
 const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
 let nearest=null,best=18;
 for(const segment of state.geometry){const d=distance(x,y,segment.a,segment.b);if(d<best){best=d;nearest=segment;}}
 if(nearest){setHover(nearest.code);selectCompany(state.stocks.get(nearest.code));}
});
