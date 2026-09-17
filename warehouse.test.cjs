const {harness}=require('./app.test.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
async function setup(){const h=harness();h.run(fs.readFileSync('warehouse.js','utf8'));await new Promise(r=>setImmediate(r));await h.run('synchronize()');return h;}
const product=(id,reference='SAME')=>({id,reference,description:'Description '+id});
test('Bellecave barcode resolves automatically and never publishes shop aliases',async()=>{
 const h=await setup();h.context.fetch=async url=>({ok:true,json:async()=>url.includes('scanette_products')?[product('p1','REF123')]:[]});
 await h.run("onBarcode('0123456789012')");
 const state=JSON.parse(h.data.get('scanette_account_v1:alice'));
 assert.equal(state.sections[0].items['BELLECAVE:p1'].qty,1);assert.equal(state.sections[0].items['BELLECAVE:p1'].reference,'REF123');assert.equal(state.pushQueue.length,0);assert.deepEqual(state.aliases,{});
});
test('same reference on different product identities remains distinct through backup',async()=>{
 const h=await setup();h.context.entries=[{product:product('p1'),code:'001',qty:2},{product:product('p2'),code:'002',qty:3}];h.run('Warehouse.commit(entries)');
 const saved=JSON.parse(h.data.get('scanette_account_v1:alice'));assert.equal(Object.keys(saved.sections[0].items).length,2);assert.equal(saved.sections[0].items['BELLECAVE:p2'].qty,3);
 h.run("loadAccount('alice')");assert.equal(h.run("sections[0].items['BELLECAVE:p1'].productId"),'p1');
});
test('a batch is atomic when storage fails',async()=>{
 const h=await setup(),before=h.data.get('scanette_account_v1:alice');h.context.entries=[{product:product('p1'),code:'001',qty:2}];
 h.context.localStorage.setItem=()=>{throw Error('Quota');};assert.throws(()=>h.run('Warehouse.commit(entries)'),/Quota/);assert.equal(h.run('sections.length'),0);assert.equal(h.data.get('scanette_account_v1:alice'),before);
});
test('a stale lookup cannot add to another account',async()=>{
 const h=await setup();let release;h.context.fetch=()=>new Promise(r=>release=r);
 const pending=h.run("onBarcode('001')");await new Promise(r=>setImmediate(r));h.run('clearAccount()');release({ok:true,json:async()=>[product('p1')]});await pending;assert.equal(h.run('sections.length'),0);
});
test('network failure does not silently create an unknown reference',async()=>{
 const h=await setup();h.context.fetch=async()=>({ok:false,status:503});await h.run("onBarcode('001')");assert.equal(h.run('sections.length'),0);assert.equal(h.run('pendingEan'),null);
});
test('historical known codes still work when Bellecave has no match',async()=>{
 const h=await setup();h.context.fetch=async()=>({ok:true,json:async()=>[]});h.run("aliases['123']='OLDREF'");await h.run("onBarcode('123')");assert.equal(h.run('sections[0].items.OLDREF.qty'),1);
});
test('an ambiguous barcode is not assigned to the first match',async()=>{
 const h=await setup();h.context.fetch=async()=>({ok:true,json:async()=>[product('p1'),product('p2')]});h.run('Warehouse.choose=async()=>null');await h.run("onBarcode('001')");assert.equal(h.run('sections.length'),0);
});
test('invalid quantity cancels every row of a batch before persistence',async()=>{
 const h=await setup();h.context.entries=[{product:product('p1'),code:'001',qty:2},{product:product('p2'),code:'002',qty:1.5}];assert.throws(()=>h.run('Warehouse.commit(entries)'),/Quantité invalide/);assert.equal(h.run('sections.length'),0);
});

test('light camera is bounded and a late stream is stopped after close',async()=>{
 const h=await setup();let release,requested,stopped=0;
 h.context.navigator.mediaDevices={getUserMedia:async options=>{requested=options;return new Promise(resolve=>release=resolve);}};
 const opening=h.run("document.getElementById('paletteCamera').onclick()");
 assert.equal(requested.video.width.max,1600);assert.equal(requested.video.height.max,1600);assert.equal(requested.audio,false);
 h.run("document.getElementById('paletteClose').onclick()");release({getTracks:()=>[{stop:()=>stopped++}]});await opening;assert.equal(stopped,1);
});
