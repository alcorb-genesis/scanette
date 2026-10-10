const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),A=require('./returns-actions-core.js');
const read=f=>fs.readFileSync(f,'utf8'),plain=v=>JSON.parse(JSON.stringify(v));
const lines=()=>[{id:'l1',product_id:'p1',reference:'LX 1780',description:'Filtre à air',quantity:2,received_quantity:null,reason:''},{id:'l2',product_id:null,reference:'GDB1330',description:'',quantity:1,received_quantity:null,reason:''},{id:'l3',product_id:null,reference:'W 712',description:'Filtre à huile',quantity:1,received_quantity:null,reason:''}];
const catalogue=[{id:'p1',reference:'LX 1780',internal_barcode:'2000000000017',manufacturer_barcode:'4009026000014'},{id:'p2',reference:'GDB1330',internal_barcode:null,manufacturer_barcode:'3322937000000'},{id:'p9',reference:'LX 1781',internal_barcode:null,manufacturer_barcode:'4009026000021'}];
const lookup=code=>catalogue.filter(p=>p.reference===code||p.reference===code.toUpperCase()||p.internal_barcode===code||p.manufacturer_barcode===code);
const dossier=(id,status,ls,name='CN AUTO')=>({id,version:1,created_at:'2026-10-05T08:00:00Z',updated_at:'2026-10-05T08:00:00Z',document:{type:'return',status,client_name:name,supplier_name:'',lines:ls}});
let seq=0;const action=(caseId,lineId,kind,quantity,extra={})=>({id:'a'+(++seq),case_id:caseId,line_id:lineId,kind,status:A.KINDS[kind].first,quantity,packed_quantity:0,supplier_id:null,supplier_name:'',document_number:'',comment:'',shipment_id:null,version:1,created_at:'2026-10-06T09:00:00Z',...extra});

test('reception: an exact reference or an exact barcode validates one unit of the right line',()=>{const l=lines();
 for(const code of ['LX 1780','lx 1780','2000000000017','4009026000014']){const found=A.matchLine(l,code,lookup(code));assert.equal(found.line?.id,'l1',code);A.receiveUnit(found.line);}
 assert.equal(l[0].received_quantity,4);assert.equal(A.matchLine(l,'3322937000000',lookup('3322937000000')).line.id,'l2','a hand-typed line is found by the barcode of the record that bears its reference');
 assert.equal(A.matchLine(l,'W 712',[]).line.id,'l3','a line outside the catalogue is validated by its exact reference');
});
test('reception: a part that is not in the dossier is rejected, never matched to a near line',()=>{const l=lines();
 for(const code of ['LX 1781','4009026000021','LX1780','LX 178','LX 1780 ','GDB 1330','W712','400902600001','0'].filter(c=>c.trim()!=='LX 1780')){const found=A.matchLine(l,code,lookup(code));assert.equal(found.line,null,code);assert.match(found.error,/ne fait pas partie de ce dossier/,code);}
 assert.deepEqual(l.map(x=>x.received_quantity),[null,null,null],'nothing was validated');assert.deepEqual(plain(A.matchLine(l,'   ',[])),{line:null,error:''});
 const twice=[...l,{id:'l4',product_id:null,reference:'W 712',quantity:1}];assert.match(A.matchLine(twice,'W 712',[]).error,/plusieurs lignes/,'two lines with the same reference are never chosen by chance');
});
test('an absent part stays at zero and takes no decision',()=>{const l=lines();l[0].received_quantity=0;assert.equal(A.received(l[0]),0);assert.equal(A.received(l[1]),0);
 assert.match(A.problem({kind:'damaged',quantity:1,comment:'x'},l[0],[],'received'),/Aucune pièce reçue/);});
