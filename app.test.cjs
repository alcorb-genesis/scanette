const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const TOKEN='ab'.repeat(32);
function harness(){
 const nodes=new Map(), data=new Map(), calls=[], alerts=[], clients=[];
 const element=()=>({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},value:'',textContent:'',innerHTML:'',hidden:true,dataset:{},listeners:{},addEventListener(type,fn){this.listeners[type]=fn},focus(){this.focused=(this.focused||0)+1},pause(){},appendChild(){},append(){},replaceChildren(){},insertAdjacentElement(){},setAttribute(){},showModal(){this.open=true},close(){this.open=false},querySelector(){return element()},querySelectorAll(){return []},click(){}});
 const doc={body:element(),head:element(),createElementNS:element,getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)},createElement:element,addEventListener(){},visibilityState:'visible'};
 // A session already open in the tab: a random-looking test token, never a password.
 const session=new Map([['repclick_shared_session_v1',JSON.stringify({token:TOKEN,expires_at:new Date(Date.now()+3600e3).toISOString()})]]);
 const context={document:doc,sessionStorage:{getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},console,
 setTimeout:()=>0,clearTimeout(){},setInterval(){},alert(message){alerts.push(message)},confirm:()=>false,URL,Blob,
 navigator:{},
 // Same wire format as supabase-js: an RPC is a POST to /rest/v1/rpc/<name>. No auth API is offered:
 // the shared access must never need one.
 supabase:{createClient:(url,key,options)=>{clients.push({url,key,options});return {rpc:async(name,args)=>{const r=await context.fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key},body:JSON.stringify(args)});if(!r.ok){const body=r.json?await r.json().catch(()=>({})):{};return {data:null,error:{code:body?.code||String(r.status),message:body?.message||'HTTP '+r.status}};}return {data:await r.json(),error:null};}};}},
 fetch:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>[]}},addEventListener(){}};
 context.window=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync('shared-access.js','utf8'),context);
 vm.runInContext(fs.readFileSync('core.js','utf8'),context);
 vm.runInContext(fs.readFileSync('scan-input-core.js','utf8'),context);
 const html=fs.readFileSync('index.html','utf8');
 for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],context);
 return {context,data,calls,alerts,nodes,clients,rpc:name=>calls.filter(c=>c.url.endsWith('/rpc/'+name)).map(c=>JSON.parse(c.opts.body)),run:code=>vm.runInContext(code,context)};
}
test('scanner page has no login screen of its own, no account, and persists to the shared pointage',async()=>{
 const html=fs.readFileSync('index.html','utf8');
 for(const gone of ['loginScreen','loginEmail','loginPass','logoutBtn','signInWithPassword','getSession','onAuthStateChange','authenticatedFetch','password-visibility','pin-ui'])assert.equal(html.includes(gone),false,gone);
 assert.ok(html.indexOf('shared-access.js')<html.indexOf('<script>'),'shared access loads before the page script');
 const h=harness();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.run('currentUserId'),'shared');assert.equal(h.nodes.get('appRoot')?.style.display,undefined);
 // The client never keeps a staff session on the device.
 assert.deepEqual(JSON.parse(JSON.stringify(h.clients[0].options.auth)),{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});
 h.run("bumpRef('ABC123',2)");
 assert.equal(JSON.parse(h.data.get('scanette_account_v1:shared')).sections[0].items.ABC123.qty,2);
});
test('shared catalogue sync goes only through shared functions and never names a shop',async()=>{
 const h=harness();await new Promise(resolve=>setImmediate(resolve));await h.run('synchronize()');
 h.run("queueAlias('12345','REF')");await h.run('synchronize()');
 assert.deepEqual(h.rpc('shared_aliases_save').at(-1),{rows:[{ean:'12345',ref:'REF'}],session_token:TOKEN});
 assert.ok(h.rpc('shared_aliases_page').length>=1);
 for(const c of h.calls){assert.match(c.url,/\/rest\/v1\/rpc\/shared_[a-z_]+$/);assert.equal(/workspace|shop/.test(c.opts.body||''),false);assert.equal(c.opts.headers.Authorization,undefined);}
});
test('upload failure retains pending changes for retry',async()=>{
 const h=harness();await new Promise(resolve=>setImmediate(resolve));await h.run('synchronize()');
 h.context.fetch=async()=>({ok:false,status:503});
 h.run("queueAlias('12345','REF')");await h.run('synchronize()');
 assert.equal(h.run('pushQueue.length'),1);
 assert.equal(JSON.parse(h.data.get('scanette_account_v1:shared')).pushQueue.length,1);
});
test('a pointage saved under a former account is offered once and its original is kept',()=>{
 const data=new Map([['scanette_account_v1:0b8f7c3e-1111-4222-8333-944445555666',JSON.stringify({version:1,sections:[{name:'APO',items:{R:{qty:4,prix:null}}}],aliases:{},pushQueue:[]})]]);
 const SA=require('./shared-access.js');let asked=0;
 const storage={get length(){return data.size},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 assert.equal(SA.adoptLocal(storage,'scanette_account_v1:','scanette_account_v1:shared',()=>{asked++;return true;}),'scanette_account_v1:0b8f7c3e-1111-4222-8333-944445555666');
 assert.equal(JSON.parse(data.get('scanette_account_v1:shared')).sections[0].items.R.qty,4);
 assert.ok(data.has('scanette_account_v1:0b8f7c3e-1111-4222-8333-944445555666'));
 assert.equal(SA.adoptLocal(storage,'scanette_account_v1:','scanette_account_v1:shared',()=>{asked++;return true;}),null);assert.equal(asked,1);
});
test('shared access refuses any function outside the shared facade',async()=>{
 const SA=require('./shared-access.js');
 for(const name of ['logistics_save_session','gestion_save_partner','inventory_create_invite','logistics_pin_attempt','shared_x;drop'])await assert.rejects(SA.call(name,{}),/non autorisée/);
});

module.exports={harness,TOKEN};

