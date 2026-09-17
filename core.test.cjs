const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('./core.js');
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}};
test('two accounts never load each other inventories',()=>{
 const s=memory(),a=c.empty();a.sections=[{name:'BOSCH',items:{R1:{qty:7,prix:null}}}];
 c.write(s,'alice',a);assert.equal(c.read(s,'bob').sections.length,0);assert.equal(c.read(s,'alice').sections[0].items.R1.qty,7);
});
test('previous inventory survives storage quota failure',()=>{
 const s=memory(),a=c.empty();c.write(s,'alice',a);
 const write=s.setItem;s.setItem=(k,v)=>{if(k===c.storageKey('alice'))throw Error('QuotaExceeded');write(k,v)};
 a.sections=[{name:'NEW',items:{}}];assert.throws(()=>c.write(s,'alice',a),/QuotaExceeded/);
 assert.deepEqual(c.read(s,'alice').sections,[]);
});
test('corrupt backups rejected, prototype-like references handled as ordinary keys',()=>{
 assert.throws(()=>c.validate({...c.empty(),sections:[{name:'X',items:{X:{qty:-1,prix:null}}}]}));
 const data=JSON.parse('{"version":1,"sections":[{"name":"X","items":{"__proto__":{"qty":2,"prix":null}}}],"aliases":{},"pushQueue":[]}');
 assert.equal(c.validate(data).sections[0].items.__proto__.qty,2);
});
test('all 14000 references loaded despite server page cap',async()=>{
 const input=Array.from({length:14000},(_,i)=>({ean:String(i),ref:'R'+i}));let calls=0;
 const result=await c.pullAll(async(offset,size)=>{calls++;return input.slice(offset,offset+Math.min(137,size))},()=>true);
 assert.equal(result.length,14000);assert.equal(result[13999].ref,'R13999');assert.ok(calls>100);
});
test('old request cannot cross into a new session',async()=>{
 await assert.rejects(()=>c.pullAll(async()=>[{ean:'1',ref:'A'}],()=>false),/Session modifiée/);
});
test('edits and new scans during a pending upload are not discarded',()=>{
 const sent=[{ean:'1',ref:'OLD'},{ean:'2',ref:'B'}];
 const pending=[{ean:'1',ref:'NEW'},{ean:'2',ref:'B'},{ean:'3',ref:'C'}];
 assert.deepEqual(c.acknowledge(pending,sent),[{ean:'1',ref:'NEW'},{ean:'3',ref:'C'}]);
});
