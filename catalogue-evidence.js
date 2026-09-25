(function(root){
 'use strict';
 const clean=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9\s./-]/g,' ').replace(/\s+/g,' ').trim();
 function gtin(value){
  const s=String(value||'');if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(s))return false;
  let sum=0;for(let i=s.length-2,weight=3;i>=0;i--,weight=4-weight)sum+=Number(s[i])*weight;
  return (10-sum%10)%10===Number(s.at(-1));
 }
 function sourceUrl(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch(_){return null;}}
 function vehicles(evidence){return Array.isArray(evidence?.vehicles)?evidence.vehicles.filter(v=>v&&typeof v.make==='string'&&typeof v.model==='string'&&sourceUrl(v.source_url)):[];}
 function searchText(evidence){return vehicles(evidence).map(v=>clean(v.make+' '+v.model)).join(' | ');}
 const api={clean,gtin,sourceUrl,vehicles,searchText};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CatalogueEvidence=api;
})(typeof window!=='undefined'?window:globalThis);
