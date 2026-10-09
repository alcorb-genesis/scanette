const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const tick=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
/* Application shell with the real history controller and a joint-session-history model. */
function setup({confirmAnswer=false}={}){
 const nodes={},docEvents={},events={},posted=[];
 function node(){return {dataset:{},hidden:false,textContent:'',value:'',disabled:false,children:[],replaceChildren(){this.children=[]},append(n){this.children.push(n);n.parentNode=this},remove(){},get firstChild(){return this.children[0]}};}
 const history={entries:[{state:null},{state:null}],index:1,exited:false,pushes:0,
  get state(){return this.entries[this.index].state;},
  pushState(s,_t,u){this.entries.splice(this.index+1);this.entries.push({state:structuredClone(s),url:u});this.index++;this.pushes++;c.location.hash=u||c.location.hash;},
  replaceState(s,_t,u){this.entries[this.index]={state:structuredClone(s),url:u};if(u)c.location.hash=u;},
  back(){this.go(-1);},
  go(d){setImmediate(()=>{const t=this.index+d;if(t<1){this.exited=true;return;}if(t>=this.entries.length)return;this.index=t;events.popstate?.({state:this.entries[t].state});});}};
 const c={URLSearchParams,structuredClone,SharedAccess:{enter:async()=>{},leave(){}},confirm:()=>confirmAnswer,
  document:{getElementById:id=>nodes[id]??=node(),querySelectorAll:()=>[],createElement:()=>{const frame={...node(),contentWindow:{postMessage:(m,o)=>posted.push({m,o})}};return frame;},addEventListener:(k,f)=>docEvents[k]=f},
  window:{addEventListener:(k,f)=>events[k]=f},history,location:{hash:'',search:'',origin:'https://example.test'},clearTimeout(){},setTimeout:(f,ms)=>{if(!ms)f();return 1;}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('nav-history.js','utf8'),c);vm.runInContext(fs.readFileSync('application.js','utf8'),c);
 const frame=()=>nodes.module.firstChild;
 const message=data=>events.message({origin:'https://example.test',source:frame().contentWindow,data});
 return {nodes,events,history,posted,frame,message,
  // Shared access: choosing « Accès logistique » opens the workspace, without credentials.
  async login(){await tick();nodes.openLogistics.onclick();await tick();},
  tap(){docEvents.pointerdown?.({});},
  click(s){docEvents.pointerdown?.({});docEvents.click({target:{closest:()=>({dataset:{section:s}})}});},
  async back(){history.back();await tick();},
  setConfirm(v){c.confirm=()=>v;}};
}
const shown=a=>a.frame()?.src||'home';

test('Android Back: section → home → warning → leave',async()=>{
 const a=setup();await a.login();assert.equal(a.history.pushes,0,'nothing pushed before the user acts');
 a.click('scan');assert.equal(shown(a),'index.html?embedded=1');
 await a.back();assert.equal(shown(a),'home');assert.equal(a.nodes.home.hidden,false);assert.equal(a.history.exited,false);
 await a.back();assert.equal(a.history.exited,false);assert.equal(a.nodes.backHint.hidden,false,'root warning shown');assert.equal(shown(a),'home');
 await a.back();assert.equal(a.history.exited,true,'second Back at root leaves the application');
});
test('Back closes the module layer first, then leaves the section',async()=>{
 const a=setup();await a.login();a.click('returns');const frame=a.frame();
 a.message({type:'alcorb-activated'});a.message({type:'alcorb-layer',action:'open',id:'editor'});a.message({type:'alcorb-layer',action:'open',id:'scanner'});
 await a.back();assert.equal(a.frame(),frame,'same module still open');assert.equal(JSON.stringify(a.posted.map(p=>p.m)),JSON.stringify([{type:'alcorb-back',id:'scanner'}]));assert.equal(a.posted[0].o,'https://example.test');
 a.message({type:'alcorb-layer',action:'closed',id:'editor'});await a.back();await a.back();
 assert.equal(shown(a),'home');assert.equal(JSON.stringify(a.posted.map(p=>p.m.id)),JSON.stringify(['scanner']),'the editor closed by its own button is not closed twice');
});
test('Back from a section with unsaved changes asks; refusing keeps the section',async()=>{
 const a=setup({confirmAnswer:false});await a.login();a.click('receipts');const frame=a.frame();a.message({type:'alcorb-dirty',dirty:true});
 await a.back();assert.equal(a.frame(),frame);assert.equal(a.history.state.section,'receipts');
 a.setConfirm(true);await a.back();assert.equal(shown(a),'home');
});
test('module asks for another section: Back returns to the first one',async()=>{
 const a=setup();await a.login();a.click('receipts');a.message({type:'alcorb-section',section:'scan',receiptId:'11111111-1111-4111-8111-111111111111'});
 assert.equal(shown(a),'index.html?embedded=1&receipt=11111111-1111-4111-8111-111111111111');
 await a.back();assert.equal(shown(a),'logistics-sessions.html?embedded=1&kind=receipt');
 a.history.go(1);await tick();assert.equal(shown(a),'index.html?embedded=1&receipt=11111111-1111-4111-8111-111111111111','Forward restores the target too');
});
test('« ← Accueil » rewinds to home instead of adding entries; Back then warns',async()=>{
 const a=setup();await a.login();a.click('receipts');a.click('scan');a.click('home');assert.equal(shown(a),'home');await tick();
 assert.equal(a.history.state.section,'home');assert.equal(a.history.state.n,1);
 await a.back();assert.equal(a.nodes.backHint.hidden,false);await a.back();assert.equal(a.history.exited,true);
});
test('layer messages are accepted only from the active module and with a safe id',async()=>{
 const a=setup();await a.login();a.click('scan');const before=a.history.pushes;
 a.events.message({origin:'https://evil.test',source:a.frame().contentWindow,data:{type:'alcorb-layer',action:'open',id:'x'}});
 a.events.message({origin:'https://example.test',source:{},data:{type:'alcorb-layer',action:'open',id:'x'}});
 a.message({type:'alcorb-layer',action:'open',id:'bad id with spaces'});
 assert.equal(a.history.pushes,before);
});
test('a fragment link such as « Aller au contenu » is not treated as navigation',async()=>{
 const a=setup();await a.login();a.click('scan');const before=a.history.pushes;a.events.hashchange?.();
 assert.equal(shown(a),'index.html?embedded=1');assert.equal(a.history.pushes,before);
});
test('leaving resets the boundary: after reopening, Back from home warns before leaving',async()=>{
 const a=setup();await a.login();a.click('scan');await a.nodes.leave.onclick?.();
 await a.login();a.tap();await a.back();assert.equal(a.history.exited,false);assert.equal(a.nodes.backHint.hidden,false);
});