test('each decision asks for what makes it usable',()=>{const l=lines()[0];l.received_quantity=2;const ok=d=>A.problem(d,l,[],'received');
 assert.match(ok({kind:'damaged',quantity:1,comment:' '}),/dommage/);assert.equal(ok({kind:'damaged',quantity:1,comment:'Emballage ouvert'}),'');
 assert.match(ok({kind:'supplier_return',quantity:1}),/fournisseur/);assert.equal(ok({kind:'supplier_return',quantity:2,supplierId:'s1'}),'');
 assert.match(ok({kind:'customer_credit',quantity:1,documentNumber:' '}),/BL, de facture ou de commande/);assert.equal(ok({kind:'customer_credit',quantity:1,documentNumber:'BL 123'}),'');
 assert.match(ok({kind:'pending',quantity:1}),/attendu/);assert.match(ok({kind:'damaged',quantity:3,comment:'x'}),/entre 1 et 2/);assert.match(ok({kind:'destroyed',quantity:1}),/Choisissez/);
 assert.match(A.problem({kind:'damaged',quantity:1,comment:'x'},l,[],'collected'),/réception/,'no decision before the reception is validated');
});
test('a supplier return AND a customer credit on the same line; each kind limited by what was received',()=>{const l=lines()[0];l.received_quantity=2;
 const mine=[action('c1','l1','supplier_return',2,{supplier_id:'s1',supplier_name:'APO'}),action('c1','l1','customer_credit',1,{document_number:'BL 1'})];
 assert.equal(A.remaining(l,mine,'supplier_return'),0);assert.equal(A.remaining(l,mine,'customer_credit'),1);assert.equal(A.remaining(l,mine,'damaged'),2);
 assert.match(A.problem({kind:'supplier_return',quantity:1,supplierId:'s2'},l,mine,'received'),/déjà cette suite/);assert.equal(A.problem({kind:'customer_credit',quantity:1,documentNumber:'BL 2'},l,mine,'received'),'');
 mine[0].status='cancelled';assert.equal(A.remaining(l,mine,'supplier_return'),2,'a cancelled decision frees its quantity');
});
test('what is sent to the server is the decision and nothing else',()=>{
 assert.deepEqual(A.payload('c1','l1',{kind:'customer_credit',quantity:'2',supplierId:'s1',documentNumber:'  BL   123 ',comment:' à voir '},'  Léa '),{case_id:'c1',line_id:'l1',action_kind:'customer_credit',quantity:2,supplier_id:null,document_number:'BL 123',comment:'à voir',actor_label:'Léa'});
 assert.equal(A.payload('c1','l1',{kind:'supplier_return',quantity:1,supplierId:'s1',documentNumber:'BL 1'},'').document_number,'');
});
test('steps by hand: credit issued then stock or not; packed and sent are never set by hand',()=>{
 assert.deepEqual(A.next({kind:'customer_credit',status:'to_do'}),['issued']);assert.deepEqual(A.next({kind:'customer_credit',status:'issued'}),['restocked','closed_no_stock']);assert.deepEqual(A.next({kind:'customer_credit',status:'restocked'}),[]);
 assert.deepEqual(A.next({kind:'pending',status:'open'}),['resolved']);assert.deepEqual(A.next({kind:'supplier_return',status:'to_send'}),[]);assert.deepEqual(A.next({kind:'supplier_return',status:'packed'}),['to_send']);assert.deepEqual(A.next({kind:'supplier_return',status:'sent'}),[]);
 assert.equal(A.canCancel({kind:'supplier_return',status:'packed'}),false);assert.equal(A.canCancel({kind:'supplier_return',status:'sent'}),false);assert.equal(A.canCancel({kind:'damaged',status:'recorded'}),true);assert.equal(A.canCancel({kind:'customer_credit',status:'restocked'}),false);
 assert.equal(A.stockDestination({status:'restocked'}),'Remis en stock');assert.equal(A.stockDestination({status:'closed_no_stock'}),'Non remis en stock');assert.equal(A.stockDestination({status:'issued'}),'','never assumed');
});
function world(){const l1=lines(),l2=lines();l1[0].received_quantity=2;l1[1].received_quantity=1;l1[2].received_quantity=0;l2[0].received_quantity=1;l2[1].received_quantity=1;
 const cases=[dossier('11111111-aaaa','received',l1,'CN AUTO'),dossier('22222222-bbbb','received',l2,'Garage Dupont'),dossier('33333333-cccc','collected',lines(),'Garage Dupont')];
 const actions=[action('11111111-aaaa','l1','supplier_return',2,{supplier_id:'s1',supplier_name:'APO',comment:'Garantie'}),action('11111111-aaaa','l1','customer_credit',2,{document_number:'BL 123'}),action('11111111-aaaa','l1','damaged',1,{comment:'Emballage ouvert'}),
  action('22222222-bbbb','l1','supplier_return',1,{supplier_id:'s2',supplier_name:'Bosch',status:'sent',shipment_id:'sh0'}),action('22222222-bbbb','l1','customer_credit',1,{document_number:'BL 123',status:'issued'}),action('22222222-bbbb','l2','pending',1,{comment:'À voir avec le comptoir'}),action('99999999-zzzz','l1','damaged',1,{comment:'dossier non chargé'})];
 return {cases,actions};}
