/* Retours et garanties: what happens to a received part. One decision = one row of
   returns_line_actions on the server; « Pièces abîmées », the supplier queues, « Avoirs à faire »,
   the cartons and « En attente » are filters over the same rows, joined here to the dossiers the page
   already holds. Nothing is copied, nothing is guessed: scans match exactly or not at all. */
(function(root){
'use strict';
const KINDS=Object.freeze({
 damaged:Object.freeze({label:'Abîmée',action:'Abîmée',first:'recorded'}),
 supplier_return:Object.freeze({label:'Retour fournisseur',action:'Retour fournisseur',first:'to_send'}),
 customer_credit:Object.freeze({label:'Avoir client',action:'Avoir client',first:'to_do'}),
 pending:Object.freeze({label:'Attente de décision',action:'Attente de décision',first:'open'}),
 /* returns-roles.sql: announced and not received, declared at the end of the reception. */
 missing:Object.freeze({label:'Manquante',action:'Manquante',first:'open'})});
const STATES=Object.freeze({recorded:'Constatée',to_send:'À envoyer',packed:'Dans le carton',sent:'Envoyée au fournisseur',to_do:'Avoir à faire',issued:'Avoir édité',restocked:'Remis en stock',closed_no_stock:'Clôturé sans stock',open:'En attente',resolved:'Décision prise',cancelled:'Annulée'});
/* Steps an agent takes by hand. « packed » comes only from an exact rescan, « sent » only from the carton. */
const NEXT=Object.freeze({customer_credit:Object.freeze({to_do:['issued'],issued:['restocked','closed_no_stock']}),pending:Object.freeze({open:['resolved']}),supplier_return:Object.freeze({packed:['to_send']}),damaged:Object.freeze({})});
const STEP=Object.freeze({issued:'Avoir édité',restocked:'Remis en stock',closed_no_stock:'Clôturer sans stock',resolved:'Décision prise',to_send:'Sortir du carton'});
/* What each decision leads to, said before it is recorded. */
const CONSEQUENCE=Object.freeze({damaged:'La pièce rejoint « Pièces abîmées » du garage. Elle peut aussi recevoir un retour fournisseur ou un avoir.',supplier_return:'La pièce rejoint la file du fournisseur. Elle ne part qu’après avoir été re-scannée dans un carton.',customer_credit:'La pièce rejoint « Avoirs clients » du garage, sous ce numéro. Les bureaux éditent l’avoir, puis la pièce est remise en stock ou non.',pending:'La pièce reste dans « À traiter » jusqu’à ce qu’une décision soit prise.'});
const RUNNING=Object.freeze(['to_send','packed','to_do','issued','open']),CANCELLABLE=Object.freeze(['recorded','to_send','to_do','issued','open']);
const DECIDABLE=Object.freeze(['received','supplier_pending','credited']);
const space=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const received=line=>{const n=Number(line?.received_quantity);return line?.received_quantity===null||line?.received_quantity===undefined||line?.received_quantity===''||!Number.isSafeInteger(n)||n<0?0:n;};
const live=a=>a.status!=='cancelled';
const next=a=>NEXT[a.kind]?.[a.status]||[];
const canCancel=a=>CANCELLABLE.includes(a.status)&&!(a.kind==='supplier_return'&&a.status==='packed');

/* ---- Reception: the server decides. A scan is sent as it is (shared_return_receive); the only
   other way is a declared quantity for a line already in the dossier, with one of these causes. ---- */
const CAUSES=Object.freeze([Object.freeze({id:'absent',label:'Pièce absente',hint:'La pièce annoncée n’est pas dans le colis : la ligne est reçue à zéro.'}),Object.freeze({id:'unreadable',label:'Étiquette illisible',hint:'La pièce est là mais son étiquette ne se scanne pas : indiquez combien vous en avez en main.'})]);
/* What is sent for a declared line, or what is missing. Never more than announced. */
function declared(line,cause,quantity,detail){const c=CAUSES.find(x=>x.id===cause);if(!c)return {error:'Choisissez la raison de la saisie manuelle.'};
 if(c.id==='absent')return {quantity:0,reason:[c.label,space(detail)].filter(Boolean).join(' : ')};
 const q=Number(quantity);if(!Number.isSafeInteger(q)||q<1||q>Number(line.quantity))return {error:'Quantité en main entre 1 et '+line.quantity+' (annoncé).'};
 return {quantity:q,reason:[c.label,space(detail)].filter(Boolean).join(' : ')};}
/* Announced, received, and whether the line still waits for its control. */
function progress(lines){const announced=lines.reduce((n,l)=>n+Number(l.quantity||0),0),got=lines.reduce((n,l)=>n+received(l),0),waiting=lines.filter(l=>l.received_quantity===null||l.received_quantity===undefined||l.received_quantity==='').length;return {announced,received:got,waiting,complete:waiting===0};}

/* ---- Decisions ---- */
const of=(actions,caseId,lineId)=>actions.filter(a=>a.case_id===caseId&&a.line_id===lineId);
function remaining(line,actions,kind){return received(line)-actions.filter(a=>a.kind===kind&&live(a)).reduce((n,a)=>n+a.quantity,0);}
/* What is missing before a decision can be recorded: '' when it can. The server repeats every rule. */
function problem(draft,line,lineActions,dossierStatus){
 if(!KINDS[draft.kind])return 'Choisissez une suite.';
 if(!DECIDABLE.includes(dossierStatus))return 'Validez d’abord la réception du dossier.';
 const left=remaining(line,lineActions,draft.kind),q=Number(draft.quantity);
 if(received(line)<1)return 'Aucune pièce reçue sur cette ligne.';
 if(left<1)return 'Toute la quantité reçue a déjà cette suite.';
 if(!Number.isSafeInteger(q)||q<1||q>left)return 'Quantité entre 1 et '+left+'.';
 if(draft.kind==='supplier_return'&&!draft.supplierId)return 'Choisissez le fournisseur du retour.';
 if(draft.kind==='customer_credit'&&!space(draft.documentNumber))return 'Indiquez le numéro de BL, de facture ou de commande qui fonde l’avoir.';
 if(space(draft.documentNumber).length>60)return 'Numéro trop long (60 caractères).';
 if((draft.kind==='damaged'||draft.kind==='pending')&&!space(draft.comment))return draft.kind==='damaged'?'Décrivez le dommage constaté.':'Indiquez ce qui est attendu pour décider.';
 if(space(draft.comment).length>500)return 'Commentaire trop long (500 caractères).';
 return '';}
/* Arguments of shared_return_action_move. Put back in stock says where; no other step does. */
function movePayload(action,target,{note='',destination=''}={},actor=''){return {action_id:action.id,to_status:target,note:space(note),expected_version:action.version,actor_label:space(actor).slice(0,60),stock_destination:target==='restocked'?space(destination).slice(0,80):''};}
function moveProblem(target,{note='',destination=''}={}){if(target==='restocked'&&!space(destination))return 'Indiquez où la pièce est remise en stock (allée, étagère…).';if(target==='cancelled'&&!space(note))return 'Indiquez le motif de l’annulation.';return '';}
/* Arguments of shared_return_action_add, and nothing else. */
function payload(caseId,lineId,draft,actor){return {case_id:caseId,line_id:lineId,action_kind:draft.kind,quantity:Number(draft.quantity),supplier_id:draft.kind==='supplier_return'?draft.supplierId:null,document_number:draft.kind==='customer_credit'?space(draft.documentNumber):'',comment:space(draft.comment),actor_label:space(actor).slice(0,60)};}

/* ---- Views: every row is {action, dossier, line}; a decision whose dossier is not loaded is kept apart, never dropped silently. ---- */
function join(actions,cases){const byId=new Map(cases.map(c=>[c.id,c])),rows=[],orphans=[];for(const action of actions){const dossier=byId.get(action.case_id),line=dossier?.document.lines.find(l=>l.id===action.line_id);if(dossier&&line)rows.push({action,dossier,line});else orphans.push(action);}return {rows,orphans};}
const garage=row=>row.dossier.document.client_name;
const byText=(a,b)=>String(a).localeCompare(String(b),'fr',{numeric:true});
function group(rows,keyOf,labelOf){const map=new Map();for(const row of rows){const key=keyOf(row);if(!map.has(key))map.set(key,{key,label:labelOf(row),rows:[]});map.get(key).rows.push(row);}return [...map.values()].sort((a,b)=>byText(a.label,b.label));}
/* Received lines nobody decided anything for: never lost, shown until a decision exists. */
function undecided(cases,actions){const rows=[];for(const dossier of cases){if(!DECIDABLE.includes(dossier.document.status))continue;for(const line of dossier.document.lines)if(received(line)>0&&!of(actions,dossier.id,line.id).some(live))rows.push({dossier,line});}return rows;}
function views(cases,actions){const {rows,orphans}=join(actions,cases),kind=k=>rows.filter(r=>r.action.kind===k&&live(r.action));
 const supplier=kind('supplier_return'),credit=kind('customer_credit');
 return {orphans,toDecide:undecided(cases,actions),pending:kind('pending').filter(r=>r.action.status==='open'),
  damaged:group(kind('damaged'),garage,garage),
  suppliers:group(supplier,r=>r.action.supplier_id,r=>r.action.supplier_name).map(g=>({...g,supplierId:g.key,toSend:g.rows.filter(r=>r.action.status==='to_send'),packed:g.rows.filter(r=>r.action.status==='packed'),sent:g.rows.filter(r=>r.action.status==='sent')})),
  stock:{restocked:credit.filter(r=>r.action.status==='restocked'),closed:credit.filter(r=>r.action.status==='closed_no_stock')},
  credits:group(credit.filter(r=>['to_do','issued'].includes(r.action.status)),r=>garage(r)+'\u0000'+r.action.document_number,r=>garage(r)+' · '+r.action.document_number).map(g=>({...g,garage:garage(g.rows[0]),documentNumber:g.rows[0].action.document_number,toDo:g.rows.filter(r=>r.action.status==='to_do').length,issued:g.rows.filter(r=>r.action.status==='issued').length})),
  counts:{toDecide:undecided(cases,actions).length+kind('pending').filter(r=>r.action.status==='open').length,damaged:kind('damaged').length,supplier:supplier.filter(r=>r.action.status!=='sent').length,credit:credit.filter(r=>['to_do','issued'].includes(r.action.status)).length,stock:credit.filter(r=>['restocked','closed_no_stock'].includes(r.action.status)).length}};}
/* Content of a carton: the rows that point to it. Complete = every unit of every line in it was scanned. */
function carton(rows,shipmentId){return rows.filter(r=>r.action.shipment_id===shipmentId);}
function cartonCount(rows,shipmentId){const inside=carton(rows,shipmentId),expected=inside.reduce((n,r)=>n+r.action.quantity,0),scanned=inside.reduce((n,r)=>n+(r.action.status==='to_send'?r.action.packed_quantity:r.action.quantity),0);return {lines:inside.length,expected,scanned,complete:expected>0&&scanned===expected};}
/* Where the part went, once the credit is settled. Empty while undecided: never assumed. */
const stockDestination=a=>a.status==='restocked'?'Remis en stock'+(space(a.stock_destination)?' : '+space(a.stock_destination):''):a.status==='closed_no_stock'?'Non remis en stock':'';
const dossierRef=dossier=>'R-'+String(dossier.id).slice(0,8).toUpperCase();
const day=value=>{const t=new Date(value);return isNaN(t)?'':String(t.getDate()).padStart(2,'0')+'/'+String(t.getMonth()+1).padStart(2,'0')+'/'+t.getFullYear();};
function csvCell(value){const text=String(value??'');return '"'+(/^[=+\-@]/.test(text)?"'":'')+text.replace(/"/g,'""')+'"';}
/* For the offices. The supplier is given when a supplier return exists for the same line. */
function csv(rows,allRows=rows){const headers=['Date','Garage','Dossier','Référence','Désignation','Quantité','BL / facture / commande','Fournisseur','Motif / commentaire','Classement','Statut','Destination stock'];
 const supplierOf=row=>row.action.supplier_name||[...new Set(allRows.filter(r=>r.dossier.id===row.dossier.id&&r.line.id===row.line.id&&r.action.kind==='supplier_return'&&live(r.action)).map(r=>r.action.supplier_name))].join(' / ');
 const comment=row=>[row.action.comment,row.line.reason].map(space).filter(Boolean).join(' · ');
 return '﻿'+[headers,...rows.map(row=>[day(row.action.created_at),garage(row),dossierRef(row.dossier),row.line.reference,row.line.description||'',row.action.quantity,row.action.document_number,supplierOf(row),comment(row),KINDS[row.action.kind].label,STATES[row.action.status]||row.action.status,stockDestination(row.action)])].map(v=>v.map(csvCell).join(';')).join('\r\n');}
/* Journal line of a decision. */
function eventMessage(e,lines=[]){const line=lines.find(l=>l.id===e.line_id),what=(KINDS[e.action_kind]?.label||'Pièce')+(line?' · '+line.reference:'');
 return what+' : '+(e.action_from?(STATES[e.action_from]||e.action_from)+' → ':'')+(STATES[e.action_to]||e.action_to||'enregistrée');}
/* The page receives the refusal as the shared access hands it over: its code, and the wording of
   the server in « original » (the message itself is a generic sentence). */
function serverMessage(e){const m=String(e?.original||e?.message||'');
 if(e?.code==='PT404'&&/Not a part of this dossier/.test(m))return 'Ce code ne correspond exactement à aucune ligne de ce dossier. Pièce non validée : mettez-la de côté.';
 if(e?.code==='PT404')return 'Aucune pièce en attente pour ce fournisseur ne correspond exactement à ce code. Rien n’a été ajouté au carton.';
 if(/Line already complete/.test(m))return 'Cette ligne est déjà reçue en totalité : la pièce en plus ne fait pas partie du dossier. Mettez-la de côté.';if(/Several lines match/.test(m))return 'Plusieurs lignes du dossier portent ce code : déclarez la bonne ligne à la main, avec son motif.';
 if(/Dossier not in reception/.test(m))return 'Ce dossier n’est pas en réception.';if(/Quantity exceeds what was announced/.test(m))return 'La quantité dépasse ce qui était annoncé.';if(/Received quantity is set by the reception/.test(m))return 'Les quantités reçues se valident par scan ou par déclaration de ligne, pas dans le dossier.';
 if(/Stock destination required/.test(m))return 'Indiquez où la pièce est remise en stock.';if(/Reason required/.test(m))return 'Un motif est obligatoire.';
 if(e?.code==='PT409')return 'Cette suite a été modifiée sur un autre appareil. Actualisez puis recommencez.';
 if(/Quantity exceeds/.test(m))return 'La quantité dépasse ce qui a été reçu pour cette suite.';if(/Dossier not received/.test(m))return 'Validez d’abord la réception du dossier.';
 if(/partly scanned/.test(m))return 'Une ligne du carton n’est scannée qu’en partie : terminez-la ou sortez-la du carton.';if(/Empty carton/.test(m))return 'Le carton est vide : scannez au moins une pièce.';
 if(/Carton (closed|already sent)/.test(m))return 'Ce carton est déjà parti.';if(/Open decisions remain/.test(m))return 'Des suites sont encore en cours sur ce dossier : terminez-les ou annulez-les avant de le clôturer.';
 return '';}
const api={KINDS,STATES,NEXT,STEP,CONSEQUENCE,CAUSES,RUNNING,DECIDABLE,space,received,live,next,canCancel,declared,progress,of,remaining,problem,payload,movePayload,moveProblem,cartonCount,join,undecided,views,carton,stockDestination,dossierRef,csv,eventMessage,serverMessage};
root.ReturnsActions=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
