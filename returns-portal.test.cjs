const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),G=require('./returns-portal-core.js');
const plain=value=>JSON.parse(JSON.stringify(value));
/* Public portal page with a recording fake of the Supabase client. */
function setup({garages=[{id:'g-1',name:'Garage Dupont'},{id:'g-2',name:'Garage Martin'},{id:'g-3',name:'Garage Martin'}],failures=[]}={}){
 const nodes={},calls=[],created=[];let uuid=0;
 function node(){return {hidden:false,value:'',textContent:'',className:'',disabled:false,children:[],attributes:{},append(...kids){this.children.push(...kids);},replaceChildren(...kids){this.children=[...kids];},setAttribute(k,v){this.attributes[k]=v;}};}
 const html=fs.readFileSync('returns-portal.html','utf8');
 for(const [,id] of html.matchAll(/id="([^"]+)"/g))nodes[id]=node();nodes.done.hidden=true;nodes.scanner.hidden=true;
 const db={rpc:async(name,args)=>{calls.push({name,args:plain(args)});if(name==='returns_public_garages')return {data:garages,error:null};const failure=failures.shift();if(failure)return {data:null,error:failure};return {data:args.request_id,error:null};}};
 const context={document:{getElementById:id=>nodes[id]??=node(),createElement:()=>node(),addEventListener(){},hidden:false},window:{addEventListener(){}},
  supabase:{createClient:(url,key,options)=>{created.push({url,key,options:plain(options)});return db;}},crypto:{randomUUID:()=>'req-'+(++uuid)},Html5Qrcode:class{},GaragePortal:G,console,Date};
 vm.createContext(context);vm.runInContext(fs.readFileSync('returns-portal.js','utf8'),context);
 const lineRefs=()=>nodes.lines.children.filter(c=>c.className==='line').map(c=>[c.children[0].textContent,Number(c.children[2].textContent)]);
 return {nodes,calls,created,html,lineRefs,tick:()=>new Promise(r=>setImmediate(r)),
  add(value){nodes.reference.value=value;nodes.add.onclick();},
  submit:()=>nodes.form.onsubmit({preventDefault(){}})};
}

