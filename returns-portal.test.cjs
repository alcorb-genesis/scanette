const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),G=require('./returns-portal-core.js');
const plain=value=>JSON.parse(JSON.stringify(value));
/* Public portal page with a recording fake of the Supabase client. */
/* catalogue: what returns_public_designation answers per code — a text, null, or an Error to throw. */
function setup({garages=[{id:'g-1',name:'Garage Dupont'},{id:'g-2',name:'Garage Martin'},{id:'g-3',name:'Garage Martin'}],failures=[],catalogue={},kind='return'}={}){
 const nodes={},calls=[],created=[];let uuid=0;
 function node(){return {hidden:false,value:'',textContent:'',className:'',disabled:false,children:[],attributes:{},append(...kids){this.children.push(...kids);},replaceChildren(...kids){this.children=[...kids];},setAttribute(k,v){this.attributes[k]=v;}};}
 const html=fs.readFileSync('returns-portal.html','utf8');
 for(const [,id] of html.matchAll(/id="([^"]+)"/g))nodes[id]=node();nodes.done.hidden=true;nodes.scanner.hidden=true;
 const db={rpc:async(name,args)=>{calls.push({name,args:plain(args)});if(name==='returns_public_garages')return {data:garages,error:null};if(name==='returns_public_designation'){const answer=Object.hasOwn(catalogue,args.code)?catalogue[args.code]:null;return answer instanceof Error?{data:null,error:{code:answer.message}}:{data:answer,error:null};}const failure=failures.shift();if(failure)return {data:null,error:failure};return {data:args.request_id,error:null};}};
 const context={document:{getElementById:id=>nodes[id]??=node(),createElement:()=>node(),addEventListener(){},hidden:false},window:{addEventListener(){}},
  supabase:{createClient:(url,key,options)=>{created.push({url,key,options:plain(options)});return db;}},crypto:{randomUUID:()=>'req-'+(++uuid)},Html5Qrcode:class{},GaragePortal:G,console,Date};
 vm.createContext(context);vm.runInContext(fs.readFileSync('returns-portal.js','utf8'),context);
 /* The type of the request is chosen by the garage; tests that are not about it choose « Retour client ». */
 if(kind==='return')nodes.kindReturn.checked=true;if(kind==='warranty')nodes.kindWarranty.checked=true;
 const lineRefs=()=>nodes.lines.children.filter(c=>c.className==='line').map(c=>[c.children[0].children[0].textContent,Number(c.children[2].textContent)]);
 const designations=()=>nodes.lines.children.filter(c=>c.className==='line').map(c=>{const label=c.children[0].children[1];return label.hidden?null:[label.textContent,label.className];});
 return {nodes,calls,created,html,lineRefs,designations,tick:()=>new Promise(r=>setImmediate(r)),
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
 assert.deepEqual(a.calls.filter(c=>c.name!=='returns_public_garages').map(c=>[c.name,c.args.code]),[['returns_public_designation','GDB 1330'],['returns_public_designation','REF-HORS-CATALOGUE']],'one designation question per new reference, none for a repeated scan or a refused entry');
});
test('submit sends exactly the public fields, then shows only a confirmation',async()=>{
 const a=setup();await a.tick();a.nodes.garage.value='Garage Dupont';a.add('GDB1330');a.add('GDB1330');a.add('X-1');a.nodes.location.value='  carton   accueil ';await a.submit();
 const call=a.calls.at(-1);assert.equal(call.name,'returns_public_submit_typed');
 assert.deepEqual(call.args,{shop_id:'8770297c-cadb-4cc6-8b93-55a0f9bd154e',request_id:'req-1',garage_id:'g-1',garage_name:null,pickup_location:'carton accueil',case_lines:[{reference:'GDB1330',quantity:2},{reference:'X-1',quantity:1}],case_type:'return'});
 assert.equal(a.nodes.form.hidden,true);assert.equal(a.nodes.done.hidden,false);assert.equal(a.lineRefs().length,0);
});
test('missing garage, references or location are refused before sending',async()=>{
 const a=setup();await a.tick();await a.submit();assert.match(a.nodes.status.textContent,/nom du garage/);
 a.nodes.garage.value='Garage Dupont';await a.submit();assert.match(a.nodes.status.textContent,/au moins une référence/);
 a.add('R1');await a.submit();assert.match(a.nodes.status.textContent,/Où se trouvent|où se trouvent/);
 assert.equal(a.calls.filter(c=>c.name==='returns_public_submit_typed').length,0);
});
test('a failed send keeps the form; an identical retry reuses the request id, a changed request gets a new one',async()=>{
 const a=setup({failures:[{code:'08006',message:'network'},{code:'PT429'},{code:'08006'}]});await a.tick();
 a.nodes.garage.value='Garage Neuf';a.add('R1');a.nodes.location.value='Accueil';
 await a.submit();assert.match(a.nodes.status.textContent,/ne sera pas enregistrée deux fois/);assert.equal(a.nodes.form.hidden,false);assert.deepEqual(a.lineRefs(),[['R1',1]]);
 await a.submit();assert.match(a.nodes.status.textContent,/Trop de demandes/);
 a.add('R2');await a.submit();await a.submit();
 assert.deepEqual(a.calls.filter(c=>c.name==='returns_public_submit_typed').map(c=>c.args.request_id),['req-1','req-1','req-2','req-2']);
 assert.equal(a.nodes.done.hidden,false);
});
test('« Nouvelle demande » starts empty; the garage name is kept for the next request',async()=>{
 const a=setup();await a.tick();a.nodes.garage.value='Garage Dupont';a.add('R1');a.nodes.location.value='Accueil';await a.submit();
 a.nodes.again.onclick();assert.equal(a.nodes.form.hidden,false);assert.equal(a.lineRefs().length,0);assert.equal(a.nodes.location.value,'');assert.equal(a.nodes.garage.value,'Garage Dupont');
 a.add('R2');a.nodes.location.value='Atelier';assert.equal(a.nodes.kindReturn.checked,false,'the type is asked again');a.nodes.kindReturn.checked=true;await a.submit();assert.equal(a.calls.at(-1).args.request_id,'req-2');
});
test('the type is chosen by the garage, never preselected, and sent with the request',async()=>{
 const html=fs.readFileSync('returns-portal.html','utf8');assert.match(html,/<input id="kindReturn" type="radio" name="kind" value="return" required> Retour client<\/label>/);assert.match(html,/<input id="kindWarranty" type="radio" name="kind" value="warranty"> Garantie<\/label>/);assert.doesNotMatch(html,/name="kind"[^>]*checked/);
 const a=setup({kind:''});await a.tick();a.nodes.garage.value='Garage Dupont';a.add('R1');a.nodes.location.value='Accueil';await a.submit();
 assert.match(a.nodes.status.textContent,/type de la demande : retour client ou garantie/);assert.equal(a.calls.filter(c=>c.name==='returns_public_submit_typed').length,0,'nothing is sent without a type');
 a.nodes.kindWarranty.checked=true;await a.submit();assert.equal(a.calls.at(-1).name,'returns_public_submit_typed');assert.equal(a.calls.at(-1).args.case_type,'warranty');assert.equal(a.nodes.done.hidden,false);
 a.nodes.again.onclick();assert.equal(a.nodes.kindWarranty.checked,false,'the next request chooses again');
 const b=setup();await b.tick();b.nodes.garage.value='Garage Dupont';b.add('R1');b.nodes.location.value='Accueil';await b.submit();assert.equal(b.calls.at(-1).args.case_type,'return');
 assert.equal(G.payload({shopId:'s',requestId:'r',garageName:'G',list:[],lines:[],location:'x',type:'mixed'}).case_type,null,'no other type leaves the page');
 const sql=fs.readFileSync('returns-roles.sql','utf8');assert.match(sql,/if coalesce\(case_type,''\) not in \('return','warranty'\) then raise exception 'Invalid type'/);assert.match(sql,/answer:=public\.returns_public_submit\(shop_id,request_id,garage_id,garage_name,pickup_location,case_lines\);/,'the checks and limits of the public request are the former ones');
});
test('client checks mirror the server limits',()=>{
 assert.deepEqual(plain(G.LIMITS),{garage:[2,120],location:[2,160],reference:[1,80],lines:100,quantity:999});
 let lines=[];for(let i=0;i<100;i++)lines=G.addLine(lines,'R'+i).lines;assert.match(G.addLine(lines,'R100').error,/100 références/);
 lines=[{reference:'A',quantity:999}];assert.match(G.addLine(lines,'a').error,/maximale/);
 assert.equal(G.reference('A\u0007').ok,false);assert.equal(G.validate({garageName:'G',lines:[{reference:'A',quantity:1}],location:'Accueil'}),'Indiquez le nom du garage.');
 const sql=fs.readFileSync('returns-public-portal.sql','utf8');for(const fragment of ['between 2 and 120','between 2 and 160','between 1 and 80','between 1 and 100','qty>999'])assert.ok(sql.includes(fragment),fragment);
});
/* Designation of a recognised reference: what the part is, straight from the shared catalogue. */
test('a recognised reference shows its designation under the reference, which stays first',async()=>{
 const a=setup({catalogue:{'LX 1780':'  Filtre   à air ','4047024000001':'Biellette de direction'}});await a.tick();
 a.add('lx 1780');assert.deepEqual(a.lineRefs(),[['LX 1780',1]],'the line is on screen before any answer');assert.deepEqual(a.designations(),[null]);
 await a.tick();assert.deepEqual(a.designations(),[['Filtre à air','designation']]);
 a.add('4047024000001');await a.tick();assert.deepEqual(a.designations(),[['Filtre à air','designation'],['Biellette de direction','designation']]);
 const card=a.nodes.lines.children[0];assert.equal(card.children[0].className,'what');assert.equal(card.children[0].children[0].textContent,'LX 1780');assert.equal(card.children.length,5,'same controls as before: − quantity + Retirer');
 a.add('LX 1780');await a.tick();assert.deepEqual(a.lineRefs()[0],['LX 1780',2]);
 assert.equal(a.calls.filter(c=>c.name==='returns_public_designation').length,2,'a repeated scan asks nothing again');
 assert.deepEqual(a.calls.find(c=>c.name==='returns_public_designation').args,{shop_id:'8770297c-cadb-4cc6-8b93-55a0f9bd154e',code:'LX 1780'},'only the shop and the code are sent');
});
test('without a reliable designation the line says so discreetly and the request still goes through',async()=>{
 const a=setup({catalogue:{'SANS-NOM':'','VIDE':'   ','OBJET':{description:'x',location:'A1'},'NOMBRE':42}});await a.tick();
 for(const code of ['SANS-NOM','VIDE','OBJET','NOMBRE','HORS-CATALOGUE'])a.add(code);await a.tick();
 assert.deepEqual(a.designations(),Array(5).fill(['Désignation non renseignée','designation none']));
 a.nodes.garage.value='Garage Dupont';a.nodes.location.value='Accueil';await a.submit();
 assert.equal(a.calls.at(-1).name,'returns_public_submit_typed');assert.equal(a.calls.at(-1).args.case_lines.length,5);assert.equal(a.nodes.done.hidden,false);
});
test('a failed or missing lookup shows nothing false and never blocks adding or sending',async()=>{
 const a=setup({catalogue:{'R1':Error('PGRST202'),'R2':Error('42501'),'R3':'Filtre à huile'}});await a.tick();
 a.add('R1');a.add('R2');a.add('R3');await a.tick();
 assert.deepEqual(a.designations(),[null,null,['Filtre à huile','designation']]);assert.notEqual(a.nodes.status.className,'error','no error is shown to the garage');
 a.nodes.garage.value='Garage Dupont';a.nodes.location.value='Accueil';await a.submit();assert.equal(a.nodes.done.hidden,false);
});
test('a designation never changes what is sent: reference and quantity only',async()=>{
 const a=setup({catalogue:{'LX 1780':'Filtre à air'}});await a.tick();a.nodes.garage.value='Garage Dupont';a.add('LX 1780');await a.tick();a.nodes.location.value='Accueil';await a.submit();
 assert.deepEqual(a.calls.at(-1).args.case_lines,[{reference:'LX 1780',quantity:1}]);
 assert.deepEqual(Object.keys(a.calls.at(-1).args).sort(),['case_lines','case_type','garage_id','garage_name','pickup_location','request_id','shop_id']);
});
test('internal data stays out of the garage access: the page asks one text and can show nothing else',()=>{
 const page=fs.readFileSync('returns-portal.js','utf8'),core=fs.readFileSync('returns-portal-core.js','utf8'),html=fs.readFileSync('returns-portal.html','utf8');
 assert.deepEqual([...page.matchAll(/rpc\('([a-z_]+)'/g)].map(m=>m[1]).sort(),['returns_public_designation','returns_public_garages','returns_public_submit_typed']);
 assert.doesNotMatch(page+core,/shared_|session_token|\.from\(|location\s*:\s*[a-z]+\.location|stock|prix|price|supplier|fournisseur|tracked_|updated_at|order_reference|barcode/i);
 assert.doesNotMatch(html,/emplacement|stock|prix|fournisseur|historique/i);
 // Whatever a wrong or hostile answer contains, only a plain bounded text can reach the screen.
 for(const answer of [{description:'Filtre',location:'A19a',stock_quantity:7},['Filtre','A19a'],null,undefined,7,true])assert.equal(G.designation(answer),'');
 assert.equal(G.designation('Filtre\u0000 à\n air'),'Filtre à air');assert.equal(G.designation('x'.repeat(500)).length,120);
 assert.deepEqual(plain(G.describe(undefined)),{text:'',known:false});assert.deepEqual(plain(G.describe('')),{text:'Désignation non renseignée',known:false});assert.deepEqual(plain(G.describe('Filtre à air')),{text:'Filtre à air',known:true});
});
test('the server function answers one text, for an open portal, on an exact code only',()=>{
 const sql=fs.readFileSync('returns-public-designation.sql','utf8'),body=sql.replace(/^--.*$/gm,'');
 assert.match(body,/returns_public_designation\(shop_id uuid,code text\)\s+returns text /);assert.doesNotMatch(body,/returns table|returns setof|returns json/i);
 assert.match(body,/returns_public_portals c where c\.workspace_id=shop_id and c\.enabled/);assert.match(body,/errcode='42501'/);assert.match(body,/between 1 and 80/);
 assert.doesNotMatch(body,/\blike\b|ilike|~\*|p\.location|stock_|order_reference|catalogue_enrichment|insert |update |delete /i,'no pattern search, no internal column, no write');
 assert.match(body,/if found_count=1 then/,'several different designations are never guessed');
 assert.doesNotMatch(sql,/\$\$|^\s*(begin|commit)\s*;/mi,'pastes as is in the Supabase SQL Editor');
 assert.match(body,/revoke all on function public\.returns_public_designation\(uuid,text\) from public;/);
 assert.match(fs.readFileSync('returns-public-designation.rollback.sql','utf8'),/drop function if exists public\.returns_public_designation\(uuid,text\);/);
});
