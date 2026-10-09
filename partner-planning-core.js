(function(g){'use strict';const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/* Internal delivery rounds of the shop. A garage is attached to a round by its identifier in
   details.tours; nothing here invents an hour. Charlie is the only round with fixed departures;
   the others leave when the delivery notes are ready. Ludovic reinforces the other rounds: he has
   no garage list of his own, so no garage is duplicated for him. */
const TOURS=Object.freeze([
 {id:'damian',name:'Damian',zone:'Bayonne / Anglet / Biarritz / Bassussary / Arcangues / Arbonne'},
 {id:'maxime',name:'Maxime',zone:'Bayonne / Anglet / Biarritz / Boucau'},
 {id:'charlie',name:'Charlie',zone:'Saint-Jean-de-Luz / Urrugne / Ciboure / Ascain / Saint-Pée-sur-Nivelle',fixed:Object.freeze({times:Object.freeze(['10:00','15:00']),days:Object.freeze([1,2,3,4,5])})},
 {id:'cedric',name:'Cédric',zone:'Bayonne / Boucau / Tarnos / Mouguerre / Ondres'}]);
const REINFORCEMENT=Object.freeze({id:'ludovic',name:'Ludovic'});
const NO_FIXED_TIME='Tournée interne — horaire selon BL';
/* Rounds of a garage, in the order above. Unknown or repeated identifiers are ignored. */
function tours(p){const chosen=Array.isArray(p?.details?.tours)?p.details.tours:[];return TOURS.filter(t=>chosen.includes(t.id));}
/* Rounds of a garage that have no recorded departure for it: shown with a sentence, never an hour. */
function unscheduled(p){return tours(p).filter(t=>!(p.departures||[]).some(s=>norm(s.carrier)===norm(t.name))).map(t=>({...t,label:t.name+' · '+(t.fixed?'tournée interne — départs fixes à enregistrer':NO_FIXED_TIME.charAt(0).toLowerCase()+NO_FIXED_TIME.slice(1))}));}
/* The fixed departures of a round, ready to be added to a garage record (Charlie only). */
function fixedSlots(id){const t=TOURS.find(t=>t.id===id);return t?.fixed?t.fixed.times.map(time=>({mode:'internal',carrier:t.name,time,cutoff:'',sector:t.zone,place:'',notes:'',days:[...t.fixed.days]})):[];}
/* Services offered by the filter: every internal round (even before any garage is attached),
   Ludovic as reinforcement, then the carriers found in the recorded departures. A carrier that
   bears the name of a round is that round, not a second entry. */
function services(partners){const names=new Set([...TOURS,REINFORCEMENT].map(t=>norm(t.name)));
 const carriers=[...new Set(active(partners).flatMap(p=>(p.departures||[]).map(s=>s.carrier)))].filter(c=>c&&!names.has(norm(c))).sort((a,b)=>a.localeCompare(b,'fr'));
 return [...TOURS.map(t=>({value:'tour:'+t.id,label:t.name+' · tournée interne'})),{value:'tour:'+REINFORCEMENT.id,label:REINFORCEMENT.name+' · renfort des tournées internes'},...carriers.map(c=>({value:'carrier:'+c,label:c}))];}
function inService(p,value){if(!value)return true;const [type,key]=[value.slice(0,value.indexOf(':')),value.slice(value.indexOf(':')+1)];
 if(type==='carrier')return (p.departures||[]).some(s=>s.carrier===key);
 if(type!=='tour')return false;
 if(key===REINFORCEMENT.id)return tours(p).length>0;
 const t=TOURS.find(t=>t.id===key);return !!t&&(tours(p).includes(t)||(p.departures||[]).some(s=>norm(s.carrier)===norm(t.name)));}
/* Search: every word must be found. A word also matches when only doubled letters differ
   (« carosserie » finds « Carrosserie », « Scannia » finds « Scania »); other spellings are found
   through the aliases written on the record. Records are never merged by the search. */
const fold=v=>norm(v).replace(/([a-z])\1+/g,'$1');
function searchText(p){const d=p.details||{},rounds=tours(p);
 return [p.name,...Object.entries(d).filter(([k])=>k!=='tours').map(([,v])=>Array.isArray(v)?v.join(' '):v),...rounds.flatMap(t=>[t.name,t.zone]),rounds.length?REINFORCEMENT.name:'',rounds.length?'tournee interne':'',...(p.departures||[]).flatMap(s=>[s.carrier,s.sector,s.place])].join(' ');}
function matches(p,q){const raw=searchText(p),text=norm(raw),folded=fold(raw);return norm(q).split(' ').filter(Boolean).every(w=>text.includes(w)||folded.includes(fold(w)));}
function slots(partners,day,q=''){return active(partners).filter(p=>p.kind==='client'&&matches(p,q)).flatMap(p=>(p.departures||[]).filter(s=>s.days.includes(day)).map(s=>({...s,partner:p}))).sort((a,b)=>a.time.localeCompare(b.time)||a.partner.name.localeCompare(b.partner.name,'fr'));}
function validate(slots){const time=/^([01]\d|2[0-3]):[0-5]\d$/;for(const s of slots){if(!s.carrier?.trim()||!time.test(s.time)||!s.days?.length||s.days.some(d=>!Number.isInteger(d)||d<1||d>7))throw Error('Chaque départ exige un livreur ou transporteur, une heure et au moins un jour.');if(s.cutoff&&(!time.test(s.cutoff)||s.cutoff>s.time))throw Error('La limite de préparation doit précéder ou égaler le départ.');}return slots;}
const parisClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function clock(now=new Date()){
 const p=Object.fromEntries(parisClock.formatToParts(now).map(p=>[p.type,p.value]));
 return {year:Number(p.year),month:Number(p.month),date:Number(p.day),day:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(p.weekday)+1,minute:Number(p.hour)*60+Number(p.minute),second:Number(p.second)};
}
function remaining(c,offset,h,m,now){
 const wall=Date.UTC(c.year,c.month-1,c.date+offset,h,m);let stamp=wall;
 for(let i=0;i<3;i++){const z=clock(new Date(stamp));const seen=Date.UTC(z.year,z.month-1,z.date,Math.floor(z.minute/60),z.minute%60,z.second);stamp+=wall-seen;}
 return Math.max(0,Math.ceil((stamp-now.getTime())/60000));
}
function next(partner,now=new Date()){
 const c=clock(now),found=[];
 for(const s of partner.departures||[]){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)||!Array.isArray(s.days))continue;
  const [h,m]=s.time.split(':').map(Number),minute=h*60+m;
  for(let offset=0;offset<=7;offset++){
   const day=(c.day-1+offset)%7+1;
   if(!s.days.includes(day)||(offset===0&&minute<c.minute))continue;
   found.push({...s,offset,day,minutes:remaining(c,offset,h,m,now)});break;
  }
 }
 found.sort((a,b)=>a.minutes-b.minutes||a.carrier.localeCompare(b.carrier,'fr'));
 return found;
}
function label(s){if(!s)return 'Horaire non renseigné';if(s.minutes===0)return 'Départ maintenant';
 const day=s.offset>0?' · '+(s.offset===1?'Demain':['','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'][s.day])+' à '+s.time:'';
 const days=Math.floor(s.minutes/1440),hours=Math.floor(s.minutes%1440/60),minutes=s.minutes%60;
 const duration=[days?days+' j':'',hours?hours+' h':'',minutes?minutes+' min':''].filter(Boolean).join(' ');
 return 'Il reste '+duration+' avant le départ'+day;
}
function active(partners){return partners.filter(p=>!p.details?.merged_into&&p.details?.archived!==true);}
const api={norm,fold,matches,slots,validate,clock,next,label,active,TOURS,REINFORCEMENT,NO_FIXED_TIME,tours,unscheduled,fixedSlots,services,inService};if(typeof module!=='undefined')module.exports=api;else g.PartnerPlanning=api;})(globalThis);
