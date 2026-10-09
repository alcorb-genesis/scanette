const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),P=require('./partner-planning-core'),B=require('./scripts/build-internal-tours-sql.cjs');
/* Internal delivery rounds in « Départs »: Damian, Maxime, Charlie, Cédric, and Ludovic as
   reinforcement. Source: internal-tours-data.json, the list written by Alexis on 9 October 2026. */
const data=JSON.parse(fs.readFileSync('internal-tours-data.json','utf8')),rows=B.rows();
/* What the shop holds once internal-tours.sql has run on a base that already had a few records,
   computed the way the SQL does: existing records completed, new records created. */
const slot=(carrier,time)=>({days:[1,2,3,4,5],mode:'external',time,notes:'',place:'',cutoff:'',sector:'',carrier});
const before=()=>[
 {id:'e1',kind:'client',name:'CN AUTO',details:{aliases:'',notes:''},departures:[slot('ACE Hendaye','11:15')],version:3},
 {id:'e2',kind:'client',name:'FEU VERT BIDART',details:{aliases:''},departures:[slot('ACE Hendaye','11:15')],version:3},
 {id:'e3',kind:'client',name:'LECLERC ST JEAN DE LUZ',details:{aliases:'Leclerc SJL'},departures:[slot('ACE Hendaye','11:15')],version:3},
 {id:'e4',kind:'client',name:'Garage de la Gare (Cambo)',details:{aliases:'Garage de la Gare ; La Gare Cambo',city:'Cambo-les-Bains'},departures:[slot('Serge','11:00')],version:5},
 {id:'e5',kind:'client',name:'IRIBARREN PATRICK',details:{aliases:''},departures:[slot('Paketo Pays Basque','11:15')],version:2},
 {id:'e6',kind:'client',name:'AUGARAY (ROADY)',details:{aliases:'ROADY (AUGARAY)'},departures:[slot('Serge','11:00')],version:2}];
function apply(shop){const out=structuredClone(shop);
 for(const r of rows){let p=out.find(x=>x.name===(r.existing||r.name));if(r.existing&&!p)continue;
  if(!p){p={id:'n'+out.length,kind:'client',name:r.name,details:structuredClone(r.details),departures:[],version:1};out.push(p);}
  p.details.tours=[...new Set([...(p.details.tours||[]),r.tour])];
  const known=String(p.details.aliases||'').split(';').map(a=>a.trim()).filter(Boolean);for(const a of r.aliases)if(!known.some(k=>k.toLowerCase()===a.toLowerCase()))known.push(a);p.details.aliases=known.join(' ; ');
  for(const s of r.slots)if(!p.departures.some(d=>d.carrier===s.carrier&&d.time===s.time))p.departures.push(structuredClone(s));}
 return out;}
const shop=apply(before()),find=q=>shop.filter(p=>P.matches(p,q)).map(p=>p.name),inRound=id=>shop.filter(p=>P.inService(p,'tour:'+id)).map(p=>p.name);

