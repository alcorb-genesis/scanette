const test=require('node:test'),assert=require('node:assert/strict'),C=require('./inventory/core.js');
const article=(id='a')=>({id,reference:'0986478546',brand:'Bosch',range:'Disques',location:'A1',manufacturer_barcode:'0012345678905'});
test('Complete list selection separates brands, ranges and aisles without a result cap',()=>{
 const rows=C.catalogue(Array.from({length:14000},(_,i)=>({...article(String(i)),brand:i%2?'Purflux':'Bosch'})));
 assert.equal(C.select(rows,'Bosch','Disques','a1').length,7000);
 assert.equal(C.select(rows,'Bosch','Filtres').length,0);
});
test('Empty quantity remains uncounted, zero means counted; invalid numbers rejected',()=>{
 assert.equal(C.quantity(''),null);assert.equal(C.quantity('0'),0);
 for(const v of [-1,1.5,'bad',1000001])assert.throws(()=>C.quantity(v));
});
test('Cooldown blocks any second read until exactly two seconds, then permits same item',()=>{
 const gate=C.gate();assert.equal(gate.accept(10000),true);assert.equal(gate.accept(11999),false);assert.equal(gate.left(11999),1);assert.equal(gate.accept(12000),true);
});
test('Barcode lookup preserves zeros and reports ambiguous references',()=>{
 const a=article(),b={...article('b'),reference:'other'};
 assert.equal(C.lookup([a],'12345678905').length,0);assert.equal(C.lookup([a,b],'0012345678905').length,2);assert.equal(C.lookup([a],a.reference)[0],a);
});
test('Count correction, repeated scans and added unknown item are undoable',()=>{
 const d={lines:[{...article(),quantity:null}]};C.change(d,'a',1);C.change(d,'a',2);C.undo(d);assert.equal(d.lines[0].quantity,1);C.undo(d);assert.equal(d.lines[0].quantity,null);
 d.lines.push({...article('new'),quantity:null,added:true});C.change(d,'new',1,true);C.undo(d);assert.equal(d.lines.length,1);
});
test('CSV supports quoted multiline descriptions and leading zero references',()=>{
 const r=C.parseCSV('Référence;Désignation;Marque;Gamme;Emplacement\r\n0986478546;"Disque; avant\n280 mm";Bosch;Disques;A1');
 assert.equal(r[0].reference,'0986478546');assert.equal(r[0].description,'Disque; avant\n280 mm');assert.throws(()=>C.parseCSV('Référence;Marque;Gamme\n"unfinished'));
});
test('CSV export keeps blank distinct from zero and neutralizes formula content',()=>{
 const s=C.csv({id:'test',employee:'=CMD()',lines:[{...article(),quantity:null},{...article('b'),quantity:0}]});
 assert.match(s,/"'\=CMD\(\)"/);assert.match(s,/"";"Non compté"/);assert.match(s,/"0";"Compté"/);
});
test('Catalogue import drops quantities and employee data; rejects duplicate identities',()=>{
 const a=C.catalogue([{...article(),quantity:12,employee:'secret'}])[0];assert.equal(a.quantity,undefined);assert.equal(a.employee,undefined);assert.throws(()=>C.catalogue([article(),article()]));assert.throws(()=>C.catalogue([{reference:'x'}]));
});

test('CSV includes both counters and remains compatible with single-counter drafts',()=>{
 const d={id:'binome',employee:'Alexis',employee2:'Axel',lines:[{...article(),quantity:2}]};
 assert.match(C.csv(d),/"Employé";"Deuxième personne"/);
 assert.match(C.csv(d),/"Alexis";"Axel"/);
 delete d.employee2;assert.match(C.csv(d),/"Alexis";""/);
});
