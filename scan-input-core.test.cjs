const test=require('node:test'),assert=require('node:assert/strict'),C=require('./scan-input-core.js');
const product=(id,reference='REF')=>({id,reference,description:'Description '+id});

test('a value is only trimmed, never corrected; empty and oversized values are refused',()=>{
 assert.deepEqual(C.clean('  ab c-12 \n'),{ok:true,value:'ab c-12',error:''});
 assert.equal(C.clean('   ').ok,false);assert.equal(C.clean('   ').error,'');assert.equal(C.clean(null).ok,false);
 assert.equal(C.clean('1'.repeat(256)).ok,true);assert.equal(C.clean('1'.repeat(257)).ok,false);assert.match(C.clean('1'.repeat(257)).error,/trop long/);
});
test('catalogue filter is exact on both barcodes and on the reference, with quoted values',()=>{
 assert.equal(C.catalogueFilter('0123456789012'),'(internal_barcode.eq."0123456789012",manufacturer_barcode.eq."0123456789012",reference.eq."0123456789012")');
 assert.equal(C.catalogueFilter('gdb1330'),'(internal_barcode.eq."gdb1330",manufacturer_barcode.eq."gdb1330",reference.eq."gdb1330",reference.eq."GDB1330")');
 const hostile=C.catalogueFilter('A"),id.gt.0,(\\');assert.ok(hostile.includes('"A\\"),id.gt.0,(\\\\"'));assert.equal(hostile.includes('%'),false);assert.equal(/ilike|like\./.test(hostile),false);
});
test('one record is added, several require a choice, nothing is ever guessed',()=>{
 assert.deepEqual(C.decide({products:[product('p1')]}),{kind:'product',product:product('p1')});
 const several=C.decide({products:[product('p1'),product('p2')],alias:'OLD',freeLine:true});assert.equal(several.kind,'choose');assert.equal(several.products.length,2);
 assert.equal(C.decide({products:[product('p1'),product('p1')]}).kind,'product');
 assert.deepEqual(C.decide({products:[],alias:'OLD',freeLine:true}),{kind:'alias',reference:'OLD'});
 assert.deepEqual(C.decide({products:[],alias:null,freeLine:true}),{kind:'free'});
 assert.deepEqual(C.decide({products:[],alias:null,freeLine:false}),{kind:'unknown'});
 assert.throws(()=>C.decide({products:{error:'x'}}),/catalogue invalide/);
});
test('camera: a still label is counted once, however long it stays in view',()=>{
 const gate=C.createCameraGate();let counted=0;for(let t=0;t<=60000;t+=90)if(gate.sight('A',t))counted++;assert.equal(counted,1);
});
test('camera: one isolated read is not enough, two close reads are',()=>{
 const gate=C.createCameraGate();assert.equal(gate.sight('A',0),false);assert.equal(gate.sight('A',900),false);assert.equal(gate.sight('A',1000),true);
});
test('camera: a different code is accepted at once, with no global delay',()=>{
 const gate=C.createCameraGate();gate.sight('A',0);assert.equal(gate.sight('A',90),true);
 assert.equal(gate.sight('B',180),false);assert.equal(gate.sight('B',270),true);
 assert.equal(gate.sight('A',360),false);assert.equal(gate.sight('B',450),false);
});
test('camera: two labels read alternately are each counted once',()=>{
 const gate=C.createCameraGate();let a=0,b=0;for(let t=0;t<5000;t+=90){if(gate.sight(t/90%2?'B':'A',t))(t/90%2?b++:a++);}assert.deepEqual([a,b],[1,1]);
});
test('camera: the same code on another box counts again only after the label left the view',()=>{
 const gate=C.createCameraGate();gate.sight('A',0);gate.sight('A',90);
 assert.equal(gate.sight('A',1000),false);assert.equal(gate.sight('A',2400),false,'a short decoding gap is not an exit');
 assert.equal(gate.sight('A',4000),false,'first read after the exit only arms');assert.equal(gate.sight('A',4090),true);
});
test('camera: a decision or a camera restart is not mistaken for the label leaving',()=>{
 const gate=C.createCameraGate();gate.sight('A',0);gate.sight('A',90);gate.hold(100);
 assert.equal(gate.sight('B',200),false);assert.equal(gate.sight('B',290),false,'nothing is read while a decision is open');
 gate.hold(5000);gate.release(60000);assert.equal(gate.held,false);
 assert.equal(gate.sight('A',60500),false);assert.equal(gate.sight('A',60590),false,'the label still in view is not counted twice');
 assert.equal(gate.sight('B',60600),false);assert.equal(gate.sight('B',60690),true);
 gate.reset();gate.sight('A',70000);assert.equal(gate.sight('A',70090),true,'a deliberate restart starts from scratch');
});
test('queue: events are handled one at a time, in order, and identical events all count',async()=>{
 const seen=[];let active=0,overlap=false;
 const queue=C.createQueue(async item=>{if(active)overlap=true;active++;await new Promise(r=>setImmediate(r));seen.push(item);active--;});
 for(const item of ['A','A','B','A'])assert.equal(queue.push(item),true);
 assert.equal(queue.busy,true);await queue.whenIdle();assert.deepEqual(seen,['A','A','B','A']);assert.equal(overlap,false);assert.equal(queue.busy,false);
 queue.push('C');await queue.whenIdle();assert.deepEqual(seen.at(-1),'C');
});
test('queue: a failing event does not block the next ones; overflow is reported, never silent',async()=>{
 const seen=[];const queue=C.createQueue(async item=>{await null;if(item==='bad')throw Error('x');seen.push(item);},{limit:2});
 assert.equal(queue.push('bad'),true);assert.equal(queue.push('ok'),true);assert.equal(queue.push('next'),true);assert.equal(queue.push('refused'),false);
 await queue.whenIdle();assert.deepEqual(seen,['ok','next']);
});
test('queue: clearing drops waiting events of a closed session',async()=>{
 const seen=[];let release;const queue=C.createQueue(async item=>{if(item==='first')await new Promise(r=>release=r);seen.push(item);});
 queue.push('first');queue.push('stale');assert.equal(queue.size,1);queue.clear();release();await queue.whenIdle();assert.deepEqual(seen,['first']);
});