test('the reference list is complete and holds only what Alexis wrote',()=>{
 const count=t=>data.garages.filter(g=>g.tour===t).length;
 assert.deepEqual([count('damian'),count('maxime'),count('charlie'),count('cedric')],[31,28,19,29]);
 assert.equal(data.garages.some(g=>g.tour==='ludovic'),false,'no garage is duplicated for Ludovic');
 for(const g of data.garages){
  for(const key of Object.keys(g))assert.ok(['tour','name','city','address','network','notes','aliases','existing','match','open'].includes(key),g.name+' → '+key);
  assert.equal(/https?:|www\.|@|\d{2}[ .]\d{2}[ .]\d{2}|\d{5}|\b\d{1,2}\s?[h:]\s?\d{2}\b/.test(JSON.stringify(g)),false,g.name+' holds a link, phone, postcode or hour');
 }
 // The only hours of the file are Charlie's two fixed departures.
 assert.deepEqual(data.tours.filter(t=>t.schedule).map(t=>[t.id,t.schedule.times,t.schedule.days]),[['charlie',['10:00','15:00'],[1,2,3,4,5]]]);
 assert.equal(new Set(data.garages.map(g=>g.name)).size,data.garages.length,'no name twice');
 assert.deepEqual(data.tours.map(t=>t.name),['Damian','Maxime','Charlie','Cédric','Ludovic']);
 assert.deepEqual(P.TOURS.map(t=>[t.id,t.name,t.zone]),data.tours.filter(t=>!t.reinforcement).map(t=>[t.id,t.name,t.zone]),'code and data agree');
});
test('assignment: every garage is found under its round, and only there',()=>{
 for(const t of P.TOURS){const expected=data.garages.filter(g=>g.tour===t.id&&!g.open),names=inRound(t.id);
  for(const g of expected)assert.ok(names.includes(g.existing||g.name)||!shop.some(p=>p.name===g.existing)&&g.existing,t.name+' → '+g.name);}
 assert.ok(inRound('damian').includes('Carro Vans'));assert.ok(inRound('maxime').includes('Norauto Pontot'));assert.ok(inRound('cedric').includes('Scania'));assert.ok(inRound('charlie').includes('CN AUTO'));
 assert.equal(inRound('maxime').includes('Carro Vans'),false);assert.equal(inRound('damian').includes('CN AUTO'),false);
 // Existing carriers stay independent services; a round is not a carrier and the reverse.
 assert.deepEqual(shop.filter(p=>P.inService(p,'carrier:Serge')).map(p=>p.name),['Garage de la Gare (Cambo)','AUGARAY (ROADY)']);
 assert.deepEqual(shop.filter(p=>P.inService(p,'carrier:ACE Hendaye')).map(p=>p.name).sort(),['CN AUTO','FEU VERT BIDART','LECLERC ST JEAN DE LUZ']);
 const services=P.services(shop).map(s=>s.label);
 assert.deepEqual(services.slice(0,5),['Damian · tournée interne','Maxime · tournée interne','Charlie · tournée interne','Cédric · tournée interne','Ludovic · renfort des tournées internes']);
 assert.deepEqual(services.slice(5),['ACE Hendaye','Paketo Pays Basque','Serge'],'Charlie appears once, as a round');
 // The five rounds are offered even before any garage is attached.
 assert.equal(P.services(before()).filter(s=>s.value.startsWith('tour:')).length,5);
});
test('Ludovic reinforces the other rounds: he shows their garages, none is duplicated for him',()=>{
 const all=new Set(['damian','maxime','charlie','cedric'].flatMap(inRound));
 assert.deepEqual(new Set(inRound('ludovic')),all);assert.equal(shop.some(p=>(p.details.tours||[]).includes('ludovic')),false);
 assert.equal(inRound('ludovic').includes('IRIBARREN PATRICK'),false,'a garage without internal round is not his');
 assert.ok(find('ludovic').length===all.size);
});
test('Damian, Maxime and Cédric have no hour: « tournée interne — horaire selon BL »',()=>{
 assert.equal(P.NO_FIXED_TIME,'Tournée interne — horaire selon BL');
 for(const id of ['damian','maxime','cedric'])assert.deepEqual(P.fixedSlots(id),[],id);
 const g=shop.find(p=>p.name==='Carro Vans');assert.deepEqual(g.departures,[]);assert.deepEqual(P.next(g),[],'no next departure is computed');
 assert.deepEqual(P.unscheduled(g).map(t=>t.label),['Damian · tournée interne — horaire selon BL']);
 for(const p of shop.filter(p=>(p.details.tours||[]).some(t=>t!=='charlie')&&p.version===1))assert.equal(p.departures.some(s=>['Damian','Maxime','Cédric','Ludovic'].includes(s.carrier)),false,p.name);
 // No generated SQL gives an hour to these rounds.
 for(const r of rows.filter(r=>r.tour!=='charlie'))assert.deepEqual(r.slots,[]);
 // An existing garage keeps its carrier hour and shows the round beside it, without an hour.
 const feu=shop.find(p=>p.name==='FEU VERT BIDART');assert.deepEqual(feu.departures.map(s=>s.carrier+' '+s.time),['ACE Hendaye 11:15']);assert.deepEqual(P.unscheduled(feu).map(t=>t.label),['Damian · tournée interne — horaire selon BL']);
});
test('Charlie: fixed departures at 10:00 and 15:00, Monday to Friday',()=>{
 assert.deepEqual(P.fixedSlots('charlie').map(s=>[s.carrier,s.mode,s.time,s.days]),[['Charlie','internal','10:00',[1,2,3,4,5]],['Charlie','internal','15:00',[1,2,3,4,5]]]);
 assert.doesNotThrow(()=>P.validate(P.fixedSlots('charlie')));
 const charlie=shop.filter(p=>(p.details.tours||[]).includes('charlie'));assert.ok(charlie.length>=13);
 for(const p of charlie){assert.deepEqual(p.departures.filter(s=>s.carrier==='Charlie').map(s=>s.time),['10:00','15:00'],p.name);assert.deepEqual(P.unscheduled(p),[],p.name+' shows hours, not the no-hour sentence');}
 const top=shop.find(p=>p.name==='Top Auto');
 // Wednesday 9:00 → 10:00 the same day; Friday 16:00 → Monday 10:00; never on Saturday or Sunday.
 assert.deepEqual(P.next(top,new Date('2026-10-07T07:00:00Z')).map(s=>[s.time,s.offset]),[['10:00',0],['15:00',0]]);
 assert.deepEqual(P.next(top,new Date('2026-10-09T14:00:00Z')).map(s=>[s.time,s.offset,s.day]),[['10:00',3,1],['15:00',3,1]]);
 for(const day of [6,7])assert.equal(P.slots(shop,day).some(s=>s.carrier==='Charlie'),false);
 assert.equal(P.slots(shop,1).filter(s=>s.carrier==='Charlie'&&s.partner.name==='Top Auto').length,2);
});
test('existing garages are completed, never replaced',()=>{
 const was=before(),now=id=>shop.find(p=>p.id===id);
 for(const p of was){const n=now(p.id);assert.equal(n.name,p.name);for(const s of p.departures)assert.ok(n.departures.some(d=>JSON.stringify(d)===JSON.stringify(s)),p.name+' keeps '+s.carrier+' '+s.time);
  for(const a of String(p.details.aliases||'').split(';').map(a=>a.trim()).filter(Boolean))assert.ok(n.details.aliases.includes(a),p.name+' keeps alias '+a);}
 assert.deepEqual(now('e1').departures.map(s=>s.carrier+' '+s.time),['ACE Hendaye 11:15','Charlie 10:00','Charlie 15:00']);
 assert.equal(now('e3').details.aliases,'Leclerc SJL ; Leclerc Auto');
 // Garages left open by the list are untouched, and no second record was created for them.
 for(const id of ['e4','e5','e6'])assert.deepEqual(now(id),was.find(p=>p.id===id));
 for(const open of data.garages.filter(g=>g.open)){assert.equal(shop.some(p=>p.name===open.name),false,open.name+' is neither created nor attached');assert.equal(rows.some(r=>r.name===open.name),false);}
 assert.deepEqual(data.garages.filter(g=>g.open).map(g=>g.name),['Irribarren','Roady']);
 // Applying twice changes nothing.
 assert.deepEqual(apply(shop),shop);
 // The SQL never renames, never overwrites a list of departures, never deletes in the mutation.
 const sql=B.files['internal-tours.sql'],code=sql.split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n');
 assert.equal(/\bset\s+name\b|name\s*=\s*excluded|delete\s+from|truncate|drop\s/i.test(code),false);
 assert.match(code,/next_departures:=next_departures\|\|slot/);assert.match(code,/rounds:=rounds\|\|to_jsonb/);
 assert.match(code,/if found_count<>1 then raise exception/);assert.match(code,/already exists: decide whether it is the same garage/);
 assert.equal(/access_source|password|shared_access|logistics_pin/.test(code),false);
});
test('search accepts spelling variants and never merges two garages',()=>{
 // Doubled letters, and the variants named by Alexis through aliases.
 assert.deepEqual(find('carosserie biarotte'),['Carrosserie Biarrotte']);assert.deepEqual(find('Scannia'),['Scania']);assert.deepEqual(find('yveco'),['Iveco']);
 assert.deepEqual(find('nauroto').sort(),['Norauto France','Norauto Pontot']);assert.deepEqual(find('norauto').sort(),['Norauto France','Norauto Pontot']);
 assert.deepEqual(find('car vans'),['Carro Vans']);assert.deepEqual(find('carro vans'),['Carro Vans']);assert.deepEqual(find('garage de la négresse'),['Garage de l’Allégresse']);
 assert.deepEqual(find('leclerc auto'),['LECLERC ST JEAN DE LUZ']);assert.deepEqual(find('autosport'),[]);
 // Two garages stay two garages.
 assert.deepEqual(find('carrosserie de la gare'),['Carrosserie de la Gare']);assert.deepEqual(find('garage de la gare'),['Garage de la Gare (Cambo)']);
 assert.deepEqual(find('de la gare').sort(),['Carrosserie de la Gare','Garage de la Gare (Cambo)']);
 assert.deepEqual(find('belle marion').sort(),['Belle Marion (Anglet)','Belle Marion (Bayonne)']);
 assert.deepEqual(find('shark').sort(),['Atelier Carrosserie Shark','Atelier Shark']);
 assert.deepEqual(find('feu vert').sort(),['FEU VERT BIDART','Feu Vert (Anglet)','Feu Vert (Tarnos)']);
 assert.deepEqual(find('hirigoyen').sort(),['Hirigoyen','JM Hirigoyen']);
 assert.equal(shop.length,before().length+rows.filter(r=>!r.existing).length+0,'one record per garage, none merged');
 // By round, by zone, by town.
 assert.ok(find('damian').includes('Garage Modena'));assert.ok(find('cédric tarnos').includes('Feu Vert (Tarnos)'));assert.deepEqual(find('arcangues'),inRound('damian').sort((a,b)=>shop.findIndex(p=>p.name===a)-shop.findIndex(p=>p.name===b)));
 // A word that matches nothing still finds nothing.
 assert.deepEqual(find('zzz introuvable'),[]);
});
test('generated SQL files are up to date and strict',()=>{
 for(const [name,text] of Object.entries(B.files))assert.equal(fs.readFileSync(name,'utf8'),text,name+' : run node scripts/build-internal-tours-sql.cjs');
 assert.equal(rows.length,105);assert.equal(rows.filter(r=>r.existing).length,10);assert.equal(rows.filter(r=>r.slots.length).length,19);
 for(const name of ['internal-tours.sql','internal-tours.rollback.sql']){const sql=B.files[name];assert.match(sql,/^begin;$/m);assert.match(sql,/^commit;\s*$/m);assert.match(sql,/workspace_id=shop/);}
 assert.equal(/\b(insert|update|delete|alter|create|drop)\b/i.test(B.files['internal-tours.check.sql'].split('\n').filter(l=>!l.startsWith('--')).join('\n')),false,'the report only reads');
 // The files are documentation and tooling: the build never publishes them.
 assert.equal(/internal-tours/.test(fs.readFileSync('build.cjs','utf8')),false);
});
