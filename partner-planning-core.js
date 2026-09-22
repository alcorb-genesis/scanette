(function(g){'use strict';const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function matches(p,q){const text=norm([p.name,...Object.values(p.details||{}),...(p.departures||[]).flatMap(s=>[s.carrier,s.sector,s.place])].join(' '));return norm(q).split(' ').filter(Boolean).every(w=>text.includes(w));}
function slots(partners,day,q=''){return partners.filter(p=>p.kind==='client'&&matches(p,q)).flatMap(p=>(p.departures||[]).filter(s=>s.days.includes(day)).map(s=>({...s,partner:p}))).sort((a,b)=>a.time.localeCompare(b.time)||a.partner.name.localeCompare(b.partner.name,'fr'));}
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
function active(partners){return partners.filter(p=>!p.details?.merged_into);}
const api={norm,matches,slots,validate,clock,next,label,active};if(typeof module!=='undefined')module.exports=api;else g.PartnerPlanning=api;})(globalThis);