test('the garage portal opens at once: no login, link, PIN or e-mail, and never a staff session',async()=>{
 const a=setup();await a.tick();
 assert.equal(a.nodes.form.hidden,false);assert.doesNotMatch(a.html,/password|mot de passe|e-mail|email|PIN|portalLink|\?t=/i);
 assert.deepEqual(a.created[0].options.auth,{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});
 assert.deepEqual(a.calls.map(c=>c.name),['returns_public_garages']);
});
test('only the four fields of the request are on the page, with a single action button',()=>{
 const html=fs.readFileSync('returns-portal.html','utf8');
 assert.equal(html.match(/type="submit"/g).length,1);assert.match(html,/>Retours prêts pour la collecte<\/button>/);
 for(const id of ['garage','reference','location'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.doesNotMatch(html,/fournisseur|supplier|catalogue|statut|avoir|équipe interne|historique/i);
 assert.doesNotMatch(html,/nav-layers|application\.js|returns\.js|returns-core\.js/);
 assert.doesNotMatch(html,/ui-base|nav-history|class="ui"/,'the public page shares nothing with the internal application');
 assert.match(fs.readFileSync('build.cjs','utf8'),/'returns-portal\.html','returns-portal\.css','returns-portal\.js','returns-portal-core\.js'/);
});
test('garage: a name chosen in the public list is linked; a typed or ambiguous name is sent as typed',async()=>{
 const a=setup();await a.tick();assert.deepEqual(a.nodes.garageList.children.map(o=>o.value),['Garage Dupont','Garage Martin','Garage Martin']);
 assert.deepEqual(plain(G.garage('  garage   dupont ',[{id:'g-1',name:'Garage Dupont'}])),{garage_id:'g-1',garage_name:null,label:'Garage Dupont',listed:true});
 assert.equal(G.garage('Garage Martin',[{id:'g-2',name:'Garage Martin'},{id:'g-3',name:'Garage Martin'}]).garage_id,null,'homonyms are never guessed');
 a.nodes.garage.value='Garage Inconnu';a.nodes.garage.oninput();assert.match(a.nodes.garageHint.textContent,/l’équipe vérifiera/);
 a.nodes.garage.value='garage dupont';a.nodes.garage.oninput();assert.equal(a.nodes.garageHint.textContent,'Garage reconnu.');
});
test('the portal still works when the garage list is unavailable: the name can be typed',async()=>{
 const a=setup({garages:null});await a.tick();a.nodes.garage.value='Garage Neuf';a.add('R1');a.nodes.location.value='Accueil';await a.submit();
 assert.equal(a.calls.at(-1).args.garage_name,'Garage Neuf');assert.equal(a.calls.at(-1).args.garage_id,null);
});
test('references: a repeated scan adds one piece, unknown references are kept, a line can be removed',async()=>{
 const a=setup();await a.tick();
 a.add(' gdb 1330 ');a.add('GDB 1330');a.add('REF-HORS-CATALOGUE');
 assert.deepEqual(a.lineRefs(),[['GDB 1330',2],['REF-HORS-CATALOGUE',1]]);
 a.nodes.lines.children[0].children[1].onclick();assert.deepEqual(a.lineRefs(),[['GDB 1330',1],['REF-HORS-CATALOGUE',1]]);
 a.nodes.lines.children[1].children[4].onclick();assert.deepEqual(a.lineRefs(),[['GDB 1330',1]]);
 a.add('R'.repeat(81));assert.equal(a.nodes.status.className,'error');assert.deepEqual(a.lineRefs(),[['GDB 1330',1]]);
 assert.equal(a.calls.filter(c=>c.name!=='returns_public_garages').length,0,'nothing is looked up while adding references');
});
test('submit sends exactly the public fields, then shows only a confirmation',async()=>{
 const a=setup();await a.tick();a.nodes.garage.value='Garage Dupont';a.add('GDB1330');a.add('GDB1330');a.add('X-1');a.nodes.location.value='  carton   accueil ';await a.submit();
 const call=a.calls.at(-1);assert.equal(call.name,'returns_public_submit');
 assert.deepEqual(call.args,{shop_id:'8770297c-cadb-4cc6-8b93-55a0f9bd154e',request_id:'req-1',garage_id:'g-1',garage_name:null,pickup_location:'carton accueil',case_lines:[{reference:'GDB1330',quantity:2},{reference:'X-1',quantity:1}]});
 assert.equal(a.nodes.form.hidden,true);assert.equal(a.nodes.done.hidden,false);assert.equal(a.lineRefs().length,0);
});
test('missing garage, references or location are refused before sending',async()=>{
 const a=setup();await a.tick();await a.submit();assert.match(a.nodes.status.textContent,/nom du garage/);
 a.nodes.garage.value='Garage Dupont';await a.submit();assert.match(a.nodes.status.textContent,/au moins une référence/);
 a.add('R1');await a.submit();assert.match(a.nodes.status.textContent,/Où se trouvent|où se trouvent/);
 assert.equal(a.calls.filter(c=>c.name==='returns_public_submit').length,0);
});
test('a failed send keeps the form; an identical retry reuses the request id, a changed request gets a new one',async()=>{
 const a=setup({failures:[{code:'08006',message:'network'},{code:'PT429'},{code:'08006'}]});await a.tick();
 a.nodes.garage.value='Garage Neuf';a.add('R1');a.nodes.location.value='Accueil';
 await a.submit();assert.match(a.nodes.status.textContent,/ne sera pas enregistrée deux fois/);assert.equal(a.nodes.form.hidden,false);assert.deepEqual(a.lineRefs(),[['R1',1]]);
 await a.submit();assert.match(a.nodes.status.textContent,/Trop de demandes/);
 a.add('R2');await a.submit();await a.submit();
 assert.deepEqual(a.calls.filter(c=>c.name==='returns_public_submit').map(c=>c.args.request_id),['req-1','req-1','req-2','req-2']);
 assert.equal(a.nodes.done.hidden,false);
});
test('« Nouvelle demande » starts empty; the garage name is kept for the next request',async()=>{
 const a=setup();await a.tick();a.nodes.garage.value='Garage Dupont';a.add('R1');a.nodes.location.value='Accueil';await a.submit();
 a.nodes.again.onclick();assert.equal(a.nodes.form.hidden,false);assert.equal(a.lineRefs().length,0);assert.equal(a.nodes.location.value,'');assert.equal(a.nodes.garage.value,'Garage Dupont');
 a.add('R2');a.nodes.location.value='Atelier';await a.submit();assert.equal(a.calls.at(-1).args.request_id,'req-2');
});
test('client checks mirror the server limits',()=>{
 assert.deepEqual(plain(G.LIMITS),{garage:[2,120],location:[2,160],reference:[1,80],lines:100,quantity:999});
 let lines=[];for(let i=0;i<100;i++)lines=G.addLine(lines,'R'+i).lines;assert.match(G.addLine(lines,'R100').error,/100 références/);
 lines=[{reference:'A',quantity:999}];assert.match(G.addLine(lines,'a').error,/maximale/);
 assert.equal(G.reference('A\u0007').ok,false);assert.equal(G.validate({garageName:'G',lines:[{reference:'A',quantity:1}],location:'Accueil'}),'Indiquez le nom du garage.');
 const sql=fs.readFileSync('returns-public-portal.sql','utf8');for(const fragment of ['between 2 and 120','between 2 and 160','between 1 and 80','between 1 and 100','qty>999'])assert.ok(sql.includes(fragment),fragment);
});
