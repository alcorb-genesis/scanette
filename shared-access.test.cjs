const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
/* Shared logistics access (8 October 2026): one shop password checked by the server, a short
   session token, no PIN, no account, a narrow server facade. No real password appears in these
   tests: the values typed below are throwaway strings answered by a fake server. */
const read=f=>fs.readFileSync(f,'utf8');
const published=()=>{execFileSync(process.execPath,['build.cjs']);const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else files.push(p);}};walk('public');return files;};
test('published site has no PIN, account login or administration screen, and one password form only',()=>{
 const files=published(),text=f=>fs.readFileSync(f,'utf8');
 for(const gone of ['pin-ui.js','team.js','store-settings.js','password-visibility.js','password-visibility.css','delivery-garages.js','gestion-bridge.js'])assert.equal(fs.existsSync('public/'+gone),false,gone);
 for(const page of ['team.html','store-settings.html'])assert.match(text('public/'+page),/http-equiv="refresh" content="0;url=application.html#home"/,page+' only redirects');
 for(const f of files.filter(f=>/\.(html|js)$/.test(f))){
  const t=text(f);
  for(const gone of ['signInWithPassword','logistics_pin','type="password"','AlcorbAuth','onAuthStateChange','password_hash','set_password','gen_salt'])assert.equal(t.includes(gone),false,f+' → '+gone);
  // The only password field of the site is the form built by shared-access.js.
  if(!f.endsWith('shared-access.js'))assert.equal(/type\s*=\s*'password'|shared_access_open/.test(t),false,f);
 }
});
test('published logistics modules never send a shop identifier nor read tables directly',()=>{
 for(const f of ['index.html','warehouse.js','receipt-link.js','scan-suppliers.js','bellecave.js','logistics-sessions.js','returns.js','preparation.js','store-partners.js','inventory/app.js','inventory/prepare.js']){
  const t=read(f);
  assert.equal(/\.from\(['"]|\/rest\/v1\/(?!rpc)|\.rpc\(/.test(t),false,f+' reads tables or RPCs outside the facade');
  assert.equal(/shop_id:|workspace_id|\{shop[,}]|shop:/.test(t),false,f+' sends a shop');
  for(const m of t.matchAll(/(?:call|one)\('([a-z_]+)'/g))assert.match(m[1],/^shared_/,f);
 }
 // Only the local storage key of preparations still names the shop, and it is never sent.
 assert.match(read('preparation.js'),/never sent/);
});
/* Functions present on the server and callable by the browser, as read on the real base on
   9 October 2026 (the SQL files are kept outside this repository for now). */
const SERVER=['shared_access_open','shared_access_close','shared_location_code','shared_products_search','shared_product_lookup','shared_products_by_references','shared_products_by_ids','shared_aisles','shared_set_location','shared_aliases_page','shared_aliases_save','shared_partners','shared_save_partner','shared_sessions','shared_session','shared_save_session','shared_returns','shared_return_events','shared_save_return','shared_inventory_current','shared_inventory_lists','shared_inventory_publish','shared_inventory_revoke'];
const MIGRATION='logistics-shared-access.sql',noMigration=!fs.existsSync(MIGRATION)&&'the migration file is not part of this repository yet';
test('every shared function used by the pages exists on the server',()=>{
 const used=new Set();
 for(const f of ['index.html','warehouse.js','receipt-link.js','scan-suppliers.js','bellecave.js','logistics-sessions.js','returns.js','preparation.js','store-partners.js','inventory/app.js','inventory/prepare.js'])for(const m of read(f).matchAll(/'(shared_[a-z_]+)'/g))if(m[1]!=='shared_access')used.add(m[1]);
 for(const m of read('shared-access.js').matchAll(/rpc\('(shared_access_[a-z_]+)'/g))used.add(m[1]);
 assert.ok(used.size>=18,[...used].join());
 for(const name of used)assert.ok(SERVER.includes(name),name+' is not a function of the server');
 // None of the functions kept for the server alone is called from a page.
 for(const closed of ['shared_shop','shared_access_set_password'])assert.equal(used.has(closed),false,closed);
});
test('the migration file, when present, defines and grants every function the pages use',{skip:noMigration},()=>{
 const sql=read(MIGRATION);
 for(const name of SERVER){assert.match(sql,new RegExp('create or replace function public\\.'+name+'\\('),name);assert.match(sql,new RegExp("'"+name+"\\("),name+' granted');}
 assert.match(sql,/to anon,authenticated/);assert.equal(/grant[^;]*on table[^;]*to anon/i.test(sql),false,'no table is granted to anon');
});
test('the risk of the shared access is written down',()=>{
 const doc=read('SHARED-ACCESS.md');assert.match(doc,/[Tt]oute personne qui connaît le mot de passe/);assert.match(doc,/Équipe|équipe/);assert.match(doc,/garage/);
});

/* --- Password and session ------------------------------------------------------------------- */
const TOKEN='c0'.repeat(32);
function browser({accept='throwaway-test-value',expired=false}={}){
 const store=new Map(),rpcs=[],forms=[];let live=new Set();
 const el=tag=>({tag,children:[],style:{},listeners:{},attrs:{},value:'',textContent:'',append(...n){this.children.push(...n)},remove(){this.removed=true},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false},focus(){}});
 const document={createElement:tag=>{const n=el(tag);if(tag==='dialog')forms.push(n);return n;},body:el('body')};
 const context={document,Date,Promise,JSON,Error,Object,Array,sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  supabase:{createClient:()=>({rpc:async(name,args)=>{rpcs.push({name,args:{...args}});
   if(name==='shared_access_open'){if(args.password!==accept)return {data:[],error:null};live.add(TOKEN);return {data:[{token:TOKEN,expires_at:new Date(Date.now()+(expired?-1:3600e3)).toISOString()}],error:null};}
   if(name==='shared_access_close'){live.delete(args.session_token);return {data:null,error:null};}
   if(!live.has(args.session_token))return {data:null,error:{code:'PT401',message:'Session required'}};
   return {data:[{ok:true}],error:null};}})}};
 context.globalThis=context;vm.createContext(context);vm.runInContext(read('shared-access.js'),context);
 const find=(n,tag)=>n.tag===tag?n:n.children.map(c=>find(c,tag)).find(Boolean);
 const type=async value=>{const box=forms.at(-1),form=find(box,'form');find(box,'input').value=value;await form.onsubmit({preventDefault(){}});return box;};
 return {SA:context.SharedAccess,store,rpcs,forms,find,type,end:()=>live.clear()};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('no data call leaves the browser before the server has accepted the password',async()=>{
 const b=browser(),pending=b.SA.call('shared_aisles');await settle();
 assert.equal(b.rpcs.length,0,'nothing sent before the password');assert.equal(b.forms.length,1);
 const input=b.find(b.forms[0],'input');assert.equal(input.type,'password');
 await b.type('throwaway-test-value');assert.deepEqual(await pending,[{ok:true}]);
 assert.deepEqual(b.rpcs.map(r=>r.name),['shared_access_open','shared_aisles']);
 assert.equal(b.rpcs[1].args.session_token,TOKEN);assert.equal(input.value,'','the field is emptied');
 // What the tab keeps is the token and its expiry — never what was typed.
 assert.deepEqual(Object.keys(JSON.parse(b.store.get('repclick_shared_session_v1'))).sort(),['expires_at','token']);
 assert.equal([...b.store.values()].join().includes('throwaway-test-value'),false);
 await b.SA.call('shared_partners',{partner_kind:null});assert.equal(b.forms.length,1,'the session is reused');
});
test('a wrong password opens nothing and can be retried; cancelling rejects the call',async()=>{
 const b=browser(),pending=b.SA.call('shared_aisles');await settle();
 const box=await b.type('not-the-one');assert.equal(b.store.size,0);assert.equal(box.removed,undefined);
 assert.match(JSON.stringify(box),/Mot de passe incorrect/);assert.equal(b.rpcs.filter(r=>r.name!=='shared_access_open').length,0);
 await b.type('throwaway-test-value');await pending;
 const c=browser(),refused=c.SA.call('shared_aisles');await settle();
 c.find(c.forms[0],'div').children[0].onclick();await assert.rejects(refused,e=>e.code==='CANCELLED');assert.equal(c.rpcs.length,0);
});
test('several calls share one form; an ended session asks again once and repeats the call',async()=>{
 const b=browser(),all=Promise.all([b.SA.call('shared_aisles'),b.SA.call('shared_returns',{max_rows:5}),b.SA.enter()]);await settle();
 assert.equal(b.forms.length,1);await b.type('throwaway-test-value');await all;
 b.end();const again=b.SA.call('shared_aisles');await settle();
 assert.equal(b.forms.length,2,'PT401 → the form comes back');assert.equal(b.store.size,0,'the dead token is dropped');
 await b.type('throwaway-test-value');assert.deepEqual(await again,[{ok:true}]);
});
test('a token already expired for the browser is never sent',async()=>{
 const b=browser({expired:true}),pending=b.SA.call('shared_aisles').catch(e=>e);await settle();await b.type('throwaway-test-value');await settle();
 assert.equal(b.SA.active(),false);assert.equal(b.rpcs.some(r=>r.name==='shared_aisles'),false);assert.equal(b.forms.length,2);
 b.find(b.forms[1],'div').children[0].onclick();assert.equal((await pending).code,'CANCELLED');
});
test('leaving ends the session on the server and in the tab; session functions are not callable as data',async()=>{
 const b=browser(),p=b.SA.enter();await settle();await b.type('throwaway-test-value');await p;assert.equal(b.SA.active(),true);
 await b.SA.leave();assert.equal(b.SA.active(),false);assert.equal(b.store.size,0);assert.deepEqual(b.rpcs.at(-1),{name:'shared_access_close',args:{session_token:TOKEN}});
 for(const name of ['shared_access_open','shared_access_set_password','shared_access_close'])await assert.rejects(b.SA.call(name,{}),/non autorisée/);
});
test('migration: every shared function requires the session, and the password is a placeholder only',{skip:noMigration},()=>{
 const sql=read(MIGRATION),code=sql.split('\n').filter(l=>!l.startsWith('--')).join('\n');
 assert.equal(/public\.shared_shop\(\)/.test(code.replace(/drop function if exists public\.shared_shop\(\);/,'')),false,'no gate without a session');
 const fns=[...code.matchAll(/create or replace function public\.(shared_[a-z_]+)\(([^)]*)\)([\s\S]*?)\$\$;/g)];assert.ok(fns.length>=25,String(fns.length));
 for(const [,name,args,body] of fns){
  if(['shared_shop','shared_location_code','shared_access_open','shared_access_close','shared_access_set_password'].includes(name))continue;
  assert.match(args,/session_token text default null$/,name);assert.match(body,/public\.shared_shop\(session_token\)/,name);
 }
 // Old, unprotected signatures are dropped; the password setter is closed to every application role.
 assert.match(code,/drop function if exists public\.shared_shop\(\);/);assert.match(code,/'shared_inventory_revoke\(uuid\)'[^;]*loop\s+execute 'drop function if exists public\.'\|\|f/);
 assert.match(code,/revoke all on function public\.shared_access_set_password\(text\) from public,anon,authenticated,service_role;/);
 assert.equal(/'shared_access_set_password/.test(code.slice(code.indexOf('-- 8.'))),false);
 // No statement sets a password or a hash: the only call is the commented placeholder.
 assert.equal(/shared_access_set_password\('/.test(code),false);assert.equal(/password_hash\s*=\s*'|values\([^)]*\$2[aby]\$/.test(code),false);
 const calls=[...sql.matchAll(/shared_access_set_password\('([^']*)'\)/g)].map(m=>m[1]);
 assert.deepEqual(calls,['<MOT_DE_PASSE_LOGISTIQUE_A_SAISIR_A_LA_MAIN>']);assert.match(code,/new_password ~ '\^<\.\*>\$'/,'the placeholder itself is refused');
});
test('no source file carries a password, a bcrypt hash or a session token',()=>{
 const skip=new Set(['.git','node_modules','public','private-import']),files=[];
 const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(skip.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(js|cjs|mjs|ts|html|sql|md|json|css)$/.test(e.name)&&fs.statSync(p).size<2e6)files.push(p);}};walk('.');
 for(const f of files){const t=read(f);
  assert.equal(/\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/.test(t),false,f+' holds a bcrypt hash');
  assert.equal(/(mot de passe|password)\s*(logistique|partagé|du magasin)?\s*(est|is|:|=)\s*['"«“][^'"»”<>{}$]{6,}['"»”]/i.test(t)&&!f.endsWith('.test.cjs'),false,f+' seems to state a password');
 }
});
