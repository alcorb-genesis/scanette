/* Internal back navigation for the logistics application.
   One history entry per screen or open layer (dialog, panel, camera), all created
   by user actions. Entry 0 is the exit boundary: reaching it from the home screen
   shows a hint and stays; the next Back leaves the application normally. No entry
   is ever added in a loop, and browser navigation outside this app is untouched. */
(function(root){
'use strict';
function createNavHistory({history,render,current,canLeave,closeLayer,toast,rootGuard=true,title=''}){
 let sid=Math.random().toString(36).slice(2)+Date.now().toString(36);
 let stack=[];          // mirror of our entries, index = n
 let silent=0;          // pops we caused ourselves and must not act on
 let traversing=false;  // a back() we requested has not been reported yet
 const queue=[];
 const top=()=>stack[stack.length-1];
 const make=(n,kind,extra={})=>({alcorb:1,sid,n,kind,...extra});
 const url=section=>section?'#'+section:undefined;
 function run(op){if(traversing)queue.push(op);else op();}
 function flush(){while(!traversing&&queue.length)queue.shift()();}
 function push(entry){history.pushState(entry,title,url(entry.section));stack.push(entry);}
 function back(isSilent){traversing=true;if(isSilent)silent++;history.back();}
 function ensureArmed(){if(stack.length&&top().n===0&&rootGuard)push(make(1,'screen',{section:current()}));}

 const api={
  /* The page's current entry becomes the exit boundary; nothing is pushed before a user action. */
  start(section){stack=[make(0,'base',{section})];silent=0;traversing=false;queue.length=0;history.replaceState(stack[0],title,url(section));},
  reset(section){sid=Math.random().toString(36).slice(2)+Date.now().toString(36);api.start(section);},
  /* First user action: from now on the browser keeps our entries (no skippable history). */
  activate(){run(()=>ensureArmed());},
  /* User opens a screen. */
  openScreen(section,extra={}){run(()=>{
   if(!stack.length)return;
   ensureArmed();
   for(const e of stack)if(e.kind==='layer')e.dead=true; // layers of the previous screen are gone
   push(make(top().n+1,'screen',{section,...extra}));
  });},
  /* The screen the user is leaving notes where it should reopen (a record identifier). Kept in
     memory on its own entry: Back hands it to render, a reload forgets it. */
  annotate(extra){run(()=>{const entry=stack.findLast(e=>e.kind==='screen'||e.kind==='base');if(entry)Object.assign(entry,extra);});},
  /* User asks for the home screen: go back to it when it is below, never stack a copy. */
  goHome(){
   const index=stack.findLastIndex(e=>e.kind==='screen'&&e.section==='home');
   if(index>0){const delta=top().n-stack[index].n;if(delta>0){traversing=true;silent++;history.go(-delta);}return true;}
   api.openScreen('home');return false;
  },
  layerOpened(id,owner){run(()=>{
   if(!stack.length||stack.some(e=>e.kind==='layer'&&e.id===id&&!e.dead))return;
   ensureArmed();push(make(top().n+1,'layer',{id,owner,section:current()}));
  });},
  /* A layer closed by its own button or by Escape: remove its entry. */
  layerClosed(id){run(()=>{
   const entry=stack.find(e=>e.kind==='layer'&&e.id===id&&!e.dead);
   if(!entry)return;
   if(entry===top())back(true);else entry.dead=true;
  });},
  onPopState(state){
   traversing=false;
   if(!stack.length)return;
   if(!state||state.alcorb!==1){flush();return;}           // a fragment link or a page outside the app
   if(state.sid!==sid){                                       // entry from before a reload
    stack=[make(0,'base',{section:state.section})];silent=0;queue.length=0;
    history.replaceState(stack[0],title,url(state.section));
    if(state.section&&state.section!==current())render(state.section,state.receiptId,state);
    return;
   }
   const from=top();
   if(silent>0){silent--;stack=stack.filter(e=>e.n<=state.n);flush();return;}
   if(state.n>from.n){                                        // Forward button
    if(state.kind==='layer'){back(true);return;}
    stack.push(state);if(state.section!==current())render(state.section,state.receiptId,state);flush();return;
   }
   const popped=stack.filter(e=>e.n>state.n).reverse();
   stack=stack.filter(e=>e.n<=state.n);
   const landed=top();
   const layers=popped.filter(e=>e.kind==='layer'&&!e.dead);
   if(landed.kind==='layer'&&landed.dead){for(const e of layers)closeLayer(e);back(false);return;} // nothing left to close there: keep going back
   const target=landed.kind==='base'?(rootGuard?'home':current()):landed.section;
   if(target!==current()){
    if(!canLeave()){push(make(top().n+1,'screen',{section:current()}));flush();return;}
    render(target,landed.receiptId,landed);
    if(landed.n===0&&rootGuard)push(make(1,'screen',{section:'home'}));
    flush();return;
   }
   for(const e of layers)closeLayer(e);
   if(landed.n===0&&rootGuard&&!layers.length)toast();
   flush();
  },
  /* Manual edit of the address, or a link to a route: the browser already added the entry. */
  onHashChange(section,isRoute){
   if(!isRoute||history.state?.alcorb===1)return false;
   const entry=make((top()?.n??0)+1,'screen',{section});history.replaceState(entry,title,url(section));stack.push(entry);return true;
  },
  get depth(){return top()?.n??0;},
  get entries(){return stack.map(e=>({...e}));}
 };
 return api;
}
const api={createNavHistory};root.AlcorbNavHistory=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
