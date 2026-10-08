const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
/* Returns screen (lot 5): sober header, steps, foldable round services, several services per case,
   editable element names. A small DOM, enough to run returns.js as the browser does. */
const html=fs.readFileSync('returns.html','utf8');
function dom(){
 const byId=new Map();
 const make=tag=>{const n={tag,children:[],dataset:{},attrs:{},style:{},className:'',hidden:false,disabled:false,value:'',checked:false,open:false,_text:'',
  get textContent(){return this._text+this.children.map(c=>c.textContent??'').join('');},set textContent(v){this._text=String(v);this.children=[];},
  append(...nodes){for(const c of nodes){if(c&&typeof c==='object'){c.parent=this;this.children.push(c);}}},after(){},
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);},remove(){},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},
  addEventListener(){},scrollIntoView(){},reset(){for(const c of all(this))if(c.tag==='input'||c.tag==='select')c.value='';},
  querySelectorAll(sel){return all(this).filter(c=>sel==='input:checked'?c.tag==='input'&&c.checked:sel==='details'?c.tag==='details':c.className.split(' ').includes(sel.replace('.','')));},
  querySelector(sel){return this.querySelectorAll(sel)[0]||null;}};return n;};
 const all=n=>n.children.flatMap(c=>[c,...all(c)]);
 for(const m of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)){const n=make(m[1]);n.hidden=/\bhidden\b/.test(m[0].replace(/"[^"]*"/g,''));byId.set(m[2],n);}
 const document={getElementById:id=>{if(!byId.has(id))throw Error('missing #'+id);return byId.get(id);},createElement:make,createTextNode:t=>({tag:'#text',textContent:t,children:[],className:''}),addEventListener(){},hidden:false,body:make('body')};
 return {document,byId,all};
}
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const LINE={id:'l1',product_id:null,reference:'REF-1',description:'',quantity:2,received_quantity:null,condition:'',reason:''};
const row=(id,status,extra={})=>({id,version:1,created_at:'2026-10-08T08:00:00Z',updated_at:'2026-10-08T09:00:00Z',document:{type:'return',status,client_id:null,client_name:'Garage '+id,supplier_id:null,supplier_name:'',lines:[structuredClone(LINE)],...extra}});
async function start(cases){
 const {document,byId,all}=dom(),calls=[];
 const SharedAccess={ACTOR:'shared',message:()=>'fermé',call:async(name,args={})=>{calls.push({name,args:structuredClone(args)});
  if(name==='shared_returns')return structuredClone(cases);if(name==='shared_partners')return [];if(name==='shared_return_events')return [];
  if(name==='shared_products_by_references')return args.refs.includes('REF-1')?[{id:'p1',reference:'REF-1',description:'Plaquettes de frein avant',location:'A1'}]:[];
  if(name==='shared_save_return')return [{id:args.case_id,version:args.expected_version+1,created_at:'2026-10-08T08:00:00Z',updated_at:'2026-10-08T10:00:00Z',document:args.case_document}];
  throw Error('unexpected '+name);}};
 const context={document,SharedAccess,ReturnsCore:require('./returns-core.js'),Option:function(text,value){return {tag:'option',text,value,children:[]};},structuredClone,crypto:{randomUUID:()=>'new-'+(++serial)},confirm:()=>true,
  location:{origin:'https://test.local'},addEventListener(){},postMessage(){},setInterval(){},setTimeout,URL,File:class{},MutationObserver:class{observe(){}},Promise,Date,console};
 let serial=0;context.window=context;context.parent=context;vm.createContext(context);vm.runInContext(fs.readFileSync('returns.js','utf8'),context);await settle();
 const $=id=>byId.get(id),groups=()=>$('list').children.filter(n=>n.tag==='details');
 return {$,calls,groups,all,step:async label=>{$('steps').children.find(b=>b.textContent.startsWith(label)).onclick();await settle();},
  names:()=>groups().map(g=>g.children[0].children[0].textContent),cards:g=>g.querySelectorAll('.case'),
  open:async(g,i=0)=>{g.querySelectorAll('.case')[i].children.at(-1).onclick();await settle();}};
}
test('header is sober: title, search, type filter, new case — then the five steps',()=>{
 const head=html.slice(html.indexOf('<header'),html.indexOf('</header>'));assert.equal(head.replace(/<[^>]+>/g,'|').replace(/\|+/g,'|'),'|ALCORB · LOGISTIQUE|Retours et garanties|');
 for(const id of ['filter','typeFilter','new','steps','serviceChoices'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.ok(html.indexOf('id="filter"')<html.indexOf('id="steps"')&&html.indexOf('id="steps"')<html.indexOf('id="list"'));
 assert.equal(/<aside|id="statusFilter"|personne connectée/.test(html),false);
});
test('steps filter the list; « À enlever » is shown first with its count',async()=>{
 const s=await start([row('a','requested',{services:['serge']}),row('b','received',{services:['serge']}),row('c','sent'),row('d','credited')]);
 assert.deepEqual(s.$('steps').children.map(b=>b.textContent),['À enlever · 1','Au magasin · 1','Chez le fournisseur · 1','Clôturés · 1','Tous · 4']);
 assert.equal(s.$('steps').children[0].attrs['aria-pressed'],'true');
 assert.equal(s.cards(s.groups()[0]).length,1);await s.step('Tous');assert.equal(s.cards(s.groups()[0]).length,2);
 await s.step('Chez le fournisseur');assert.equal(s.cards(s.groups()[0]).length,0);assert.equal(s.groups().at(-1).children[0].children[0].textContent,'Sans tournée');
});
test('the ten round services stay visible and foldable, with or without cases',async()=>{
 const s=await start([row('a','requested',{services:['damian','paketo_bearn']})]);
 assert.deepEqual(s.names(),['Serge','Damian','Paketo Landes','Paketo Béarn','Paketo Pays Basque','Ace','Ludovic','Maxime','Charlie','Cédric']);
 const [serge,damian,,bearn]=s.groups();assert.equal(serge.open,false,'empty group starts folded');assert.equal(damian.open,true);assert.match(serge.textContent,/0 dossier/);
 // The same case under both of its services, each card naming the two.
 assert.equal(s.cards(damian).length,1);assert.equal(s.cards(bearn).length,1);assert.match(s.cards(damian)[0].textContent,/Damian[\s\S]*Paketo Béarn/);
 // Folding by hand survives a repaint (search, refresh).
 damian.children[0].onclick();s.$('filter').oninput();assert.equal(s.groups()[1].open,false);assert.equal(s.groups().length,10);
 s.$('filter').value='introuvable';s.$('filter').oninput();assert.equal(s.groups().length,10,'still listed when nothing matches');
});
test('no time of day is displayed on the screen',async()=>{
 const s=await start([row('a','requested',{services:['serge'],client_id:null})]);
 const text=s.$('list').textContent.replace(/Mis à jour [^A-Za-zÀ-ÿ]*/g,'');assert.equal(/\d{1,2}\s?[h:]\s?\d{2}/.test(text),false,text);assert.equal(/passage|départ/i.test(text),false);
});
test('a case is saved with several services; names are proposed by the catalogue and stay editable',async()=>{
 const s=await start([row('a','requested',{portal:true,source:'public_portal',pickup_location:'Carton accueil',garage_verified:false})]);
 await s.open(s.groups().at(-1));
 assert.deepEqual(s.calls.find(c=>c.name==='shared_products_by_references').args,{refs:['REF-1']});
 const name=s.$('lines').children[0].children[1].children[0];assert.equal(name.tag,'input');assert.equal(name.value,'Plaquettes de frein avant');assert.equal(name.disabled,false);
 assert.match(s.$('lines').textContent,/Proposée par le catalogue/);
 name.value='Plaquettes AV — jeu complet';name.oninput();
 const boxes=s.$('serviceChoices').querySelectorAll('input:checked');assert.equal(boxes.length,0);
 for(const box of s.all(s.$('serviceChoices')).filter(n=>n.tag==='input'&&['ludovic','paketo_pays_basque'].includes(n.value))){box.checked=true;box.onchange();}
 s.$('editor').onsubmit({preventDefault(){}});await settle();
 const saved=s.calls.find(c=>c.name==='shared_save_return').args;
 assert.deepEqual(saved.case_document.services,['paketo_pays_basque','ludovic']);assert.equal(saved.case_document.lines[0].description,'Plaquettes AV — jeu complet');
 // Garage portal fields are carried over untouched; no shop identifier, no schedule.
 assert.equal(saved.case_document.pickup_location,'Carton accueil');assert.equal(saved.case_document.source,'public_portal');
 assert.equal(/shop|workspace|departure|schedule/.test(JSON.stringify(saved)),false);
 assert.deepEqual(s.names().slice(0,10).length,10);assert.equal(s.cards(s.groups()[4]).length,1);assert.equal(s.cards(s.groups()[6]).length,1);
});
test('a typed name is never replaced, and an unknown reference keeps an empty editable name',async()=>{
 const s=await start([row('a','requested',{lines:[{...LINE,description:'Nom saisi'},{...LINE,id:'l2',reference:'INCONNUE'}]})]);
 await s.open(s.groups().at(-1));const inputs=s.$('lines').children.map(card=>card.children[1].children[0]);
 assert.deepEqual(inputs.map(i=>i.value),['Nom saisi','']);assert.equal(inputs[1].placeholder,'À compléter');assert.equal(inputs[1].disabled,false);
});
test('the public garage portal is untouched and stays isolated from the logistics screen',()=>{
 const portal=fs.readFileSync('returns-portal.html','utf8')+fs.readFileSync('returns-portal.js','utf8')+fs.readFileSync('returns-portal-core.js','utf8');
 assert.equal(/shared-access|SharedAccess|shared_[a-z]|session_token|alcorb_shared_session|returns\.js|returns-core\.js/.test(portal),false);
 const rpcs=new Set([...fs.readFileSync('returns-portal.js','utf8').matchAll(/returns_public_[a-z_]+/g)].map(m=>m[0]));assert.deepEqual([...rpcs].sort(),['returns_public_garages','returns_public_submit']);
 // The round services and the internal names are not shown to garages.
 assert.equal(/Paketo|Damian|Cédric|tournée/i.test(portal),false);
});
