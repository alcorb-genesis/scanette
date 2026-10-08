const {test}=require('node:test'),assert=require('node:assert/strict'),L=require('./location-search.js');
test('allée complète, casse, espaces et sections sans confusion A1/A10',()=>{
 assert.equal(L.code('Allée a 19'),'A19');assert.equal(L.code('A19-a'),'A19A');
 assert.ok(L.belongs('A19a','A19'));assert.ok(L.belongs('A19F','A19'));
 assert.ok(!L.belongs('A190','A19'));assert.ok(!L.belongs('A10A','A1'));assert.ok(!L.belongs('A19B','A19A'));
});
test('filtres serveur limités aux codes, sans injection ni confusion numérique',()=>{
 assert.equal(L.filter('0986478546'),null);assert.equal(L.filter('A1),id.gt.0'),null);
 assert.ok(L.filter('A19').includes('location.ilike.A19F'));assert.ok(!L.filter('A1').includes('A10'));
 assert.equal(L.filter('A19a'),'location.ilike.A19A');
});
test('annuaire multi-mots et menus ajoutent les allées parentes',()=>{
 assert.ok(L.matches({code:'A19A',description:'Disques Bosch'},'bosch disques'));
 assert.ok(L.matches({code:'A19A'},'allée A19'));assert.ok(!L.matches({code:'A10A'},'A1'));
 assert.deepEqual(L.choices([{code:'A19a'},{code:'A19B'},{code:'A2'}]),['A2','A19','A19A','A19B']);
});
test('catalogue passe la recherche et l’allée à la fonction partagée, sans magasin ni filtre de table',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),nodes=new Map(),calls=[];
 const make=()=>({value:'',hidden:false,children:[],events:{},classList:{toggle(){}},addEventListener(k,fn){this.events[k]=fn},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x},close(){},focus(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)};
 const SharedAccess={call:async(name,args)=>{calls.push({name,args});return name==='shared_aisles'?[{code:'A19F',description:'',notes:''}]:[];}};
 vm.runInNewContext(fs.readFileSync('bellecave.js','utf8'),{SharedAccess,LocationSearch:L,CatalogueEvidence:require('./catalogue-evidence.js'),document:{getElementById:get,createElement:make,addEventListener(){}},setTimeout,navigator:{},Intl});
 await new Promise(r=>setImmediate(r));assert.equal(get('catalogue').hidden,false,'open without login');
 get('query').value='Allée A19';get('searchForm').events.submit({preventDefault(){}});await new Promise(r=>setImmediate(r));
 const last=()=>calls.filter(c=>c.name==='shared_products_search').at(-1).args;
 // The server reads « Allée A19 » as a section code (A19, A19A…A19Z) as well as a reference/description term.
 assert.equal(last().search_term,'Allée A19');assert.equal(last().aisle,'');assert.equal(get('aisles').open,true);
 get('query').value='A123';get('searchForm').events.submit({preventDefault(){}});await new Promise(r=>setImmediate(r));
 assert.equal(last().search_term,'A123');
 for(const c of calls)assert.equal(/workspace|shop/.test(JSON.stringify(c.args||{})),false);
});
