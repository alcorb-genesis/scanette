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
test('catalogue construit un filtre par sections tout en conservant la recherche référence',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),nodes=new Map(),calls=[];
 const make=()=>({value:'',hidden:false,children:[],events:{},classList:{toggle(){}},addEventListener(k,fn){this.events[k]=fn},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x},close(){},focus(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)};
 const db={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'test'}}}})},from(table){const q={filters:[],select(){return q},eq(){return q},order(){return q},range(){return q},limit(){return q},ilike(k,v){q.filters.push([k,v]);return q},or(v){q.filters.push(v);return q},maybeSingle:async()=>({data:{role:'reader'}}),then(resolve){calls.push({table,filters:q.filters});return Promise.resolve({data:[],count:0}).then(resolve)}};return q}};
 vm.runInNewContext(fs.readFileSync('bellecave.js','utf8'),{supabase:{createClient:()=>db},LocationSearch:L,CatalogueEvidence:require('./catalogue-evidence.js'),document:{getElementById:get,createElement:make,addEventListener(){}},setTimeout,navigator:{},Intl});
 await new Promise(r=>setImmediate(r));get('query').value='Allée A19';get('searchForm').events.submit({preventDefault(){}});await new Promise(r=>setImmediate(r));
 const query=calls.filter(c=>c.table==='scanette_products').at(-1).filters.join(',');
 assert.match(query,/location.ilike.A19F/);assert.match(query,/reference.ilike.%Allée A19%/);assert.equal(get('aisles').open,true);
 get('query').value='A123';get('searchForm').events.submit({preventDefault(){}});await new Promise(r=>setImmediate(r));
 assert.match(calls.filter(c=>c.table==='scanette_products').at(-1).filters.join(','),/reference.ilike.%A123%/);
});