test('the folders are filters on the same decisions: nothing is copied, nothing is lost',()=>{const {cases,actions}=world(),v=A.views(cases,actions);
 assert.deepEqual(v.toDecide.map(r=>r.dossier.document.client_name+':'+r.line.reference),['CN AUTO:GDB1330'],'received without decision; the absent line and the collected dossier are not listed');
 assert.deepEqual(v.pending.map(r=>r.action.comment),['À voir avec le comptoir']);
 assert.deepEqual(v.damaged.map(g=>[g.label,g.rows.length]),[['CN AUTO',1]]);
 assert.deepEqual(v.suppliers.map(g=>[g.label,g.toSend.length,g.packed.length,g.sent.length]),[['APO',1,0,0],['Bosch',0,0,1]]);
 assert.deepEqual(v.credits.map(g=>[g.garage,g.documentNumber,g.toDo,g.issued]),[['CN AUTO','BL 123',1,0],['Garage Dupont','BL 123',0,1]],'grouped by garage and document number');
 assert.deepEqual(plain(v.counts),{toDecide:2,damaged:1,supplier:1,credit:2});assert.equal(v.orphans.length,1,'a decision whose dossier is not loaded is reported, not dropped');
 const all=A.join(actions,cases).rows;assert.ok(all.every(r=>r.line===cases.find(c=>c.id===r.action.case_id).document.lines.find(l=>l.id===r.action.line_id)),'rows point to the line of the dossier itself');
 assert.deepEqual(A.carton(all,'sh0').map(r=>r.action.supplier_name),['Bosch']);
});
test('CSV for the offices: every column asked, the supplier when one exists, formulas neutralised',()=>{const {cases,actions}=world(),all=A.join(actions,cases).rows,credits=all.filter(r=>r.action.kind==='customer_credit');
 actions[1].status='restocked';cases[0].document.lines[0].reference='=LX 1780';const text=A.csv(credits,all),rows=text.replace('﻿','').split('\r\n').map(r=>r.split(';').map(c=>c.replace(/^"|"$/g,'')));
 assert.deepEqual(rows[0],['Date','Garage','Dossier','Référence','Désignation','Quantité','BL / facture / commande','Fournisseur','Motif / commentaire','Suite','Statut','Destination stock']);
 assert.deepEqual(rows[1],['06/10/2026','CN AUTO','R-11111111',"'=LX 1780",'Filtre à air','2','BL 123','APO','','Avoir client','Remis en stock','Remis en stock']);
 assert.deepEqual(rows[2].slice(1),['Garage Dupont','R-22222222','LX 1780','Filtre à air','1','BL 123','Bosch','','Avoir client','Avoir édité','']);assert.ok(text.startsWith('﻿'));
 assert.match(A.csv(all.filter(r=>r.action.kind==='damaged'),all),/"Emballage ouvert";"Abîmée";"Constatée";""/);
});
test('journal and server answers are worded for the agent',()=>{
 assert.equal(A.eventMessage({action_kind:'supplier_return',action_from:'to_send',action_to:'packed',line_id:'l1'},lines()),'Retour fournisseur · LX 1780 : À envoyer → Dans le carton');assert.equal(A.eventMessage({action_kind:'damaged',action_from:null,action_to:'recorded',line_id:'zz'},lines()),'Abîmée : Constatée');
 assert.match(A.serverMessage({code:'PT404'}),/Rien n’a été ajouté au carton/);assert.match(A.serverMessage({code:'22023',message:'Open decisions remain'}),/encore en cours/);assert.equal(A.serverMessage({code:'XX000',message:'boom'}),'');
});
test('the server rules mirror the page, and the public portal knows none of it',()=>{const sql=read('returns-actions.sql'),body=sql.replace(/^--.*$/gm,'');
 for(const [kind,k] of Object.entries(A.KINDS))assert.ok(body.includes("'"+kind+"'")&&body.includes("'"+k.first+"'"),kind);for(const s of Object.keys(A.STATES))assert.ok(body.includes("'"+s+"'"),s);
 assert.match(body,/status in \('to_send','packed','to_do','issued','open'\)/);assert.deepEqual([...A.RUNNING].sort(),['issued','open','packed','to_do','to_send']);
 assert.match(body,/line\.value->>'reference'=scanned or line\.value->>'reference'=upper\(scanned\)/);assert.doesNotMatch(body,/\blike\b|ilike|similarity|position\(/i,'no approximate match in a scan');
 assert.doesNotMatch(body,/delete from|drop table|truncate/i,'nothing is deleted');assert.doesNotMatch(sql,/\$\$|^\s*(begin|commit)\s*;/mi);
 assert.match(body,/revoke all on public\.returns_shipments,public\.returns_line_actions from public,anon,authenticated;/);
 for(const fn of [...body.matchAll(/create (?:or replace )?function public\.(shared_[a-z_]+)\(/g)].map(m=>m[1]))assert.match(body,new RegExp('function public\\.'+fn+'\\([^)]*session_token text default null\\)'),fn+' requires the session');
 const pub=['returns-portal.html','returns-portal.js','returns-portal-core.js','returns-portal.css'].map(read).join('\n');
 assert.doesNotMatch(pub,/returns_line_actions|shared_return|ReturnsActions|returns-actions|abîm|fournisseur|supplier|avoir|credit|shipment|manifeste|stock/i);
 assert.deepEqual([...pub.matchAll(/rpc\('([a-z_]+)'/g)].map(m=>m[1]).sort(),['returns_public_designation','returns_public_garages','returns_public_submit']);
});
