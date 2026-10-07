(function(root){
 'use strict';
 const STATUS=Object.freeze({requested:'À enlever',collected:'Collecté',received:'Réceptionné',supplier_ready:'Prêt fournisseur',sent:'Envoyé fournisseur',credit_pending:'Avoir attendu',credited:'Avoir reçu',cancelled:'Annulé'});
 const NEXT=Object.freeze({requested:['collected','cancelled'],collected:['received','cancelled'],received:['supplier_ready','cancelled'],supplier_ready:['sent','cancelled'],sent:['credit_pending','cancelled'],credit_pending:['credited','cancelled'],credited:[],cancelled:[]});
 const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
 function quantity(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>100000)throw Error('Quantité invalide.');return n;}
 function newLine(product={}){return {id:crypto.randomUUID(),product_id:product.id||null,reference:norm(product.reference),description:String(product.description||'').trim(),quantity:1,received_quantity:null,condition:'',reason:''};}
 function validateLine(line){if(!line||typeof line.id!=='string'||!line.id||!norm(line.reference)||norm(line.reference).length>120||String(line.description||'').length>500)throw Error('Ligne retour invalide.');quantity(line.quantity);if(line.received_quantity!==null&&line.received_quantity!==undefined){const n=Number(line.received_quantity);if(!Number.isSafeInteger(n)||n<0||n>line.quantity)throw Error('Quantité réceptionnée invalide.');}if(String(line.condition||'').length>300||String(line.reason||'').length>500)throw Error('Informations de ligne trop longues.');}
 function validateDocument(d){if(!d||!['return','warranty','mixed'].includes(d.type)||!Object.hasOwn(STATUS,d.status)||typeof d.client_name!=='string'||!d.client_name.trim()||d.client_name.length>180||typeof d.supplier_name!=='string'||d.supplier_name.length>180||!Array.isArray(d.lines)||!d.lines.length||d.lines.length>200)throw Error('Dossier retour incomplet.');const ids=new Set();for(const line of d.lines){validateLine(line);if(ids.has(line.id))throw Error('Ligne retour dupliquée.');ids.add(line.id);}return d;}
 function canMove(from,to){return NEXT[from]?.includes(to)===true;}
 function badge(cases){return cases.filter(c=>c.document?.status==='requested').length;}
 function search(cases,query='',status=''){const q=norm(query);return cases.filter(c=>!status||c.document.status===status).filter(c=>!q||norm([c.document.client_name,c.document.supplier_name,c.document.type,...c.document.lines.flatMap(l=>[l.reference,l.description])].join(' ')).includes(q)).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));}
 const api={STATUS,NEXT,norm,quantity,newLine,validateLine,validateDocument,canMove,badge,search};
 if(typeof module!=='undefined')module.exports=api;else root.ReturnsCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
