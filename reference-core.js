(function(scope){
 'use strict';
 const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f.]/g,'').toLowerCase().trim();
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const web=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
 function combine(sirene,osm,official=[]){
  const records=new Map();
  for(const e of sirene){if(!/^\d{14}$/.test(e.siret)||!e.name)continue;const id=e.siret;records.set(id,{...e,id,sources:[{url:'https://annuaire-entreprises.data.gouv.fr/etablissement/'+e.siret,label:'Sirene · Licence Ouverte 2.0'}],quality:'Établissement actif au jour de la collecte'});}
  for(const e of osm){const id=e.siret||e.id;if(!id||!e.name)continue;const old=records.get(id);if(old){old.phone=old.phone||e.phone;old.email=old.email||e.email;old.website=old.website||e.website;old.sources.push({url:e.source,label:'© OpenStreetMap contributors · ODbL'});old.contactQuality='Coordonnées OpenStreetMap à vérifier';}else records.set(id,{...e,id,sources:[{url:e.source,label:'© OpenStreetMap contributors · ODbL'}]});}
  for(const e of official){if(!e.id||!e.name)continue;records.set(e.siret||e.id,{...e,id:e.siret||e.id,sources:[{url:e.source,label:'Site officiel · vérifié le 20/09/2026'}]});}
  return [...records.values()].map(e=>({...e,search:norm([e.name,e.city,e.postcode,e.siret,e.address].join(' '))})).sort((a,b)=>(['64','40'].includes(b.department)?1:0)-(['64','40'].includes(a.department)?1:0)||Number(!a.city)-Number(!b.city)||a.city.localeCompare(b.city,'fr')||a.name.localeCompare(b.name,'fr'));
 }
 function filter(entries,{query='',kind='garage',area='local',contacts=false,selected=null}={}){const q=norm(query),words=q.split(/\s+/).filter(Boolean),score=e=>!q?0:norm(e.city)===q?4:words.includes(norm(e.city))?3:norm(e.name).includes(q)?2:0;return entries.filter(e=>(!kind||e.kind===kind)&&(!area||area==='local'&&['64','40'].includes(e.department)||e.department===area)&&(!contacts||e.phone||e.email)&&(!selected||selected.includes(e.id))&&words.every(w=>e.search.includes(w))).sort((a,b)=>score(b)-score(a));}
 function attach(list,entry,role){if(!entry||!['client','supplier'].includes(role))throw Error('Partenaire invalide');const existing=list.find(x=>x.id===entry.id);if(existing){if(!existing.roles.includes(role))existing.roles.push(role);return false;}list.push({id:entry.id,roles:[role],addedAt:new Date().toISOString(),entry:{...entry,search:undefined}});return true;}
 function validGTIN(code){return /^\d{8}$|^\d{12,14}$/.test(code)&&[...code.slice(0,-1)].reverse().reduce((sum,c,i)=>sum+Number(c)*(i%2?1:3),0)%10===(10-Number(code.at(-1)))%10;}
 const api={norm,escape,web,combine,filter,attach,validGTIN};if(typeof module!=='undefined')module.exports=api;else scope.ReferenceCore=api;
})(globalThis);
