const test=require('node:test'),assert=require('node:assert/strict'),{createNavHistory}=require('./nav-history.js');
const tick=async(n=4)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
/* Joint session history model: pushState drops forward entries; back/go are asynchronous
   and report popstate; going below the first entry means the browser left the app. */
function fakeHistory(){
 const h={entries:[{state:null,url:'#before'}],index:0,pushes:0,exited:false,listener:null,
  get state(){return h.entries[h.index].state;},
  pushState(state,_t,url){h.entries.splice(h.index+1);h.entries.push({state:structuredClone(state),url});h.index++;h.pushes++;},
  replaceState(state,_t,url){h.entries[h.index]={state:structuredClone(state),url:url??h.entries[h.index].url};},
  back(){h.go(-1);},
  go(delta){setImmediate(()=>{const target=h.index+delta;if(target<1){h.exited=true;return;}if(target>=h.entries.length)return;h.index=target;h.listener?.(h.entries[h.index].state);});}
 };
 // index 0 is the page before the app; the app starts on index 1
 h.entries.push({state:null,url:'#home'});h.index=1;return h;
}
function setup({leave=()=>true}={}){
 const history=fakeHistory(),log=[];let section='home';
 const nav=createNavHistory({history,render:(s,r)=>{log.push('render:'+s+(r?':'+r:''));section=s;},current:()=>section,canLeave:()=>{const ok=leave();if(!ok)log.push('leave?false');return ok;},closeLayer:e=>log.push('close:'+e.id),toast:()=>log.push('toast')});
 history.listener=state=>nav.onPopState(state);
 const open=s=>{nav.openScreen(s);section=s;};
 const back=async()=>{history.back();await tick();};
 return {history,nav,log,open,back,get section(){return section;},set section(v){section=v;}};
}

