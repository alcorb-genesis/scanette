/* Retours et garanties, par rôle : ce que chaque écran montre et demande. Pure rules, shared by the
   page and its tests; the server (returns-roles.sql) repeats every one of them.
     Service Retours  organises the collections, then works from lists already sorted;
     Livreur          sees his collections and says « Pris »;
     Réception        scans each part and qualifies it at once: conforming or damaged.
   A part is never routed by hand: the type of the dossier and the answer given at the scan decide. */
(function(root){
'use strict';
const C=typeof module!=='undefined'?require('./returns-core.js'):root.ReturnsCore,A=typeof module!=='undefined'?require('./returns-actions-core.js'):root.ReturnsActions;
const TYPES=Object.freeze({return:'Retour client',warranty:'Garantie'});
const typeOk=type=>Object.hasOwn(TYPES,type);
const typeLabel=type=>TYPES[type]||(type==='deposit'?'Consigne (ancien type)':type==='mixed'?'Retour et garantie (ancien type)':'Type à préciser');
/* Where a received unit goes. Said to the agent after the scan, decided by the server. */
const QUEUE=Object.freeze({damaged:'Pièces abîmées',customer_credit:'Avoirs clients',supplier_return:'Retours fournisseur',missing:'Écarts'});
const destination=(type,state)=>state==='damaged'?QUEUE.damaged:type==='return'?QUEUE.customer_credit:type==='warranty'?QUEUE.supplier_return:'';

/* ---- Planned passage: a local day and hour, 'YYYY-MM-DDTHH:MM'. ---- */
const SLOT=/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/,pad=n=>String(n).padStart(2,'0'),DAYS=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
const slotValue=date=>date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());
const slotDate=value=>{if(!SLOT.test(String(value||'')))return null;const [d,t]=value.split('T'),[y,m,day]=d.split('-').map(Number),[h,min]=t.split(':').map(Number),date=new Date(y,m-1,day,h,min);return date.getMonth()===m-1&&date.getDate()===day&&h<24&&min<60?date:null;};
function slotLabel(value,now=new Date()){const date=slotDate(value);if(!date)return 'passage à préciser';
 const days=Math.round((new Date(date.getFullYear(),date.getMonth(),date.getDate())-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/864e5),hour=pad(date.getHours())+':'+pad(date.getMinutes());
 return (days===0?'aujourd’hui':days===1?'demain':DAYS[date.getDay()]+' '+pad(date.getDate())+'/'+pad(date.getMonth()+1))+' à '+hour;}
const late=(value,now=new Date())=>{const date=slotDate(value);return !!date&&date<now;};
/* The next known passages of this service at this garage, from its record in « Départs ». Never invented:
   a garage without a known hour for this service gets no proposal, and the day and hour are typed. */
function proposals(partner,collectorId,planning,now=new Date()){if(!partner||!planning||!C.collector(collectorId))return [];
 const seen=new Set(),out=[];for(const s of planning.next({...partner,departures:(partner.departures||[]).filter(d=>C.collectorOfCarrier(d.carrier)===collectorId)},now)){
  const [h,m]=s.time.split(':').map(Number),date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+s.offset,h,m),value=slotValue(date);if(seen.has(value))continue;seen.add(value);out.push({value,label:slotLabel(value,now)});}
 return out.slice(0,4);}
/* What is missing before a collection can be assigned: '' when it can. */
function planProblem({collector,pickupAt,type}){if(!typeOk(type))return 'Choisissez le type du dossier : retour client ou garantie.';if(!C.collector(collector))return 'Choisissez le livreur.';if(!slotDate(pickupAt))return 'Choisissez le passage : jour et heure.';return '';}
const planned=d=>!!C.collector(d.collector)&&!!slotDate(d.pickup_at);

/* ---- Service Retours · Collectes à organiser ---- */
const oldest=(a,b)=>new Date(a.created_at||a.updated_at)-new Date(b.created_at||b.updated_at);
const bySlot=(a,b)=>String(a.document.pickup_at||'9999').localeCompare(String(b.document.pickup_at||'9999'))||oldest(a,b);
function organise(cases){const waiting=cases.filter(c=>c.document?.status==='requested');
 return {toPlan:waiting.filter(c=>!C.collector(c.document.collector)).sort(oldest),
  groups:C.COLLECTORS.map(c=>({...c,cases:waiting.filter(r=>r.document.collector===c.id).sort(bySlot)})).filter(g=>g.cases.length),
  /* An older dossier of another type, already taken: its type is needed before a conforming part can be routed. */
  typeToFix:cases.filter(c=>c.document?.status==='collected'&&!typeOk(c.document.type)).sort(oldest),
  count:waiting.filter(c=>!planned(c.document)).length};}
/* ---- Livreur · Mes collectes: only what is his and still to take. ---- */
const mine=(cases,collectorId)=>C.collector(collectorId)?cases.filter(c=>c.document?.status==='requested'&&c.document.collector===collectorId).sort(bySlot):[];

/* ---- Réception ---- */
const QUALIFYING=Object.freeze(['damaged','supplier_return','customer_credit','pending']);
const lineActions=(actions,dossier,line)=>actions.filter(a=>a.case_id===dossier.id&&a.line_id===line.id&&A.live(a));
/* Units received that carry no qualification: zero when the scan qualifies; positive for parts received before. */
const unqualified=(dossier,line,actions)=>Math.max(0,A.received(line)-lineActions(actions,dossier,line).filter(a=>QUALIFYING.includes(a.kind)).reduce((n,a)=>n+a.quantity,0));
function lineView(dossier,line,actions){const own=lineActions(actions,dossier,line),sum=kinds=>own.filter(a=>kinds.includes(a.kind)).reduce((n,a)=>n+a.quantity,0),expected=Number(line.quantity),received=A.received(line);
 return {expected,received,left:Math.max(0,expected-received),ok:sum(['customer_credit','supplier_return']),damaged:own.filter(a=>a.kind==='damaged'),missing:sum(['missing']),unqualified:['collected','received'].includes(dossier.document.status)?unqualified(dossier,line,actions):0,complete:received>=expected};}
function progress(dossier){const lines=dossier.document.lines;return {expected:lines.reduce((n,l)=>n+Number(l.quantity||0),0),received:lines.reduce((n,l)=>n+A.received(l),0)};}
/* Lines to declare missing at the end: everything announced and not scanned. */
const missing=dossier=>dossier.document.lines.filter(l=>A.received(l)<Number(l.quantity)).map(line=>({line,gap:Number(line.quantity)-A.received(line)}));
/* Dossiers the receiving agent works on: those taken by a driver, and those received with a unit still unqualified.
   Dossiers of the former cycle (« en attente fournisseur », « avoir obtenu ») were settled as a whole: they ask nothing. */
function receiving(cases,actions){const out=[];for(const c of cases){const s=c.document?.status;if(s==='collected')out.push({dossier:c,legacy:false});else if(s==='received'&&c.document.lines.some(l=>unqualified(c,l,actions)>0))out.push({dossier:c,legacy:true});}
 return out.sort((a,b)=>new Date(a.dossier.updated_at)-new Date(b.dossier.updated_at));}
/* What the end of a reception produced, in the words of the queues. */
function outcome(dossier,actions){const own=actions.filter(a=>a.case_id===dossier.id&&A.live(a)),n=kind=>own.filter(a=>a.kind===kind).reduce((s,a)=>s+a.quantity,0),parts=[];
 for(const kind of ['customer_credit','supplier_return','damaged','missing'])if(n(kind))parts.push(n(kind)+' → '+QUEUE[kind]);return parts.join(' · ');}

/* ---- Service Retours · the queues. Every row is {action, dossier, line}. ---- */
const garage=row=>row.dossier.document.client_name,text=(a,b)=>String(a).localeCompare(String(b),'fr',{numeric:true});
function group(rows,keyOf,labelOf){const map=new Map();for(const row of rows){const key=keyOf(row);if(!map.has(key))map.set(key,{key,label:labelOf(row),rows:[]});map.get(key).rows.push(row);}return [...map.values()].sort((a,b)=>text(a.label,b.label));}
function queues(cases,actions){const {rows,orphans}=A.join(actions,cases),of=(kind,states)=>rows.filter(r=>r.action.kind===kind&&states.includes(r.action.status));
 const damaged=of('damaged',['recorded']),credits=of('customer_credit',['to_do']),stock=of('customer_credit',['issued']),supplier=of('supplier_return',['to_send','packed']),gaps=[...of('missing',['open']),...of('pending',['open'])];
 const suppliers=group(supplier,r=>r.action.supplier_id||'',r=>r.action.supplier_id?r.action.supplier_name:'Fournisseur à préciser').map(g=>({...g,supplierId:g.key,toSend:g.rows.filter(r=>r.action.status==='to_send'),packed:g.rows.filter(r=>r.action.status==='packed')}))
  .sort((a,b)=>(a.supplierId?1:0)-(b.supplierId?1:0)||text(a.label,b.label));
 return {orphans,rows,damaged:group(damaged,garage,garage),credits:group(credits,garage,garage),stock:stock.sort((a,b)=>text(garage(a),garage(b))),suppliers,gaps:gaps.sort((a,b)=>new Date(a.action.created_at)-new Date(b.action.created_at)),
  counts:{damaged:damaged.length,credits:credits.length,stock:stock.length,suppliers:supplier.length,gaps:gaps.length}};}

/* ---- Historique: read only. Where a dossier stands, in the words of the screens. ---- */
function stage(dossier){const d=dossier.document,s=d.status;
 if(s==='requested')return C.collector(d.collector)?'À enlever · '+C.collectorName(d.collector):'À organiser';
 if(s==='collected')return 'Pris · en réception';if(s==='received')return 'Reçu · en traitement';if(s==='closed')return 'Terminé';if(s==='cancelled')return 'Annulé';return C.STATUS[s]||'État inconnu';}
function history(cases,query=''){return C.filter(cases,{query});}
/* One line of the journal. */
function eventLine(e,lines=[]){const line=lines.find(l=>l.id===e.line_id),ref=line?' · '+line.reference:'';
 if(e.event_kind==='reception')return 'Réception'+ref;
 if(e.event_kind==='action'&&e.action_kind==='missing')return 'Manquante'+ref+' : '+(e.action_to==='resolved'?'écart réglé':e.action_to==='cancelled'?'annulée':'déclarée');
 if(e.event_kind==='action')return A.eventMessage(e,lines);
 if(e.event_kind==='status_changed'){const label=s=>s==='requested'?'À enlever':s==='collected'?'Pris':s==='received'?'Reçu':s==='closed'?'Terminé':s==='cancelled'?'Annulé':C.STATUS[s]||C.FORMER[s]||'État inconnu';return label(e.from_status)+' → '+label(e.to_status);}
 return C.eventMessage(e);}

/* Refusals of the server, in the words of the agent. */
function serverMessage(e){const m=String(e?.original||e?.message||'');
 if(e?.code==='PT404'&&/Not a part of this dossier/.test(m))return 'Référence inconnue pour ce dossier : pièce refusée, rien n’est enregistré. Mettez-la de côté.';
 if(/Several lines match/.test(m))return 'Plusieurs lignes du dossier portent ce code : saisissez la référence exacte de la pièce.';
 if(/Type required/.test(m))return 'Le type de ce dossier (retour client ou garantie) doit être précisé par le service Retours avant de classer une pièce conforme.';
 if(/Missing parts must be declared/.test(m))return 'Chaque pièce non scannée doit être déclarée manquante avant de terminer.';
 if(/Parts not qualified/.test(m))return 'Une pièce déjà reçue attend sa qualification : conforme ou abîmée.';
 if(/Nothing to qualify/.test(m))return 'Cette pièce est déjà qualifiée.';
 if(/Collection is frozen once taken/.test(m))return 'Le livreur a déjà pris les pièces : l’affectation ne se modifie plus.';
 if(/Already taken/.test(m))return 'Cette collecte est déjà marquée « Pris ».';
 if(/Invalid plan/.test(m))return 'Affectation incomplète : type, livreur, jour et heure du passage.';
 if(/Collector required/.test(m))return 'Ce dossier n’a pas encore de livreur.';
 if(/Document number required/.test(m))return 'Indiquez le numéro de l’avoir.';
 if(/Supplier required/.test(m))return 'Choisissez le fournisseur.';
 if(/Type is fixed/.test(m))return 'Le type ne se modifie plus : une pièce de ce dossier est déjà classée.';
 if(/Return case changed/.test(m)||(e?.code==='PT409'&&!/Decision changed/.test(m)))return 'Ce dossier vient d’être modifié sur un autre appareil. La liste est actualisée : recommencez.';
 if(/Open decisions remain/.test(m))return 'Des pièces de ce dossier sont encore en traitement : il ne peut pas être annulé.';
 if(e?.code==='PT409')return 'Cette ligne vient d’être modifiée sur un autre appareil. La liste est actualisée : recommencez.';
 return A.serverMessage(e);}
const api={TYPES,typeOk,typeLabel,QUEUE,destination,slotValue,slotDate,slotLabel,late,proposals,planProblem,planned,organise,mine,unqualified,lineView,progress,missing,receiving,outcome,queues,stage,history,eventLine,serverMessage};
root.ReturnsFlow=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
