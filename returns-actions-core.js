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
 pending:Object.freeze({label:'Attente de décision',action:'Attente de décision',first:'open'})});
const STATES=Object.freeze({recorded:'Constatée',to_send:'À envoyer',packed:'Dans le carton',sent:'Envoyée au fournisseur',to_do:'Avoir à faire',issued:'Avoir édité',restocked:'Remis en stock',closed_no_stock:'Clôturé sans stock',open:'En attente',resolved:'Décision prise',cancelled:'Annulée'});
/* Steps an agent takes by hand. « packed » comes only from an exact rescan, « sent » only from the carton. */
const NEXT=Object.freeze({customer_credit:Object.freeze({to_do:['issued'],issued:['restocked','closed_no_stock']}),pending:Object.freeze({open:['resolved']}),supplier_return:Object.freeze({packed:['to_send']}),damaged:Object.freeze({})});
const STEP=Object.freeze({issued:'Avoir édité',restocked:'Remis en stock',closed_no_stock:'Clôturer sans stock',resolved:'Décision prise',to_send:'Sortir du carton'});
const RUNNING=Object.freeze(['to_send','packed','to_do','issued','open']),CANCELLABLE=Object.freeze(['recorded','to_send','to_do','issued','open']);
const DECIDABLE=Object.freeze(['received','supplier_pending','credited']);
const space=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const received=line=>{const n=Number(line?.received_quantity);return line?.received_quantity===null||line?.received_quantity===undefined||line?.received_quantity===''||!Number.isSafeInteger(n)||n<0?0:n;};
const live=a=>a.status!=='cancelled';
const next=a=>NEXT[a.kind]?.[a.status]||[];
const canCancel=a=>CANCELLABLE.includes(a.status)&&!(a.kind==='supplier_return'&&a.status==='packed');

/* ---- Reception: the scanned or typed code must be exactly a line of the dossier. ----
   products = catalogue records found by the EXACT lookup of that code (may be empty). */
function matchLine(lines,code,products=[]){const value=String(code??'').trim();if(!value)return {line:null,error:''};
 const byBarcode=products.filter(p=>p.internal_barcode===value||p.manufacturer_barcode===value);
 const found=lines.filter(l=>l.reference===value||l.reference===value.toUpperCase()||byBarcode.some(p=>(l.product_id&&p.id===l.product_id)||p.reference===l.reference));
 if(found.length===1)return {line:found[0],error:''};
 return {line:null,error:found.length?'« '+value+' » correspond à plusieurs lignes du dossier : validez la bonne ligne à la main.':'« '+value+' » ne fait pas partie de ce dossier. Pièce non validée : mettez-la de côté.'};}
/* One validated scan = one more unit received on that line. */
function receiveUnit(line){line.received_quantity=received(line)+1;return line;}

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
  credits:group(credit,r=>garage(r)+'\u0000'+r.action.document_number,r=>garage(r)+' · '+r.action.document_number).map(g=>({...g,garage:garage(g.rows[0]),documentNumber:g.rows[0].action.document_number,toDo:g.rows.filter(r=>r.action.status==='to_do').length,issued:g.rows.filter(r=>r.action.status==='issued').length})),
  counts:{toDecide:undecided(cases,actions).length+kind('pending').filter(r=>r.action.status==='open').length,damaged:kind('damaged').length,supplier:supplier.filter(r=>r.action.status!=='sent').length,credit:credit.filter(r=>['to_do','issued'].includes(r.action.status)).length}};}
/* Content of a carton: the rows that point to it. */
function carton(rows,shipmentId){return rows.filter(r=>r.action.shipment_id===shipmentId);}
/* Where the part went, once the credit is settled. Empty while undecided: never assumed. */
const stockDestination=a=>a.status==='restocked'?'Remis en stock':a.status==='closed_no_stock'?'Non remis en stock':'';
const dossierRef=dossier=>'R-'+String(dossier.id).slice(0,8).toUpperCase();
const day=value=>{const t=new Date(value);return isNaN(t)?'':String(t.getDate()).padStart(2,'0')+'/'+String(t.getMonth()+1).padStart(2,'0')+'/'+t.getFullYear();};
function csvCell(value){const text=String(value??'');return '"'+(/^[=+\-@]/.test(text)?"'":'')+text.replace(/"/g,'""')+'"';}
/* For the offices. The supplier is given when a supplier return exists for the same line. */
function csv(rows,allRows=rows){const headers=['Date','Garage','Dossier','Référence','Désignation','Quantité','BL / facture / commande','Fournisseur','Motif / commentaire','Suite','Statut','Destination stock'];
 const supplierOf=row=>row.action.supplier_name||[...new Set(allRows.filter(r=>r.dossier.id===row.dossier.id&&r.line.id===row.line.id&&r.action.kind==='supplier_return'&&live(r.action)).map(r=>r.action.supplier_name))].join(' / ');
 const comment=row=>[row.action.comment,row.line.reason].map(space).filter(Boolean).join(' · ');
 return '﻿'+[headers,...rows.map(row=>[day(row.action.created_at),garage(row),dossierRef(row.dossier),row.line.reference,row.line.description||'',row.action.quantity,row.action.document_number,supplierOf(row),comment(row),KINDS[row.action.kind].label,STATES[row.action.status]||row.action.status,stockDestination(row.action)])].map(v=>v.map(csvCell).join(';')).join('\r\n');}
/* Journal line of a decision. */
function eventMessage(e,lines=[]){const line=lines.find(l=>l.id===e.line_id),what=(KINDS[e.action_kind]?.label||'Suite')+(line?' · '+line.reference:'');
 return what+' : '+(e.action_from?(STATES[e.action_from]||e.action_from)+' → ':'')+(STATES[e.action_to]||e.action_to||'enregistrée');}
function serverMessage(e){const m=String(e?.message||'');
 if(e?.code==='PT404')return 'Aucune pièce en attente pour ce fournisseur ne correspond exactement à ce code. Rien n’a été ajouté au carton.';
 if(e?.code==='PT409')return 'Cette suite a été modifiée sur un autre appareil. Actualisez puis recommencez.';
 if(/Quantity exceeds/.test(m))return 'La quantité dépasse ce qui a été reçu pour cette suite.';if(/Dossier not received/.test(m))return 'Validez d’abord la réception du dossier.';
 if(/partly scanned/.test(m))return 'Une ligne du carton n’est scannée qu’en partie : terminez-la ou sortez-la du carton.';if(/Empty carton/.test(m))return 'Le carton est vide : scannez au moins une pièce.';
 if(/Carton (closed|already sent)/.test(m))return 'Ce carton est déjà parti.';if(/Open decisions remain/.test(m))return 'Des suites sont encore en cours sur ce dossier : terminez-les ou annulez-les avant de le clôturer.';
 return '';}
const api={KINDS,STATES,NEXT,STEP,RUNNING,DECIDABLE,space,received,live,next,canCancel,matchLine,receiveUnit,of,remaining,problem,payload,join,undecided,views,carton,stockDestination,dossierRef,csv,eventMessage,serverMessage};
root.ReturnsActions=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