test('nothing is added to the history before a user action (no fake entries at load)',()=>{
 const a=setup();a.nav.start('home');assert.equal(a.history.pushes,0);assert.equal(a.history.entries.length,2);assert.equal(a.history.state.n,0);
});
test('Back without any user action leaves normally: the browser decides, the app does not retain',async()=>{
 const a=setup();a.nav.start('home');await a.back();assert.equal(a.history.exited,true);assert.deepEqual(a.log,[]);
});
test('open section, Back to the previous screen, Back at root warns, second Back leaves',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.open('scan');
 assert.deepEqual(a.history.entries.slice(1).map(e=>e.state.kind+':'+(e.state.section||'')),['base:home','screen:home','screen:scan']);
 await a.back();assert.equal(a.section,'home');assert.deepEqual(a.log,['render:home']);
 await a.back();assert.equal(a.history.exited,false);assert.equal(a.section,'home');assert.deepEqual(a.log.slice(-1),['toast']);
 const pushes=a.history.pushes;await a.back();assert.equal(a.history.exited,true);assert.equal(a.history.pushes,pushes,'no entry re-added to hold the user');
});
test('section to section: Back returns to the previous section with its parameters',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.open('receipts');a.nav.openScreen('scan',{receiptId:'r-1'});a.section='scan';
 await a.back();assert.deepEqual(a.log,['render:receipts']);await a.back();assert.deepEqual(a.log,['render:receipts','render:home']);
});
test('an open dialog, panel or camera closes before the screen changes, top first',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.open('returns');a.nav.layerOpened('editor','module');a.nav.layerOpened('scanner','module');
 await a.back();assert.deepEqual(a.log,['close:scanner']);assert.equal(a.section,'returns');
 await a.back();assert.deepEqual(a.log,['close:scanner','close:editor']);assert.equal(a.section,'returns');
 await a.back();assert.deepEqual(a.log.slice(-1),['render:home']);
});
test('a layer closed by its own button removes its entry: the next Back changes screen at once',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.open('catalogue');a.nav.layerOpened('detail','module');
 a.nav.layerClosed('detail');await tick();assert.equal(a.history.state.kind,'screen');assert.deepEqual(a.log,[]);
 await a.back();assert.deepEqual(a.log,['render:home']);
});
test('layers closed out of order never cause a Back with no visible effect',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.open('preparation');a.nav.layerOpened('work','module');a.nav.layerOpened('camera','module');
 a.nav.layerClosed('work');await tick();assert.equal(a.history.state.id,'camera');
 await a.back();assert.deepEqual(a.log,['close:camera']);
 await a.back();await tick();assert.deepEqual(a.log,['close:camera','render:home']);
});
test('a layer that refuses to close (refused confirmation) is put back by the page, not lost',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.open('returns');a.nav.layerOpened('editor','module');
 await a.back();assert.deepEqual(a.log,['close:editor']);a.nav.layerOpened('editor','module');assert.equal(a.history.state.id,'editor');
 await a.back();assert.deepEqual(a.log,['close:editor','close:editor']);
});
test('unsaved changes: Back asks, a refusal keeps the section and its entry',async()=>{
 let answer=false;const a=setup({leave:()=>answer});a.nav.start('home');a.nav.activate();a.open('receipts');
 await a.back();assert.equal(a.section,'receipts');assert.deepEqual(a.log,['leave?false']);assert.equal(a.history.state.section,'receipts');
 answer=true;await a.back();assert.equal(a.section,'home');assert.deepEqual(a.log,['leave?false','render:home']);
});
test('after the root warning, a new action re-arms the warning once; repeated Back still leaves',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();await a.back();assert.deepEqual(a.log,['toast']);
 a.nav.activate();await a.back();assert.deepEqual(a.log,['toast','toast']);await a.back();assert.equal(a.history.exited,true);
});
test('opening a section from the root warning state still returns home before leaving',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();await a.back();a.open('scan');
 await a.back();assert.equal(a.section,'home');await a.back();assert.deepEqual(a.log.slice(-1),['toast']);await a.back();assert.equal(a.history.exited,true);
});
test('a section opened directly by its address (reload) goes home first, then warns',async()=>{
 const a=setup();a.section='scan';a.nav.start('scan');a.nav.activate();
 await a.back();assert.equal(a.section,'home');assert.equal(a.history.exited,false);
 await a.back();assert.deepEqual(a.log.slice(-1),['toast']);await a.back();assert.equal(a.history.exited,true);
});
test('home shortcut rewinds to the existing home entry instead of stacking a copy',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.open('receipts');a.nav.openScreen('scan');a.nav.layerOpened('refModal','module');
 assert.equal(a.nav.goHome(),true);a.section='home';await tick();
 assert.equal(a.history.state.section,'home');assert.equal(a.history.state.n,1);assert.deepEqual(a.log,[],'rewind is silent: the shell already displays home');
 await a.back();assert.deepEqual(a.log,['toast']);
});
test('Forward to a closed layer is not reopened: the history steps back over it',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.open('catalogue');a.nav.layerOpened('detail','module');await a.back();
 a.history.go(1);await tick();assert.equal(a.history.state.kind,'screen');assert.deepEqual(a.log,['close:detail']);
});
test('foreign entries (fragment links, pages outside the app) are ignored',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.nav.onPopState(null);a.nav.onPopState({foo:1});assert.deepEqual(a.log,[]);
 assert.equal(a.nav.onHashChange('content',false),false);assert.equal(a.history.state.kind,'screen');
});
test('entries from before a reload are adopted without re-pushing',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.open('scan');
 const b=setup();b.history.entries=a.history.entries;b.history.index=a.history.index;b.section='scan';b.nav.start('scan');
 await b.back();assert.deepEqual(b.log,['render:home']);assert.equal(b.history.state.n,0);
});
test('a burst of layer events while a Back is in progress is applied in order',async()=>{
 const a=setup();a.nav.start('home');a.nav.activate();a.open('scan');a.nav.layerOpened('scanBtn','module');
 a.nav.layerClosed('scanBtn');a.nav.layerOpened('refModal','module');await tick();
 assert.equal(a.history.state.id,'refModal');assert.deepEqual(a.history.entries.slice(1).map(e=>e.state.id||e.state.section),['home','home','scan','refModal']);
 await a.back();assert.deepEqual(a.log,['close:refModal']);
});
test('outside the application (standalone page) only layers are managed; Back then leaves',async()=>{
 const history=fakeHistory(),log=[];const nav=createNavHistory({history,rootGuard:false,render:s=>log.push('render:'+s),current:()=>undefined,canLeave:()=>true,closeLayer:e=>log.push('close:'+e.id),toast:()=>log.push('toast')});
 history.listener=s=>nav.onPopState(s);nav.start(undefined);nav.activate();assert.equal(history.pushes,0,'no screen entry outside the application');
 nav.layerOpened('unknown','page');history.back();await tick();assert.deepEqual(log,['close:unknown']);
 history.back();await tick();assert.equal(history.exited,true);assert.deepEqual(log,['close:unknown']);
});
