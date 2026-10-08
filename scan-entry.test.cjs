const {harness}=require('./app.test.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const tick=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const product=(id,reference='REF'+id)=>({id,reference,description:'Description '+id,internal_barcode:'INT'+id,manufacturer_barcode:'EAN'+id});
/* Fake catalogue: exact match on either barcode or on the reference (as typed or upper case),
   as the shared_product_lookup function does on the server. */
async function setup(catalogue=[]){
 const h=harness();h.run(fs.readFileSync('warehouse.js','utf8'));await tick();await h.run('synchronize()');
 h.lookups=[];
 h.context.fetch=async(url,opts)=>{
  if(!url.endsWith('/rpc/shared_product_lookup'))return {ok:true,json:async()=>[]};
  const code=JSON.parse(opts.body).code,values=[['internal_barcode',code],['manufacturer_barcode',code],['reference',code],['reference',code.toUpperCase()]];
  h.lookups.push(values);
  return {ok:true,json:async()=>catalogue.filter(p=>values.some(([field,value])=>p[field]===value))};
 };
 h.state=()=>JSON.parse(h.data.get('scanette_account_v1:shared'));
 h.items=()=>h.state().sections.at(-1)?.items||{};
 h.el=id=>h.context.document.getElementById(id);
 h.field=async value=>{h.el('scanEntry').value=value;h.el('manualEntry').listeners.submit({preventDefault(){}});await h.run('scanQueue.whenIdle()');await tick();};
 h.camera=async code=>{const now=Date.now();h.run('cameraGate.reset()');h.context.Date.now=()=>now;h.run('onScan('+JSON.stringify(code)+')');h.context.Date.now=()=>now+90;h.run('onScan('+JSON.stringify(code)+')');h.context.Date.now=Date.now;await h.run('scanQueue.whenIdle()');await tick();};
 h.context.Date=Object.assign(function(...a){return new Date(...a);},{now:Date.now});
 return h;
}

test('the scanette has one entry field, named « Code-barres ou référence »',()=>{
 const html=fs.readFileSync('index.html','utf8'),warehouse=fs.readFileSync('warehouse.js','utf8');
 assert.match(html,/<label for="scanEntry">Code-barres ou référence<\/label>/);assert.equal(html.match(/id="scanEntry"/g).length,1);
 assert.equal(/manualRef|warehouseCode/.test(html+warehouse),false);
 assert.ok(html.indexOf('scan-input-core.js')<html.indexOf('warehouse.js'));
 assert.match(fs.readFileSync('build.cjs','utf8'),/'scan-input-core\.js'/);
});
test('camera, external reader and typed entry reach the same decision for the same value',async()=>{
 const h=await setup([product('p1')]);
 await h.camera('EANp1');assert.equal(h.items()['BELLECAVE:p1'].qty,1);
 await h.field('EANp1');assert.equal(h.items()['BELLECAVE:p1'].qty,2);
 assert.deepEqual(h.lookups[0],h.lookups[1]);assert.equal(Object.keys(h.items()).length,1);
 assert.equal(h.el('scanEntry').value,'');assert.ok(h.el('scanEntry').focused>=1);assert.equal(h.el('scanNotice').hidden,true);
});
test('a typed reference that exactly matches a catalogue record is linked to that record',async()=>{
 const h=await setup([product('p1','GDB1330')]);
 await h.field(' gdb1330 ');
 const line=h.items()['BELLECAVE:p1'];assert.equal(line.productId,'p1');assert.equal(line.reference,'GDB1330');assert.equal(line.qty,1);
 assert.equal(Object.keys(h.items()).length,1);assert.deepEqual(h.state().pushQueue,[]);assert.deepEqual(h.state().aliases,{});
 h.el('scanEntry').value='GDB13';h.el('manualEntry').listeners.submit({preventDefault(){}});await tick();assert.equal(Object.keys(h.items()).length,1,'a partial reference never matches');assert.equal(h.items()['BELLECAVE:p1'].qty,1);assert.equal(h.run('decisionOpen()'),true);
});
test('a value matching several records asks for an explicit choice; cancelling adds nothing',async()=>{
 const h=await setup([product('p1','SAME'),product('p2','SAME')]);let offered=null;
 h.run('Warehouse.choose=async products=>{globalThis.offered=products;return null;}');h.context.globalThis=h.context;
 await h.field('SAME');assert.equal(h.context.offered.length,2);assert.equal(h.run('sections.length'),0);assert.match(h.el('scanNotice').textContent,/choix annulé/);
 h.run('Warehouse.choose=async products=>products[1]');
 await h.field('SAME');assert.equal(h.items()['BELLECAVE:p2'].qty,1);assert.equal(h.items()['BELLECAVE:p1'],undefined);assert.equal(h.el('scanNotice').hidden,true);
});
test('a barcode of one record equal to the reference of another is ambiguous, not silently resolved',async()=>{
 const h=await setup([{...product('p1'),manufacturer_barcode:'4000'},product('p2','4000')]);
 h.run('Warehouse.choose=async products=>{globalThis.count=products.length;return null;}');h.context.globalThis=h.context;
 await h.camera('4000');assert.equal(h.context.count,2);assert.equal(h.run('sections.length'),0);
});
test('external reader: each completed event counts, two identical boxes in a row are two pieces',async()=>{
 const h=await setup([product('p1')]);
 for(const value of ['EANp1','EANp1','EANp1']){h.el('scanEntry').value=value;h.el('manualEntry').listeners.submit({preventDefault(){}});assert.equal(h.el('scanEntry').value,'','field emptied at once');}
 await h.run('scanQueue.whenIdle()');assert.equal(h.items()['BELLECAVE:p1'].qty,3);
});
test('scans sent while a lookup is pending are queued in order, not merged or dropped',async()=>{
 const h=await setup([product('p1'),product('p2')]);const real=h.context.fetch;let release;const gate=new Promise(r=>release=r);
 h.context.fetch=async(...a)=>{await gate;return real(...a);};
 for(const value of ['EANp1','EANp2','EANp1']){h.el('scanEntry').value=value;h.el('manualEntry').listeners.submit({preventDefault(){}});}
 await tick();assert.equal(h.run('sections.length'),0);release();await h.run('scanQueue.whenIdle()');
 assert.equal(h.items()['BELLECAVE:p1'].qty,2);assert.equal(h.items()['BELLECAVE:p2'].qty,1);
 assert.deepEqual(h.lookups.map(l=>l[0][1]),['EANp1','EANp2','EANp1']);
});
test('an unknown value adds nothing until the operator decides, and « Ne rien ajouter » keeps it so',async()=>{
 const h=await setup([]);
 h.el('scanEntry').value='7777';h.el('manualEntry').listeners.submit({preventDefault(){}});await tick();
 assert.equal(h.run('sections.length'),0);assert.equal(h.run('pendingEan'),'7777');assert.equal(h.run('decisionOpen()'),true);
 assert.match(h.el('refTarget').textContent,/Rien n’est ajouté tant que vous n’avez pas choisi/);assert.equal(h.el('refClose').textContent,'Ne rien ajouter');
 assert.equal(h.el('refFree').textContent,'Ajouter « 7777 » comme référence libre (hors catalogue)');
 h.el('refClose').listeners.click();await h.run('scanQueue.whenIdle()');await tick();
 assert.equal(h.run('sections.length'),0);assert.equal(h.run('decisionOpen()'),false);assert.equal(h.run('pendingEan'),null);
 assert.deepEqual(h.state().aliases,{});assert.deepEqual(h.state().pushQueue,[]);assert.match(h.el('scanNotice').textContent,/Aucune pièce ajoutée pour « 7777 »/);
 assert.equal(h.alerts.length,0);
});
test('a scan arriving during a pending decision is refused with a signal, never taken as the answer',async()=>{
 const h=await setup([product('p1')]);
 h.el('scanEntry').value='7777';h.el('manualEntry').listeners.submit({preventDefault(){}});await tick();
 h.el('scanEntry').value='EANp1';h.el('manualEntry').listeners.submit({preventDefault(){}});await tick();
 assert.equal(h.run('sections.length'),0);assert.equal(h.run('scanQueue.size'),0);assert.equal(h.el('scanEntry').value,'');
 assert.match(h.el('refAlert').textContent,/décision est en attente.*EANp1.*n’a pas été pris en compte/);assert.equal(h.el('refAlert').hidden,false);assert.equal(h.run('pendingEan'),'7777');
 h.run('onScan("EANp1")');h.run('onScan("EANp1")');await tick();assert.equal(h.run('sections.length'),0,'camera reads are ignored during the decision');
 h.el('refClose').listeners.click();await h.run('scanQueue.whenIdle()');
 await h.field('EANp1');assert.equal(h.items()['BELLECAVE:p1'].qty,1);assert.equal(h.el('scanNotice').hidden,true);
});
test('a reader scanning during a decision cannot press a button by its Enter key',async()=>{
 const h=await setup([]);let prevented=0;const key=k=>({key:k,preventDefault(){prevented++;}});
 h.el('scanEntry').value='7777';h.el('manualEntry').listeners.submit({preventDefault(){}});await tick();
 h.context.document.activeElement={tagName:'BUTTON'};const onKey=h.run('onScanKey');
 for(const c of 'EAN1')onKey(key(c));onKey(key('Enter'));
 assert.equal(prevented,1);assert.match(h.el('refAlert').textContent,/décision est en attente/);assert.equal(h.run('sections.length'),0);
 h.context.Date.now=()=>Date.now()+5000;onKey(key('Enter'));assert.equal(prevented,1,'a deliberate Enter still answers the dialog');h.context.Date.now=Date.now;
});
test('« référence libre » is an explicit choice: exact value shown, no shared alias created, then reused in the same pointage',async()=>{
 const h=await setup([]);
 h.el('scanEntry').value='abc 12';h.el('manualEntry').listeners.submit({preventDefault(){}});await tick();
 assert.equal(h.el('refFree').textContent,'Ajouter « ABC12 » comme référence libre (hors catalogue)');
 h.el('refFree').listeners.click();await h.run('scanQueue.whenIdle()');await tick();
 assert.deepEqual(h.items(),{ABC12:{qty:1,prix:null}});assert.deepEqual(h.state().aliases,{});assert.deepEqual(h.state().pushQueue,[]);
 await h.field('abc 12');assert.equal(h.items().ABC12.qty,2);assert.equal(h.run('decisionOpen()'),false);
 assert.equal(h.calls.filter(c=>c.url.endsWith('/rpc/shared_aliases_save')).length,0);
});
test('associating an unknown code to a reference keeps the historical behaviour',async()=>{
 const h=await setup([]);
 h.el('scanEntry').value='5555';h.el('manualEntry').listeners.submit({preventDefault(){}});await tick();
 h.run("assignRef('old-1')");await h.run('scanQueue.whenIdle()');await tick();
 assert.equal(h.items()['OLD-1'].qty,1);assert.equal(h.state().aliases['5555'],'OLD-1');
 await h.camera('5555');assert.equal(h.items()['OLD-1'].qty,2);
});
test('a catalogue failure shows a persistent, non-blocking error and adds nothing',async()=>{
 const h=await setup([product('p1')]);const real=h.context.fetch;h.context.fetch=async()=>({ok:false,status:503});
 await h.field('EANp1');assert.equal(h.run('sections.length'),0);assert.equal(h.el('scanNotice').hidden,false);
 assert.match(h.el('scanNotice').textContent,/Pièce non ajoutée \(« EANp1 »\).*connexion/);assert.equal(h.el('scanNotice').className,'scan-notice error');
 assert.equal(h.alerts.length,0);assert.equal(h.run('decisionOpen()'),false);assert.equal(h.run('pendingEan'),null);
 h.context.fetch=real;await h.field('EANp1');assert.equal(h.items()['BELLECAVE:p1'].qty,1);assert.equal(h.el('scanNotice').hidden,true);
});
test('camera: a still label counts once, another code at once, the same code again after it left',async()=>{
 const h=await setup([product('p1'),product('p2')]);let now=1000;h.context.Date.now=()=>now;
 const read=async(code,at)=>{now=at;h.run('onScan('+JSON.stringify(code)+')');await h.run('scanQueue.whenIdle()');await tick(2);};
 for(let t=1000;t<=9000;t+=100)await read('EANp1',t);assert.equal(h.items()['BELLECAVE:p1'].qty,1);
 await read('EANp2',9050);await read('EANp2',9140);assert.equal(h.items()['BELLECAVE:p2'].qty,1,'no global delay after the previous piece');
 await read('EANp1',11000);await read('EANp1',11090);assert.equal(h.items()['BELLECAVE:p1'].qty,2);
 h.context.Date.now=Date.now;
});
test('without durable local storage, a scan is refused with a visible notice',async()=>{
 const h=await setup([product('p1')]);h.run('storageReady=false');
 h.el('scanEntry').value='EANp1';h.el('manualEntry').listeners.submit({preventDefault(){}});await tick();
 assert.equal(h.run('sections.length'),0);assert.match(h.el('scanNotice').textContent,/Enregistrement indisponible/);
});
test('reader with no field focused: the first character is kept, then the rest and Enter validate the whole code',async()=>{
 const h=await setup([product('p1')]),entry=h.el('scanEntry'),onKey=h.run('onScanKey');entry.tagName='INPUT';
 assert.equal(entry.focused,undefined,'the field is never focused on load: no on-screen keyboard on a phone');
 const realFocus=entry.focus;entry.focus=function(...a){h.context.document.activeElement=entry;return realFocus.apply(this,a);};
 /* Browser model: a key that is not prevented is typed by the browser into the focused field; Enter submits it. */
 const press=k=>{let prevented=false;onKey({key:k,preventDefault(){prevented=true;}});
  if(!prevented&&k.length===1&&h.context.document.activeElement===entry)entry.value+=k;
  if(!prevented&&k==='Enter'&&h.context.document.activeElement===entry)h.el('manualEntry').listeners.submit({preventDefault(){}});return prevented;};
 h.context.document.activeElement={tagName:'BODY'};h.context.document.querySelector=()=>null;
 assert.equal(press('E'),true,'the first key is held back instead of being left to the browser');
 assert.equal(entry.value,'E');assert.equal(h.context.document.activeElement,entry);assert.equal(entry.focused,1);
 for(const c of 'ANp1')assert.equal(press(c),false);assert.equal(entry.value,'EANp1');
 assert.equal(press('Enter'),false);await h.run('scanQueue.whenIdle()');await tick();
 assert.deepEqual(h.lookups.map(l=>l[0][1]),['EANp1']);assert.equal(h.items()['BELLECAVE:p1'].qty,1);assert.equal(entry.value,'');
 h.context.document.activeElement={tagName:'BUTTON'};for(const k of [...'EANp1','Enter'])press(k);await h.run('scanQueue.whenIdle()');await tick();
 assert.equal(h.items()['BELLECAVE:p1'].qty,2,'same after focus moved to a list button');assert.deepEqual(h.lookups.at(-1)[0][1],'EANp1');
});
test('keys typed in another field, shortcuts and the space bar on a button are left alone',async()=>{
 const h=await setup([product('p1')]),entry=h.el('scanEntry'),onKey=h.run('onScanKey');h.context.document.querySelector=()=>null;
 const held=(event,active)=>{let prevented=false;h.context.document.activeElement=active;onKey({preventDefault(){prevented=true;},...event});return prevented;};
 assert.equal(held({key:'A'},{tagName:'INPUT'}),false);assert.equal(held({key:'A'},{tagName:'SELECT'}),false);
 assert.equal(held({key:'c',ctrlKey:true},{tagName:'BODY'}),false);assert.equal(held({key:' '},{tagName:'BUTTON'}),false);
 assert.equal(held({key:'Enter'},{tagName:'BODY'}),false);assert.equal(held({key:'A',isComposing:true},{tagName:'BODY'}),false);
 h.context.document.querySelector=()=>({});assert.equal(held({key:'A'},{tagName:'BODY'}),false,'a native dialog (palette, sweep) keeps its keys');
 assert.equal(entry.value,'');assert.equal(entry.focused,undefined);
});
