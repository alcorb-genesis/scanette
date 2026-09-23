(function(root){'use strict';
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function sameLines(a,b){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
function associate(content,batch){
 if(!batch.id||!Array.isArray(batch.lines)||!batch.lines.length)throw Error('Le pointage est vide.');
 const document=structuredClone(content),old=document.pointages||[];
 if(!Array.isArray(old))throw Error('Historique de pointage invalide.');
 if(!document.pointages)document.unlinked_lines=structuredClone(document.lines||[]);
 document.pointages=old.some(p=>p.id===batch.id)?old.map(p=>p.id===batch.id?structuredClone(batch):p):[...old,structuredClone(batch)];
 const merged=new Map();for(const l of [...(document.unlinked_lines||[]),...document.pointages.flatMap(p=>p.lines)]){
  if(l.quantity!==null&&(!Number.isInteger(l.quantity)||l.quantity<0||l.quantity>1000000))throw Error('Quantité de pointage invalide.');
  const k=l.product_id?'id:'+l.product_id:'ref:'+l.reference;
  if(merged.has(k)){const row=merged.get(k);row.quantity=row.quantity===null&&l.quantity===null?null:(row.quantity||0)+(l.quantity||0);if(row.quantity>1000000)throw Error('Quantité cumulée trop grande.');}else merged.set(k,structuredClone(l));
 }
 document.lines=[...merged.values()];if(document.lines.length>5000)throw Error('Maximum 5 000 références par réception.');return document;
}
function retire(sections,submitted,nextId){
 const index=sections.findIndex(s=>s.id===submitted.id);
 if(index<0)return sections;
 if(JSON.stringify(sections[index])!==JSON.stringify(submitted))throw Error('Le pointage a changé pendant l’enregistrement. Les nouvelles saisies sont conservées ; associez-le de nouveau.');
 const next=sections.filter((s,i)=>i!==index);
 if(index===sections.length-1)next.push({id:nextId,name:submitted.name,items:{}});
 return next;
}
root.ReceiptLinkCore={associate,retire,sameLines};if(typeof module!=='undefined')module.exports=root.ReceiptLinkCore;
})(globalThis);
