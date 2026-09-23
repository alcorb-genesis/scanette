(()=>{'use strict';
const $=id=>document.getElementById(id),map=window.deliveryMap,shop='8770297c-cadb-4cc6-8b93-55a0f9bd154e',G=GarageRecords;
let directory=[],partners=[],markers=[],epoch=0,db,actor=null,write=false,busy=false,editing=null,privateStatus='Connexion requise pour les garages du magasin.',publicError=false;
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function coordinates(c){return c&&typeof c.lat==='number'&&typeof c.lon==='number'&&Number.isFinite(c.lat)&&Number.isFinite(c.lon)&&Math.abs(c.lat)<=90&&Math.abs(c.lon)<=180?[c.lat,c.lon]:null;}
function places(){
 const sources=new Set(partners.flatMap(p=>[p.source_key,p.details?.siret]).filter(Boolean)),out=[];
 for(const p of partners){const matches=directory.filter(d=>d.id===p.source_key||d.siret&&d.siret===p.source_key),source=matches.length===1?matches[0]:null,point=coordinates(p.details?.coordinates)||coordinates(source?.coordinates);out.push({name:p.name,city:p.details?.city||source?.city||'',address:p.details?.address||source?.address||'',point,store:true,record:p,archived:G.archived(p)});}
 if($('publicGarages').checked)for(const p of directory){if(sources.has(p.id)||p.siret&&sources.has(p.siret))continue;out.push({name:p.name,city:p.city||'',address:p.address||'',point:coordinates(p.coordinates),store:false,record:p,archived:false});}return out;
}
function button(label,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=!write||busy;b.onclick=action;return b;}
function actions(p){const box=document.createElement('div');box.className='garage-actions';
 if(p.archived)box.append(button('Restaurer',()=>change(p,false)));
 else {if(!p.store)box.append(button('Ajouter au magasin',()=>edit(p)));else box.append(button('Modifier la fiche',()=>edit(p)));box.append(button('Supprimer de ma liste',()=>change(p,true)));}return box;
}
function paint(){
 markers.forEach(m=>m.marker.remove());markers=[];$('garageResults').replaceChildren();
 const q=norm($('garageSearch').value).trim(),all=places(),filtered=all.filter(p=>p.archived===$('archivedGarages').checked&&q.split(/\s+/).every(w=>norm(p.name+' '+p.city).includes(w))),located=all.filter(p=>p.store&&!p.archived&&p.point).length;
 $('garageStatus').textContent=privateStatus+' '+located+' garage(s) du magasin localisé(s). '+(publicError?'Annuaire public indisponible.':'Orange : annuaire public ; violet : garages du magasin.');
 $('addGarage').disabled=!write||busy||!map;$('reloadGarages').disabled=busy;
 for(const p of filtered){if(map&&p.point&&!p.archived&&map.getBounds().contains(p.point)){
  const title=document.createElement('strong'),popup=document.createElement('div'),text=document.createElement('p');title.textContent=p.name;text.textContent=[p.name,p.city,p.address,p.store?'Garage du magasin':'Annuaire public — emplacement à vérifier'].filter(Boolean).join(' · ');popup.append(text,actions(p));
  const marker=L.circleMarker(p.point,{radius:7,color:'#fff',weight:2,fillColor:p.store?'#8c40b0':'#c56b0a',fillOpacity:1}).addTo(map).bindTooltip(title,{permanent:map.getZoom()>=14,direction:'top',className:'garage-label'+(p.store?' store':'')}).bindPopup(popup);
  marker.on('contextmenu',e=>{L.DomEvent.stopPropagation(e.originalEvent);marker.openPopup();});markers.push({marker,p});
 }}
 if(q||$('archivedGarages').checked){for(const p of filtered.slice(0,40)){const row=document.createElement('article'),b=document.createElement('button');row.className='garage-result';b.type='button';b.textContent=[p.name,p.city,p.address,p.archived?'Retiré':p.store?'Magasin':'Annuaire'].filter(Boolean).join(' · ');b.disabled=!map||!p.point;b.onclick=()=>map.setView(p.point,17);row.append(b,actions(p));$('garageResults').append(row);}if(!filtered.length)$('garageResults').textContent='Aucun garage correspondant.';}
}
function edit(p,latlng){if(!write||busy||$('garageDialog').open)return;editing=p?(p.store?structuredClone(p.record):G.fromPublic(p.record)):{id:crypto.randomUUID(),kind:'client',name:'',source_key:'',version:0,departures:[],details:{coordinates:{lat:latlng.lat,lon:latlng.lng}}};
 $('garageForm').reset();for(const k of ['name','city','address','phone','email'])$('garage-'+k).value=k==='name'?editing.name:editing.details?.[k]||'';
 $('garageFormStatus').textContent='';$('garageDialog').showModal();$('garage-name').focus();
}
async function save(p,details=p.details){if(!write||busy)return false;const ticket=epoch;busy=true;paint();$('garageSave').disabled=true;
 try{const r=await db.rpc('gestion_save_partner',G.request(shop,p,details));if(ticket!==epoch)return false;if(r.error)throw r.error;const saved=Array.isArray(r.data)?r.data[0]:r.data;if(!saved?.id)throw Error();const i=partners.findIndex(x=>x.id===saved.id);if(i<0)partners.push(saved);else partners[i]=saved;$('garageActionStatus').textContent=G.archived(saved)?'Garage retiré. Vous pouvez le restaurer dans « Garages retirés ».':'Fiche enregistrée dans le magasin.';return true;
 }catch(e){if(ticket===epoch){$('garageActionStatus').textContent=G.error(e);$('garageFormStatus').textContent=G.error(e);}return false;}finally{if(ticket===epoch){busy=false;$('garageSave').disabled=false;paint();}}
}
async function change(p,remove){if(!write||busy)return;if(remove&&!confirm('Retirer « '+p.name+' » de la carte, de la recherche et des départs du magasin ? La fiche et ses horaires seront conservés pour pouvoir la restaurer.'))return;const record=p.store?p.record:G.fromPublic(p.record);await save(record,G.archive(record,remove));}
$('garageForm').onsubmit=async e=>{e.preventDefault();if(!editing)return;const p={...editing,name:$('garage-name').value.trim()},details={...editing.details,archived:false};if(!p.name)return;for(const k of ['city','address','phone','email'])details[k]=$('garage-'+k).value.trim();if(await save(p,details)){$('garageDialog').close();editing=null;}};
$('garageCancel').onclick=()=>{if(!busy){$('garageDialog').close();editing=null;}};$('garageDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('garageSearch').oninput=paint;$('publicGarages').onchange=paint;$('archivedGarages').onchange=paint;
$('addGarage').onclick=()=>edit(null,map.getCenter());$('reloadGarages').onclick=()=>enter(actor?{user:{id:actor}}:null);
if(map){map.on('moveend',paint);map.on('contextmenu',e=>{if(!e.propagatedFrom&&!$('garageDialog').open)edit(null,e.latlng);});
 const container=map.getContainer();let timer=null,start=null;const cancel=()=>{clearTimeout(timer);timer=null;start=null;};
 container.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'||!write)return;if(start){cancel();return;}start={x:e.clientX,y:e.clientY};const target=e.target,latlng=map.mouseEventToLatLng(e);timer=setTimeout(()=>{const found=markers.find(m=>m.marker.getElement()===target);if(found)found.marker.openPopup();else if(!target.closest('button,a,.leaflet-control,.leaflet-popup'))edit(null,latlng);cancel();},700);});
 container.addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>12)cancel();});for(const event of ['pointerup','pointercancel','pointerleave'])container.addEventListener(event,cancel);map.on('movestart',cancel);document.addEventListener('visibilitychange',cancel);
}
async function enter(session){const ticket=++epoch;actor=session?.user?.id||null;write=false;busy=false;editing=null;$('garageDialog').close();$('garageForm').reset();partners=[];privateStatus=session?'Chargement des fiches du magasin…':'Connexion requise pour les garages du magasin.';paint();if(!session)return;
 try{const member=await db.from('scanette_members').select('role').eq('workspace_id',shop).eq('user_id',actor).maybeSingle();if(ticket!==epoch)return;if(member.error||!member.data)throw Error();const loaded=[];for(let from=0;;from+=500){const r=await db.from('gestion_partners').select('*').eq('workspace_id',shop).eq('kind','client').order('id').range(from,from+499);if(ticket!==epoch)return;if(r.error)throw r.error;loaded.push(...r.data);if(r.data.length<500)break;}partners=loaded.filter(p=>!p.details?.merged_into);write=['admin','operator'].includes(member.data.role);privateStatus=write?'Appui long sur la carte pour ajouter un garage ; cliquez sur un repère pour le gérer.':'Fiches du magasin en consultation.';}catch{if(ticket!==epoch)return;partners=[];privateStatus='Fiches du magasin indisponibles. Actualisez pour réessayer.';}paint();
}
fetch('partners-osm-data.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{directory=(data.entries||[]).filter(p=>p.kind==='garage'&&['64','40'].includes(p.department));paint();}).catch(()=>{publicError=true;paint();});
try{db=window.parent!==window&&window.parent.AlcorbAuth||supabase.createClient('https://pryocchvwmnuoidtitow.supabase.co','sb_publishable_AQ9cr2Z7Kr6EAravVOgB9Q_Z5Mx2yOZ');db.auth.onAuthStateChange((_e,s)=>setTimeout(()=>enter(s),0));db.auth.getSession().then(r=>enter(r.data.session)).catch(()=>{privateStatus='Connexion au magasin indisponible.';paint();});}catch{paint();}
})();
