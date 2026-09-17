const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(){
 const nodes=new Map(), data=new Map(), calls=[];
 const element=()=>({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},value:'',textContent:'',innerHTML:'',hidden:true,dataset:{},addEventListener(){},appendChild(){},querySelector(){return element()},querySelectorAll(){return []},click(){}});
 const doc={getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)},createElement:element,addEventListener(){},visibilityState:'visible'};
 let session={user:{id:'alice'},access_token:'fresh'};
 const context={document:doc,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},console,
 setTimeout:()=>0,clearTimeout(){},setInterval(){},alert(){},confirm:()=>false,URL,Blob,
 navigator:{},supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session}}),onAuthStateChange(){},signOut:async()=>{},signInWithPassword:async()=>({data:{session}})}})},
 fetch:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>[]}},addEventListener(){}};
 context.window=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync('core.js','utf8'),context);
 const html=fs.readFileSync('index.html','utf8');
 for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],context);
 return {context,data,calls,setSession:s=>session=s,run:code=>vm.runInContext(code,context)};
}
test('production app loads, uses refreshed auth and persists a scan only to its account',async()=>{
 const h=harness();await new Promise(resolve=>setImmediate(resolve));
 await h.run('synchronize()');h.calls.length=0;
 h.setSession({user:{id:'alice'},access_token:'renewed'});
 await h.run('synchronize()');
 assert.equal(h.calls[0].opts.headers.Authorization,'Bearer renewed');
 h.run("bumpRef('ABC123',2)");
 const saved=JSON.parse(h.data.get('scanette_account_v1:alice'));
 assert.equal(saved.sections[0].items.ABC123.qty,2);
 h.run("showApp({user:{id:'bob'},access_token:'bob-token'})");
 assert.equal(h.run('sections.length'),0);
 assert.equal(JSON.parse(h.data.get('scanette_account_v1:alice')).sections[0].items.ABC123.qty,2);
});
test('signout clears inventory and hides sensitive reference state',async()=>{
 const h=harness();await new Promise(resolve=>setImmediate(resolve));await h.run('synchronize()');
 h.run("bumpRef('ABC123',2); clearAccount()");
 assert.equal(h.run('currentUserId'),null);assert.equal(h.run('sections.length'),0);
 assert.equal(h.run('Object.keys(aliases).length'),0);
});
test('upload failure retains pending changes for retry',async()=>{
 const h=harness();await new Promise(resolve=>setImmediate(resolve));await h.run('synchronize()');
 h.context.fetch=async()=>({ok:false,status:503});
 h.run("queueAlias('12345','REF')");await h.run('synchronize()');
 assert.equal(h.run('pushQueue.length'),1);
 assert.equal(JSON.parse(h.data.get('scanette_account_v1:alice')).pushQueue.length,1);
});
