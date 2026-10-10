/* Test double of the returns functions of the server, for the interface tests only (never published).
   Same function names, same arguments, same refusals — error code and message — as
   returns-collectors.sql, returns-actions.sql and returns-roles.sql; returns-fake-server.test.cjs checks that every
   refusal raised here exists, with the same code, in those files. State lives in memory. */
(function(root){
'use strict';
function createReturnsFakeServer({cases=[],partners=[],products=[],now=()=>new Date().toISOString()}={}){
 const db={cases:structuredClone(cases),partners:structuredClone(partners),products:structuredClone(products),actions:[],shipments:[],events:[],calls:[]};let seq=0;
 const uid=()=>'00000000-0000-4000-9000-'+String(++seq).padStart(12,'0'),fail=(code,message)=>{throw {code,message};};
 const clean=v=>String(v??'').trim().replace(/\s+/g,' '),label=v=>clean(String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ')).slice(0,60),copy=v=>structuredClone(v);
 const RUNNING=['to_send','packed','to_do','issued','open'],STATUSES=['requested','collected','received','supplier_pending','credited','closed','cancelled'];
 const NEXT={requested:['collected','cancelled'],collected:['received','cancelled'],received:['supplier_pending','credited','closed','cancelled'],supplier_pending:['credited','closed','cancelled'],credited:['closed']};
 const COLLECTORS=['serge','damian','paketo_landes','paketo_bearn','paketo_pays_basque','ace','ludovic','maxime','charlie','cedric'];
 const got=line=>/^[0-9]{1,6}$/.test(String(line.received_quantity??''))?Number(line.received_quantity):0;
 const dossier=id=>db.cases.find(c=>c.id===id)||fail('22023','Unknown dossier');
 const matching=(doc,scanned)=>doc.lines.filter(l=>l.reference===scanned||l.reference===scanned.toUpperCase()||db.products.some(p=>(p.internal_barcode===scanned||p.manufacturer_barcode===scanned)&&(p.id===l.product_id||p.reference===l.reference)));
 const row=c=>({id:c.id,document:copy(c.document),version:c.version,created_at:c.created_at,updated_at:c.updated_at});
 const caseEvent=(c,kind,from,to,note,extra={})=>db.events.push({case_id:c.id,created_at:now(),event_kind:kind,from_status:from,to_status:to,note:note||'',by_account:false,access_source:'shared_access',from_collector:null,to_collector:null,line_id:null,action_kind:null,action_from:null,action_to:null,actor_label:null,...extra});
 const actionEvent=(a,before,note,actor)=>{const c=dossier(a.case_id);caseEvent(c,'action',c.document.status,c.document.status,String(note||'').slice(0,1000),{line_id:a.line_id,action_kind:a.kind,action_from:before,action_to:a.status,actor_label:label(actor)});};
 const fingerprint=doc=>JSON.stringify(doc.lines.map(l=>[l.id,l.reference,String(l.quantity),l.product_id??null]).sort());
 /* returns-roles.sql: units received without qualification, routing of one unit, automatic closing. */
 const unqualified=(c,line)=>Math.max(0,got(line)-db.actions.filter(x=>x.case_id===c.id&&x.line_id===line.id&&['damaged','supplier_return','customer_credit','pending'].includes(x.kind)&&x.status!=='cancelled').reduce((n,x)=>n+x.quantity,0));
 const fresh=(c,line,kind,status,extra={})=>({id:uid(),case_id:c.id,line_id:line.id,kind,status,quantity:1,packed_quantity:0,supplier_id:null,supplier_name:'',document_number:'',comment:'',shipment_id:null,stock_destination:'',version:1,created_at:now(),updated_at:now(),...extra});
 function closeIfDone(c){if(c.document.status!=='received')return;const mine=db.actions.filter(x=>x.case_id===c.id);if(!mine.length||mine.some(x=>RUNNING.includes(x.status)))return;
  if(c.document.lines.some(l=>String(l.received_quantity??'')===''||unqualified(c,l)>0))return;c.document.status='closed';c.version++;c.updated_at=now();caseEvent(c,'status_changed','received','closed','Clôture automatique : toutes les pièces sont traitées');}
 function route(c,line,state,why,actor){let x,before=null;
  if(state==='damaged'){x=fresh(c,line,'damaged','recorded',{comment:why});db.actions.push(x);actionEvent(x,null,why,actor);return x;}
  if(c.document.type==='return'){x=db.actions.find(y=>y.case_id===c.id&&y.line_id===line.id&&y.kind==='customer_credit'&&y.status==='to_do'&&y.document_number==='');if(x){before=x.status;x.quantity++;x.version++;x.updated_at=now();}else{x=fresh(c,line,'customer_credit','to_do');db.actions.push(x);}}
  else if(c.document.type==='warranty'){const partner=db.partners.find(p=>p.id===c.document.supplier_id&&p.kind==='supplier')||null;x=db.actions.find(y=>y.case_id===c.id&&y.line_id===line.id&&y.kind==='supplier_return'&&y.status==='to_send'&&y.packed_quantity===0&&!y.shipment_id&&(y.supplier_id||null)===(partner?.id||null));
   if(x){before=x.status;x.quantity++;x.version++;x.updated_at=now();}else{x=fresh(c,line,'supplier_return','to_send',{supplier_id:partner?.id||null,supplier_name:partner?.name||''});db.actions.push(x);}}
  else fail('22023','Type required');
  actionEvent(x,before,'Conforme · '+x.quantity,actor);return x;}
 const exact=(c,scanned)=>{const found=matching(c.document,scanned);if(!found.length)fail('PT404','Not a part of this dossier');if(found.length>1)fail('22023','Several lines match this code');if(got(found[0])>=Number(found[0].quantity))fail('22023','Line already complete');return found[0];};
 const qualification=a=>{const words=clean(a.reason);if(!['ok','damaged'].includes(a.part_state)||words.length>200)fail('22023','Invalid qualification');if(a.part_state==='damaged'&&!words)fail('22023','Reason required');return a.part_state==='damaged'?words:'';};
 const act=(a)=>{const x=db.actions.find(x=>x.id===a.action_id);if(!x)fail('22023','Unknown decision');if(a.expected_version!==null&&a.expected_version!==undefined&&x.version!==a.expected_version)fail('PT409','Decision changed');return x;};
 const F={
  shared_returns_model:()=>2,
  shared_returns_flow:()=>1,
  shared_return_plan(a){const who=a.collector||'',slot=a.pickup_at||'';if(!a.case_id||a.expected_version===null||a.expected_version===undefined||!COLLECTORS.includes(who)||!['return','warranty'].includes(a.case_type)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(slot)||isNaN(new Date(slot+':00')))fail('22023','Invalid plan');
   const c=dossier(a.case_id);if(c.document.status!=='requested')fail('22023','Collection is frozen once taken');if(c.version!==a.expected_version)fail('PT409','Return case changed');
   const before=c.document.collector||'';Object.assign(c.document,{collector:who,pickup_at:slot,type:a.case_type});c.version++;c.updated_at=now();
   caseEvent(c,before!==who?'assigned':'updated','requested','requested','Passage prévu : '+slot.replace('T',' à '),{from_collector:before!==who?(before||null):null,to_collector:before!==who?who:null,actor_label:label(a.actor_label)});return [row(c)];},
  shared_return_taken(a){const c=dossier(a.case_id);if(c.document.status!=='requested')fail('22023','Already taken');if(a.expected_version!==null&&a.expected_version!==undefined&&c.version!==a.expected_version)fail('PT409','Return case changed');
   if(!(c.document.collector||''))fail('22023','Collector required');c.document.status='collected';c.version++;c.updated_at=now();caseEvent(c,'status_changed','requested','collected','Pris par le livreur',{actor_label:label(a.actor_label)});return [row(c)];},
  shared_return_set_type(a){if(!['return','warranty'].includes(a.case_type))fail('22023','Type required');const c=dossier(a.case_id);
   if(!['requested','collected','received'].includes(c.document.status)||db.actions.some(x=>x.case_id===c.id&&['customer_credit','supplier_return'].includes(x.kind)&&x.status!=='cancelled'))fail('22023','Type is fixed once a part is routed');
   if(c.document.type!==a.case_type){c.document.type=a.case_type;c.version++;c.updated_at=now();caseEvent(c,'updated',c.document.status,c.document.status,'Type : '+(a.case_type==='warranty'?'Garantie':'Retour client'),{actor_label:label(a.actor_label)});}return [row(c)];},
  shared_return_identify(a){const scanned=clean(a.code);if(!a.case_id||!scanned||scanned.length>256)fail('22023','Invalid code');const c=dossier(a.case_id);if(c.document.status!=='collected')fail('22023','Dossier not in reception');
   const line=exact(c,scanned);return [{line_id:line.id,reference:line.reference,description:line.description||'',quantity:Number(line.quantity),received:got(line)}];},
  shared_return_receive_part(a){const scanned=clean(a.code);if(!a.case_id||!scanned||scanned.length>256)fail('22023','Invalid code');const why=qualification(a),c=dossier(a.case_id);
   if(c.document.status!=='collected')fail('22023','Dossier not in reception');if(a.part_state==='ok'&&!['return','warranty'].includes(c.document.type))fail('22023','Type required');
   const line=exact(c,scanned);line.received_quantity=got(line)+1;c.version++;c.updated_at=now();
   caseEvent(c,'reception','collected','collected','Scan : '+scanned+' · '+(a.part_state==='damaged'?'Abîmée : '+why:'Conforme'),{line_id:line.id,action_to:String(line.received_quantity),actor_label:label(a.actor_label)});
   const x=route(c,line,a.part_state,why,a.actor_label);return [{...row(c),line_id:line.id,action_id:x.id}];},
  shared_return_qualify(a){if(!a.case_id||!a.line_id)fail('22023','Invalid qualification');const why=qualification(a),c=dossier(a.case_id);
   if(!['collected','received','supplier_pending','credited'].includes(c.document.status))fail('22023','Dossier not in reception');const line=c.document.lines.find(l=>l.id===a.line_id);if(!line)fail('22023','Unknown line');
   if(unqualified(c,line)<1)fail('22023','Nothing to qualify');const x=route(c,line,a.part_state,why,a.actor_label);closeIfDone(c);return copy(x);},
  shared_return_finish(a){const c=dossier(a.case_id);if(c.document.status!=='collected')fail('22023','Dossier not in reception');
   if(c.document.lines.some(l=>unqualified(c,l)>0))fail('22023','Parts not qualified');
   const expected=c.document.lines.filter(l=>got(l)<Number(l.quantity)).map(l=>l.id).sort(),declared=[...new Set(a.missing_lines||[])].sort();
   if(JSON.stringify(expected)!==JSON.stringify(declared))fail('22023','Missing parts must be declared');
   c.document.status='received';c.version++;c.updated_at=now();caseEvent(c,'status_changed','collected','received','Réception terminée',{actor_label:label(a.actor_label)});
   for(const line of c.document.lines.filter(l=>expected.includes(l.id))){const gap=Number(line.quantity)-got(line);line.received_quantity=got(line);line.reason=[clean(line.reason),'Manquante : '+gap+' sur '+line.quantity].filter(Boolean).join(' · ');
    const x=fresh(c,line,'missing','open',{quantity:gap,comment:'Déclarée manquante à la réception'});db.actions.push(x);actionEvent(x,null,'Manquante : '+gap+' sur '+line.quantity,a.actor_label);}
   closeIfDone(c);return [row(c)];},
  shared_return_credit_issue(a){const number=clean(a.document_number);if(!number||number.length>60)fail('22023','Document number required');const x=act(a);
   if(x.kind!=='customer_credit'||x.status!=='to_do')fail('22023','Invalid step');x.status='issued';x.document_number=number;x.version++;x.updated_at=now();actionEvent(x,'to_do','Avoir : '+number,a.actor_label);return copy(x);},
  shared_return_action_supplier(a){const partner=db.partners.find(p=>p.id===a.supplier_id&&p.kind==='supplier');if(!partner)fail('22023','Supplier required');const x=act(a);
   if(x.kind!=='supplier_return'||x.status!=='to_send'||x.packed_quantity!==0||x.shipment_id)fail('22023','Invalid step');x.supplier_id=partner.id;x.supplier_name=partner.name;x.version++;x.updated_at=now();actionEvent(x,'to_send','Fournisseur : '+partner.name,a.actor_label);return copy(x);},
  shared_return_gap_resolve(a){const words=clean(a.note);if(words.length>500)fail('22023','Invalid decision');const x=act(a);
   if(!['missing','pending'].includes(x.kind)||x.status!=='open')fail('22023','Invalid step');x.status='resolved';x.version++;x.updated_at=now();closeIfDone(dossier(x.case_id));actionEvent(x,'open',words,a.actor_label);return copy(x);},
  shared_partners:()=>copy(db.partners),
  shared_returns:()=>db.cases.map(row).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at)),
  shared_return_events:a=>copy(db.events.filter(e=>e.case_id===a.case_id)),
  shared_product_lookup:a=>{const v=clean(a.code);return copy(db.products.filter(p=>p.internal_barcode===v||p.manufacturer_barcode===v||p.reference===v||p.reference===v.toUpperCase()));},
  shared_return_actions:()=>copy(db.actions),
  shared_return_shipments:()=>copy(db.shipments),
  /* returns_apply_case, through shared_save_return. */
  shared_save_return(a){const d=a.case_document,note=a.event_note||'';
   if(!a.case_id||!d||typeof d!=='object')fail('22023','Invalid request');
   if(!['return','warranty','deposit','mixed'].includes(d.type)||!STATUSES.includes(d.status)||!clean(d.client_name)||!Array.isArray(d.lines)||!d.lines.length)fail('22023','Invalid return case');
   const collector=d.collector||'';if(collector&&!COLLECTORS.includes(collector))fail('22023','Invalid collector');
   const previous=db.cases.find(c=>c.id===a.case_id);let before=null,beforeCollector='';
   if(previous){if(JSON.stringify(previous.document)===JSON.stringify(d))return [row(previous)];if(previous.version!==a.expected_version)fail('PT409','Return case changed');
    before=previous.document.status;beforeCollector=previous.document.collector||'';
    if(before!==d.status&&!(NEXT[before]||[]).includes(d.status))fail('22023','Invalid status transition');
    if(beforeCollector!==collector&&!['requested','collected'].includes(before))fail('22023','Collector is frozen after reception');
    // returns_cases_guard, as of returns-roles.sql
    if(before!=='requested'&&(beforeCollector!==collector||(previous.document.pickup_at||'')!==(d.pickup_at||'')))fail('22023','Collection is frozen once taken');
    if(d.lines.some(n=>String(n.received_quantity??'')!==String(previous.document.lines.find(o=>o.id===n.id)?.received_quantity??'')))fail('22023','Received quantity is set by the reception');
    if(before!=='requested'&&fingerprint(d)!==fingerprint(previous.document))fail('22023','Lines are fixed once collected');
   }else{if(a.expected_version!==0||d.status!=='requested')fail('22023','New return case must start as requested');if(d.lines.some(n=>String(n.received_quantity??'')!==''))fail('22023','Received quantity is set by the reception');}
   if(before!==d.status){
    if(d.status==='collected'&&!collector)fail('22023','Collector required');
    if(d.status==='received')for(const l of d.lines){if(String(l.received_quantity??'')==='')fail('22023','Reception control required');if(got(l)!==Number(l.quantity)&&!clean(l.reason))fail('22023','Reason required for a difference');}
    if(['supplier_pending','credited'].includes(d.status)&&!clean(d.supplier_name))fail('22023','Supplier required');
    if(d.status==='credited'&&!clean(d.credit_reference))fail('22023','Credit reference required');
    // returns_cases_guard
    if(previous&&['closed','cancelled'].includes(d.status)&&db.actions.some(x=>x.case_id===previous.id&&RUNNING.includes(x.status)))fail('22023','Open decisions remain');}
   let saved;if(previous){previous.document=copy(d);previous.version++;previous.updated_at=now();saved=previous;}else{saved={id:a.case_id,document:copy(d),version:1,created_at:now(),updated_at:now()};db.cases.unshift(saved);}
   const onlyAssignment=!!previous&&before===d.status&&beforeCollector!==collector;
   if(!onlyAssignment)caseEvent(saved,!previous?'created':before===d.status?'updated':'status_changed',before,d.status,note);
   if(beforeCollector!==collector)caseEvent(saved,'assigned',d.status,d.status,onlyAssignment?note:'',{from_collector:beforeCollector||null,to_collector:collector||null});
   return [row(saved)];},
  shared_return_receive(a){const scanned=clean(a.code);if(!a.case_id||!scanned||scanned.length>256)fail('22023','Invalid code');const c=dossier(a.case_id);
   if(c.document.status!=='collected')fail('22023','Dossier not in reception');const found=matching(c.document,scanned);
   if(!found.length)fail('PT404','Not a part of this dossier');if(found.length>1)fail('22023','Several lines match this code');
   const line=found[0];if(got(line)>=Number(line.quantity))fail('22023','Line already complete');
   line.received_quantity=got(line)+1;c.version++;c.updated_at=now();caseEvent(c,'reception','collected','collected','Scan : '+scanned,{line_id:line.id,action_to:String(line.received_quantity),actor_label:label(a.actor_label)});
   return [{...row(c),line_id:line.id}];},
  shared_return_receive_line(a){const words=clean(a.reason);if(!a.case_id||!a.line_id||a.quantity===null||a.quantity===undefined||words.length>500)fail('22023','Invalid reception');const c=dossier(a.case_id);
   if(c.document.status!=='collected')fail('22023','Dossier not in reception');const line=c.document.lines.find(l=>l.id===a.line_id);if(!line)fail('22023','Unknown line');
   if(!Number.isInteger(a.quantity)||a.quantity<0||a.quantity>Number(line.quantity))fail('22023','Quantity exceeds what was announced');if(!words)fail('22023','Reason required');
   line.received_quantity=a.quantity;line.reason=words;c.version++;c.updated_at=now();caseEvent(c,'reception','collected','collected','Saisie déclarée : '+a.quantity+' · '+words,{line_id:line.id,action_to:String(a.quantity),actor_label:label(a.actor_label)});
   return [row(c)];},
  shared_return_action_add(a){const number=clean(a.document_number),words=clean(a.comment),kind=a.action_kind;
   if(!a.case_id||!a.line_id||a.quantity===null||a.quantity===undefined||!['damaged','supplier_return','customer_credit','pending'].includes(kind)||number.length>60||words.length>500)fail('22023','Invalid decision');
   const c=dossier(a.case_id);if(!['received','supplier_pending','credited'].includes(c.document.status))fail('22023','Dossier not received');
   const line=c.document.lines.find(l=>l.id===a.line_id);if(!line)fail('22023','Unknown line');
   const used=db.actions.filter(x=>x.case_id===c.id&&x.line_id===line.id&&x.kind===kind&&x.status!=='cancelled').reduce((n,x)=>n+x.quantity,0);
   if(a.quantity<1||a.quantity>got(line)-used)fail('22023','Quantity exceeds what was received');
   let partner=null,first;
   if(kind==='supplier_return'){partner=db.partners.find(p=>p.id===a.supplier_id&&p.kind==='supplier');if(!partner)fail('22023','Supplier required');first='to_send';}
   else if(a.supplier_id)fail('22023','Invalid decision');
   else if(kind==='customer_credit'){if(!number)fail('22023','Document number required');first='to_do';}
   else{if(!words)fail('22023','Comment required');first=kind==='damaged'?'recorded':'open';}
   const saved={id:uid(),case_id:c.id,line_id:line.id,kind,status:first,quantity:a.quantity,packed_quantity:0,supplier_id:partner?.id||null,supplier_name:partner?.name||'',document_number:kind==='customer_credit'?number:'',comment:words,shipment_id:null,stock_destination:'',version:1,created_at:now(),updated_at:now()};
   db.actions.push(saved);actionEvent(saved,null,words,a.actor_label);return copy(saved);},
  shared_return_action_move(a){const words=clean(a.note),place=clean(a.stock_destination),to=a.to_status;if(words.length>500||place.length>80)fail('22023','Invalid decision');
   const x=db.actions.find(x=>x.id===a.action_id);if(!x)fail('22023','Unknown decision');if(a.expected_version!==null&&a.expected_version!==undefined&&x.version!==a.expected_version)fail('PT409','Decision changed');
   const ok=(x.kind==='customer_credit'&&x.status==='to_do'&&to==='issued')||(x.kind==='customer_credit'&&x.status==='issued'&&['restocked','closed_no_stock'].includes(to))||(x.kind==='pending'&&x.status==='open'&&to==='resolved')||(x.kind==='supplier_return'&&x.status==='packed'&&to==='to_send')||(to==='cancelled'&&['recorded','to_send','to_do','issued','open'].includes(x.status));
   if(!ok)fail('22023','Invalid step');if(to==='cancelled'&&!words)fail('22023','Reason required');if((to==='restocked')!==(place!==''))fail('22023','Stock destination required');
   if(x.kind==='supplier_return'&&x.shipment_id&&!db.shipments.some(s=>s.id===x.shipment_id&&s.status==='open'))fail('22023','Carton already sent');
   const before=x.status;x.status=to;x.stock_destination=place;x.version++;x.updated_at=now();if(x.kind==='supplier_return'){x.packed_quantity=0;x.shipment_id=null;}
   closeIfDone(dossier(x.case_id));actionEvent(x,before,place?('Destination : '+place+(words?' · '+words:'')):words,a.actor_label);return copy(x);},
  shared_return_shipment_open(a){const partner=db.partners.find(p=>p.id===a.supplier_id&&p.kind==='supplier');if(!partner)fail('22023','Supplier required');
   let s=db.shipments.find(s=>s.supplier_id===partner.id&&s.status==='open');if(!s){s={id:uid(),supplier_id:partner.id,supplier_name:partner.name,status:'open',note:'',opened_by:label(a.actor_label),created_at:now(),sent_at:null};db.shipments.unshift(s);}return copy(s);},
  shared_return_pack(a){const scanned=clean(a.code);if(!scanned||scanned.length>256)fail('22023','Invalid code');const s=db.shipments.find(s=>s.id===a.shipment_id);if(!s||s.status!=='open')fail('22023','Carton closed');
   const waiting=db.actions.filter(x=>x.kind==='supplier_return'&&x.status==='to_send'&&x.supplier_id===s.supplier_id&&(!x.shipment_id||x.shipment_id===s.id)&&matching({lines:[dossier(x.case_id).document.lines.find(l=>l.id===x.line_id)]},scanned).length)
    .sort((p,q)=>q.packed_quantity-p.packed_quantity||new Date(p.created_at)-new Date(q.created_at)||(p.id<q.id?-1:1));
   if(!waiting.length)fail('PT404','No waiting part for this code');const x=waiting[0],before=x.status;x.packed_quantity++;x.shipment_id=s.id;if(x.packed_quantity===x.quantity)x.status='packed';x.version++;x.updated_at=now();
   actionEvent(x,before,'Scan carton : '+x.packed_quantity+' / '+x.quantity,a.actor_label);return copy(x);},
  shared_return_shipment_send(a){const words=clean(a.note);if(words.length>500)fail('22023','Invalid note');const s=db.shipments.find(s=>s.id===a.shipment_id);if(!s||s.status!=='open')fail('22023','Carton closed');
   if(db.actions.some(x=>x.shipment_id===s.id&&x.status==='to_send'))fail('22023','A line is partly scanned');if(!db.actions.some(x=>x.shipment_id===s.id&&x.status==='packed'))fail('22023','Empty carton');
   for(const x of db.actions.filter(x=>x.shipment_id===s.id&&x.status==='packed')){x.status='sent';x.version++;x.updated_at=now();closeIfDone(dossier(x.case_id));actionEvent(x,'packed',words,a.actor_label);}
   s.status='sent';s.sent_at=now();s.note=words;return copy(s);}};
 /* As SharedAccess.call: the answer, or a thrown {code,message}. */
 function call(name,args={}){db.calls.push(name);if(!Object.hasOwn(F,name))throw {code:'PGRST202',message:'Could not find the function public.'+name};return copy(F[name](args));}
 /* As supabase.rpc: never throws. */
 async function rpc(name,args={}){try{return {data:call(name,args),error:null};}catch(e){if(e&&e.code)return {data:null,error:e};throw e;}}
 return {db,call,rpc,functions:Object.keys(F)};}
root.createReturnsFakeServer=createReturnsFakeServer;if(typeof module!=='undefined')module.exports={createReturnsFakeServer};
})(typeof globalThis!=='undefined'?globalThis:this);
