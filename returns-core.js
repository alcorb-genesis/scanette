(function(root){
 'use strict';
 const STATUS=Object.freeze({requested:'À enlever',collected:'Collecté',received:'Réceptionné',supplier_ready:'Prêt fournisseur',sent:'Envoyé fournisseur',credit_pending:'Avoir attendu',credited:'Avoir reçu',cancelled:'Annulé'});
 const NEXT=Object.freeze({requested:['collected','cancelled'],collected:['received','cancelled'],received:['supplier_ready','cancelled'],supplier_ready:['sent','cancelled'],sent:['credit_pending','cancelled'],credit_pending:['credited','cancelled'],credited:[],cancelled:[]});
 /* Steps shown in the header: each groups several states of the workflow. « Tous » has no filter. */
 const STEPS=Object.freeze([
  {id:'pickup',label:'À enlever',statuses:['requested']},
  {id:'shop',label:'Au magasin',statuses:['collected','received','supplier_ready']},
  {id:'supplier',label:'Chez le fournisseur',statuses:['sent','credit_pending']},
  {id:'closed',label:'Clôturés',statuses:['credited','cancelled']},
  {id:'all',label:'Tous',statuses:null}]);
 /* Round services of the shop. Names only: no day, no hour — schedules live in « Départs » when
    someone has entered them, and nothing is assumed here. */
 const TOURS=Object.freeze([
  {id:'serge',name:'Serge'},{id:'damian',name:'Damian'},{id:'paketo_landes',name:'Paketo Landes'},{id:'paketo_bearn',name:'Paketo Béarn'},
  {id:'paketo_pays_basque',name:'Paketo Pays Basque'},{id:'ace',name:'Ace'},{id:'ludovic',name:'Ludovic'},{id:'maxime',name:'Maxime'},
  {id:'charlie',name:'Charlie'},{id:'cedric',name:'Cédric'}]);
 const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
 function quantity(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>100000)throw Error('Quantité invalide.');return n;}
 function newLine(product={}){return {id:crypto.randomUUID(),product_id:product.id||null,reference:norm(product.reference),description:String(product.description||'').trim(),quantity:1,received_quantity:null,condition:'',reason:''};}
 function validateLine(line){if(!line||typeof line.id!=='string'||!line.id||!norm(line.reference)||norm(line.reference).length>120||String(line.description||'').length>500)throw Error('Ligne retour invalide.');quantity(line.quantity);if(line.received_quantity!==null&&line.received_quantity!==undefined){const n=Number(line.received_quantity);if(!Number.isSafeInteger(n)||n<0||n>line.quantity)throw Error('Quantité réceptionnée invalide.');}if(String(line.condition||'').length>300||String(line.reason||'').length>500)throw Error('Informations de ligne trop longues.');}
 function validateDocument(d){if(d&&d.services!==undefined)validateServices(d.services);if(!d||!['return','warranty','deposit','mixed'].includes(d.type)||!Object.hasOwn(STATUS,d.status)||typeof d.client_name!=='string'||!d.client_name.trim()||d.client_name.length>180||typeof d.supplier_name!=='string'||d.supplier_name.length>180||!Array.isArray(d.lines)||!d.lines.length||d.lines.length>200)throw Error('Dossier retour incomplet.');const ids=new Set();for(const line of d.lines){validateLine(line);if(ids.has(line.id))throw Error('Ligne retour dupliquée.');ids.add(line.id);}return d;}
 /* A case may belong to several services. Stored as a list of service ids on the document. */
 const tourName=id=>TOURS.find(t=>t.id===id)?.name||'';
 function validateServices(list){if(!Array.isArray(list)||list.length>TOURS.length||new Set(list).size!==list.length||list.some(id=>!tourName(id)))throw Error('Service de tournée inconnu.');return list;}
 /* Services of a case, in the order of the list above. Unknown or duplicated values are ignored on display. */
 function services(d){const chosen=Array.isArray(d?.services)?d.services:[];return TOURS.filter(t=>chosen.includes(t.id)).map(t=>t.id);}
 function stepOf(status){return STEPS.find(s=>s.statuses?.includes(status))?.id||'all';}
 function stepCounts(cases){const counts=Object.fromEntries(STEPS.map(s=>[s.id,0]));for(const c of cases){counts.all++;const step=stepOf(c.document?.status);if(step!=='all')counts[step]++;}return counts;}
 /* Header search and filters: free text, step, type. */
 function filter(cases,{query='',step='all',type=''}={}){const q=norm(query),statuses=STEPS.find(s=>s.id===step)?.statuses||null;
  return cases.filter(c=>(!statuses||statuses.includes(c.document.status))&&(!type||c.document.type===type))
   .filter(c=>!q||norm([c.document.client_name,c.document.supplier_name,STATUS[c.document.status],c.document.pickup_location,...services(c.document).map(tourName),...c.document.lines.flatMap(l=>[l.reference,l.description])].join(' ')).includes(q))
   .sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));}
 /* Every service is always returned, even empty. A case with several services is listed under each
    of them; cases without service come last, in their own group, only when there are some. */
 function groups(list){const out=TOURS.map(t=>({id:t.id,name:t.name,cases:list.filter(c=>services(c.document).includes(t.id))}));
  const free=list.filter(c=>!services(c.document).length);if(free.length)out.push({id:'',name:'Sans tournée',cases:free});return out;}
 /* Editable name of an element. Empty names are filled from the catalogue when it knows the element:
    by product first, else by a reference matching exactly one product. Typed names are never replaced. */
 function prefillNames(lines,products){let filled=0;for(const line of lines){if(String(line.description||'').trim())continue;
   const same=products.filter(p=>p.reference===norm(line.reference)),product=products.find(p=>line.product_id&&p.id===line.product_id)||(same.length===1?same[0]:null);
   const name=String(product?.description||'').trim().slice(0,500);if(name){line.description=name;filled++;}}return filled;}
 function canMove(from,to){return NEXT[from]?.includes(to)===true;}
 function badge(cases){return cases.filter(c=>c.document?.status==='requested').length;}
 function search(cases,query='',status=''){const q=norm(query);return cases.filter(c=>!status||c.document.status===status).filter(c=>!q||norm([c.document.client_name,c.document.supplier_name,c.document.type,...c.document.lines.flatMap(l=>[l.reference,l.description])].join(' ')).includes(q)).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));}
 function csvCell(value){const text=String(value??'');return '"'+(/^[=+\-@]/.test(text)?"'":'')+text.replace(/"/g,'""')+'"';}
 function creditCsv(row){const d=row?.document||row;if(!d)throw Error('Dossier avoir introuvable.');validateDocument(d);const headers=['Dossier','État','Type','Garage','Fournisseur','Référence','Dénomination','À reprendre','Réceptionné','État pièce','Motif'];const rows=d.lines.map(line=>[row.id||'',STATUS[d.status]||d.status,d.type,d.client_name,d.supplier_name,line.reference,line.description,line.quantity,line.received_quantity??'',line.condition,line.reason]);return '\uFEFF'+[headers,...rows].map(values=>values.map(csvCell).join(';')).join('\r\n');}
 function creditMail(row){const d=row.document||row;const subject='Avoir à traiter · '+d.client_name+(d.supplier_name?' · '+d.supplier_name:'');const details=d.lines.map(line=>'- '+line.reference+' · '+line.quantity+' à reprendre'+(line.received_quantity!==null&&line.received_quantity!==undefined?' · '+line.received_quantity+' réceptionnée(s)':'')).join('\n');return {subject,body:'Bonjour,\n\nVeuillez trouver ci-joint le relevé de retour / garantie à traiter.\n\nGarage : '+d.client_name+'\nType : '+(d.type==='warranty'?'Garantie':d.type==='deposit'?'Consigne':d.type==='mixed'?'Retour et garantie':'Retour client')+'\n\nPièces :\n'+details+'\n\nCordialement.'};}
 /* Fields that the form does not edit (garage portal origin, pickup place) are carried over unchanged. */
 function mergeDocument(previous,edited){return {...(previous&&typeof previous==='object'?previous:{}),...edited};}
 /* Requests created by garages on the public portal, shown as such to the internal team. */
 function portalInfo(d){if(d?.source!=='public_portal'&&d?.portal!==true)return null;return {location:String(d.pickup_location||'').trim(),verified:d.garage_verified===true||!!d.client_id};}
 const api={STATUS,NEXT,STEPS,TOURS,tourName,validateServices,services,stepOf,stepCounts,filter,groups,prefillNames,norm,quantity,newLine,validateLine,validateDocument,canMove,badge,search,creditCsv,creditMail,mergeDocument,portalInfo};
 if(typeof module!=='undefined')module.exports=api;else root.ReturnsCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
