/* Retours et garanties: rules shared by the screen and its tests. The server (returns-collectors.sql)
   repeats every rule; this file gives immediate, readable feedback and never invents a value. */
(function(root){
 'use strict';
 /* One cycle, read from left to right. « Clôturé » and « Annulé » are final. */
 const STATUS=Object.freeze({requested:'À enlever',collected:'Collecté',received:'Reçu et contrôlé',supplier_pending:'En attente fournisseur',credited:'Avoir obtenu',closed:'Clôturé',cancelled:'Annulé'});
 /* States of the former cycle, still named in the journal of older dossiers. */
 const FORMER=Object.freeze({supplier_ready:'Prêt fournisseur',sent:'Envoyé fournisseur',credit_pending:'Avoir attendu'});
 const NEXT=Object.freeze({requested:['collected','cancelled'],collected:['received','cancelled'],received:['supplier_pending','credited','closed','cancelled'],supplier_pending:['credited','closed','cancelled'],credited:['closed'],closed:[],cancelled:[]});
 const ACTION=Object.freeze({collected:'Marquer collecté',received:'Valider la réception contrôlée',supplier_pending:'Mettre en attente fournisseur',credited:'Avoir obtenu',closed:'Clôturer le dossier',cancelled:'Annuler le dossier'});
 const OPEN=Object.freeze(['requested','collected','received','supplier_pending','credited']);
 /* The ten collection services, in the order of the team. A dossier has one of them, or none (« À attribuer »). */
 const COLLECTORS=Object.freeze([
  {id:'serge',name:'Serge',kind:'Transporteur'},{id:'damian',name:'Damian',kind:'Tournée interne'},
  {id:'paketo_landes',name:'Paketo Landes',kind:'Transporteur'},{id:'paketo_bearn',name:'Paketo Béarn',kind:'Transporteur'},{id:'paketo_pays_basque',name:'Paketo Pays Basque',kind:'Transporteur'},
  {id:'ace',name:'Ace',kind:'Transporteur'},{id:'ludovic',name:'Ludovic',kind:'Renfort des tournées'},
  {id:'maxime',name:'Maxime',kind:'Tournée interne'},{id:'charlie',name:'Charlie',kind:'Tournée interne'},{id:'cedric',name:'Cédric',kind:'Tournée interne'}].map(Object.freeze));
 const INTERNAL=Object.freeze(['damian','maxime','charlie','cedric']);
 const collector=id=>COLLECTORS.find(c=>c.id===id)||null;
 const collectorName=id=>collector(id)?.name||'À attribuer';
 const norm=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toUpperCase();
 const key=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 /* The service behind a carrier name of a garage record. An unknown name still counts as a service. */
 function collectorOfCarrier(name){const k=key(name);if(!k)return null;
  if(['serge','damian','ludovic','maxime','charlie','cedric'].includes(k))return k;
  if(k==='paketo landes')return 'paketo_landes';if(k==='paketo bearn')return 'paketo_bearn';if(k==='paketo pays basque')return 'paketo_pays_basque';
  if(k==='ace'||k.startsWith('ace '))return 'ace';return 'other:'+k;}
 /* Proposed only when certain: the rounds and recorded carriers of the garage name exactly one
    service, one of the ten, and not the reinforcement. Otherwise '' : the dossier stays « À attribuer ». */
 function certainCollector(partner){if(!partner)return '';
  const rounds=Array.isArray(partner.details?.tours)?partner.details.tours.filter(t=>INTERNAL.includes(t)):[];
  const carriers=(Array.isArray(partner.departures)?partner.departures:[]).map(s=>collectorOfCarrier(s?.carrier)).filter(Boolean);
  const all=[...new Set([...rounds,...carriers])];return all.length===1&&collector(all[0])&&all[0]!=='ludovic'?all[0]:'';}
 function quantity(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>100000)throw Error('Quantité invalide.');return n;}
 function newLine(product={}){return {id:crypto.randomUUID(),product_id:product.id||null,reference:norm(product.reference),description:String(product.description||'').trim(),quantity:1,received_quantity:null,refused_quantity:0,condition:'',reason:''};}
 const filled=value=>value!==null&&value!==undefined&&value!=='';
 function validateLine(line){if(!line||typeof line.id!=='string'||!line.id||!norm(line.reference)||norm(line.reference).length>120||String(line.description||'').length>500)throw Error('Ligne retour invalide.');quantity(line.quantity);
  const got=filled(line.received_quantity)?Number(line.received_quantity):null,refused=filled(line.refused_quantity)?Number(line.refused_quantity):0;
  if(got!==null&&(!Number.isSafeInteger(got)||got<0||got>100000))throw Error('Quantité reçue invalide pour '+line.reference+'.');
  if(!Number.isSafeInteger(refused)||refused<0||refused>(got??0))throw Error('La quantité refusée ne peut pas dépasser la quantité reçue pour '+line.reference+'.');
  if(String(line.condition||'').length>300||String(line.reason||'').length>500)throw Error('Informations de ligne trop longues.');}
 function validateDocument(d){if(!d||!['return','warranty','deposit','mixed'].includes(d.type)||!Object.hasOwn(STATUS,d.status)||typeof d.client_name!=='string'||!d.client_name.trim()||d.client_name.length>180||typeof d.supplier_name!=='string'||d.supplier_name.length>180||!Array.isArray(d.lines)||!d.lines.length||d.lines.length>200)throw Error('Dossier incomplet : indiquez le garage et au moins une pièce.');
  if(filled(d.collector)&&!collector(d.collector))throw Error('Livreur inconnu.');
  if(String(d.pickup_location||'').length>160)throw Error('Emplacement trop long (160 caractères).');if(String(d.credit_reference||'').length>80)throw Error('Numéro d’avoir trop long (80 caractères).');
  const ids=new Set();for(const line of d.lines){validateLine(line);if(ids.has(line.id))throw Error('Ligne retour dupliquée.');ids.add(line.id);}return d;}
 function canMove(from,to){return NEXT[from]?.includes(to)===true;}
 /* A line whose control differs from what was announced: fewer or more parts received, or parts refused. */
 function difference(line){const got=filled(line.received_quantity)?Number(line.received_quantity):null;return got!==null&&(got!==Number(line.quantity)||Number(line.refused_quantity||0)>0);}
 /* What a state requires when it is entered: '' when the step can be taken, otherwise what is missing. */
 function requirement(d,target){
  if(target==='collected'&&!collector(d.collector))return 'Attribuez d’abord le dossier à un livreur : la collecte doit dire qui a enlevé les pièces.';
  if(target==='received'){for(const line of d.lines){if(!filled(line.received_quantity))return 'Contrôlez chaque ligne : indiquez la quantité reçue pour '+line.reference+' (0 si rien n’est arrivé).';if(difference(line)&&!String(line.reason||'').trim())return 'Indiquez le motif de l’écart ou du refus pour '+line.reference+'.';}}
  if((target==='supplier_pending'||target==='credited')&&!String(d.supplier_name||'').trim())return 'Choisissez le fournisseur : il doit être réellement connu pour cette étape.';
  if(target==='credited'&&!String(d.credit_reference||'').trim())return 'Saisissez la référence ou le numéro de l’avoir reçu.';
  return '';}
 /* The collector is a fact once the parts are received. */
 const canReassign=status=>status==='requested'||status==='collected';
 function pieces(d){return {lines:d.lines.length,pieces:d.lines.reduce((sum,line)=>sum+Number(line.quantity||0),0)};}
 function badge(cases){return cases.filter(c=>c.document?.status==='requested').length;}
 /* Collection view: only dossiers really waiting to be picked up, oldest first; none is ever dropped. */
 function collection(cases){const waiting=cases.filter(c=>c.document?.status==='requested').sort((a,b)=>new Date(a.created_at||a.updated_at)-new Date(b.created_at||b.updated_at));
  return {total:waiting.length,unassigned:waiting.filter(c=>!collector(c.document.collector)),groups:COLLECTORS.map(c=>({...c,cases:waiting.filter(r=>r.document.collector===c.id)}))};}
 function counters(cases){const count=Object.fromEntries(Object.keys(STATUS).map(s=>[s,0]));for(const c of cases)if(Object.hasOwn(count,c.document?.status))count[c.document.status]++;count.open=OPEN.reduce((n,s)=>n+count[s],0);count.all=cases.length;return count;}
 function searchText(d){return norm([d.client_name,d.supplier_name,d.pickup_location,d.credit_reference,collectorName(d.collector),STATUS[d.status],...d.lines.flatMap(l=>[l.reference,l.description])].join(' '));}
 /* Filters add up. status: a state, 'open' (in progress) or '' (all). collector: an id, 'none' or ''.
    from / to: days (YYYY-MM-DD) on the creation date, bounds included. */
 function filter(cases,{query='',status='',collector:who='',garage='',supplier='',from='',to=''}={}){const words=norm(query).split(/\s+/).filter(Boolean);
  const day=row=>{const t=new Date(row.created_at||row.updated_at);return isNaN(t)?'':t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');};
  return cases.filter(c=>{const d=c.document;if(status==='open'?!OPEN.includes(d.status):status&&d.status!==status)return false;
   if(who==='none'?!!collector(d.collector):who&&d.collector!==who)return false;
   if(garage&&norm(d.client_name)!==norm(garage))return false;
   if(supplier==='none'?!!String(d.supplier_name||'').trim():supplier&&norm(d.supplier_name)!==norm(supplier))return false;
   if((from&&day(c)<from)||(to&&day(c)>to))return false;
   const text=searchText(d);return words.every(w=>text.includes(w));}).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));}
 function search(cases,query='',status=''){return filter(cases,{query,status});}
 /* Next visit of the assigned collector at this garage: an hour only when the garage record has one. */
 function passage(d,partner,planning,now=new Date()){const who=collector(d.collector);if(!who)return 'Passage : à définir avec l’attribution';
  const slots=partner&&planning?planning.next({...partner,departures:(partner.departures||[]).filter(s=>collectorOfCarrier(s.carrier)===who.id)},now):[];
  if(slots.length)return 'Prochain passage : '+who.name+' à '+slots[0].time+(slots[0].offset===0?' aujourd’hui':slots[0].offset===1?' demain':' '+['','lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'][slots[0].day]);
  if(INTERNAL.includes(who.id)||who.id==='ludovic')return 'Tournée interne — horaire selon BL';
  return 'Prochain passage non connu';}
 function eventMessage(e){const label=s=>STATUS[s]||FORMER[s]||'État inconnu';
  if(e.event_kind==='created')return 'Dossier créé';
  if(e.event_kind==='status_changed')return label(e.from_status)+' → '+label(e.to_status);
  if(e.event_kind==='assigned')return !e.to_collector?'Attribution retirée ('+collectorName(e.from_collector)+') : à attribuer':e.from_collector?'Réattribué : '+collectorName(e.from_collector)+' → '+collectorName(e.to_collector):'Attribué à '+collectorName(e.to_collector);
  return 'Dossier mis à jour';}
 function typeLabel(type){return type==='warranty'?'Garantie':type==='deposit'?'Consigne':type==='mixed'?'Retour et garantie':'Retour';}
 function csvCell(value){const text=String(value??'');return '"'+(/^[=+\-@]/.test(text)?"'":'')+text.replace(/"/g,'""')+'"';}
 function creditCsv(row){const d=row?.document||row;if(!d)throw Error('Dossier introuvable.');validateDocument(d);const headers=['Dossier','État','Type','Garage','Fournisseur','Avoir','Référence','Désignation','Annoncé','Reçu','Refusé','Motif'];const rows=d.lines.map(line=>[row.id||'',STATUS[d.status]||d.status,typeLabel(d.type),d.client_name,d.supplier_name||'Inconnu',d.credit_reference||'Non renseigné',line.reference,line.description,line.quantity,line.received_quantity??'',line.refused_quantity||0,line.reason]);return '﻿'+[headers,...rows].map(values=>values.map(csvCell).join(';')).join('\r\n');}
 function creditMail(row){const d=row.document||row;const subject='Retour à traiter · '+d.client_name+(d.supplier_name?' · '+d.supplier_name:'');const details=d.lines.map(line=>'- '+line.reference+' · '+line.quantity+' annoncée(s)'+(filled(line.received_quantity)?' · '+line.received_quantity+' reçue(s)':'')+(Number(line.refused_quantity||0)?' · '+line.refused_quantity+' refusée(s)':'')+(line.reason?' · '+line.reason:'')).join('\n');return {subject,body:'Bonjour,\n\nVeuillez trouver ci-joint le relevé de retour / garantie à traiter.\n\nGarage : '+d.client_name+'\nType : '+typeLabel(d.type)+'\n\nPièces :\n'+details+'\n\nCordialement.'};}
 /* Fields that the form does not edit (garage portal origin) are carried over unchanged. */
 function mergeDocument(previous,edited){return {...(previous&&typeof previous==='object'?previous:{}),...edited};}
 /* Requests created by garages on the public portal, shown as such to the internal team. */
 function portalInfo(d){if(d?.source!=='public_portal'&&d?.portal!==true)return null;return {location:String(d.pickup_location||'').trim(),verified:d.garage_verified===true||!!d.client_id};}
 const api={STATUS,FORMER,NEXT,ACTION,OPEN,COLLECTORS,collector,collectorName,collectorOfCarrier,certainCollector,norm,quantity,newLine,validateLine,validateDocument,canMove,difference,requirement,canReassign,pieces,badge,collection,counters,filter,search,passage,eventMessage,typeLabel,creditCsv,creditMail,mergeDocument,portalInfo};
 if(typeof module!=='undefined')module.exports=api;else root.ReturnsCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
