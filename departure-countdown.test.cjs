const test=require('node:test'),assert=require('node:assert/strict'),P=require('./partner-planning-core');
const p={departures:[{carrier:'Serge',time:'09:30',days:[1,2,3,4,5]},{carrier:'Paketo',time:'11:15',days:[1,2,3,4,5]},{carrier:'Serge',time:'15:30',days:[1,2,3,4,5]}]};
test('Paris: prochain service après le départ raté et minutes restantes',()=>{const n=P.next(p,new Date('2026-09-22T08:00:00Z'));assert.equal(n[0].time,'11:15');assert.equal(n[0].minutes,75);assert.equal(P.label(n[0]),'Il reste 1 h 15 min avant le départ');});
test('Week-end exclu, retour au lundi',()=>{const n=P.next(p,new Date('2026-09-25T15:00:00Z'));assert.equal(n[0].day,1);assert.equal(n[0].offset,3);assert.match(P.label(n[0]),/2 j 16 h 30 min avant le départ · Lundi à 09:30/);});
test('Départ présent et horaires absents',()=>{assert.equal(P.label(P.next(p,new Date('2026-09-22T07:30:20Z'))[0]),'Départ maintenant');assert.deepEqual(P.next({departures:[]}),[]);});
test('Heure de Paris en hiver et services simultanés préservés',()=>{const q={departures:[...p.departures,{carrier:'Autre',time:'09:30',days:[1,2,3,4,5]}]};const n=P.next(q,new Date('2026-12-22T08:00:00Z'));assert.equal(n[0].minutes,30);assert.equal(n.filter(s=>s.minutes===30).length,2);});
test('Rapprochement réversible, alias recherchables, autres établissements conservés',()=>{const rows=[{id:'a',name:'Garage de la Gare (Cambo)',details:{aliases:'La Gare Cambo ; La Gare (COMBO)'}},{id:'b',name:'ancienne fiche',details:{merged_into:'a'}},{id:'c',name:'Ville de Cambo',details:{}}];assert.equal(P.active(rows).length,2);assert.ok(P.matches(rows[0],'combo'));assert.ok(P.matches(rows[0],'gare cambo'));assert.equal(rows.length,3);});

test('Compte à rebours traverse le changement d’heure de Paris',()=>{const q={departures:[{carrier:'X',time:'09:30',days:[1]}]};assert.equal(P.next(q,new Date('2026-10-23T15:00:00Z'))[0].minutes,3930);});
test('Exemple utilisateur : départ Serge à 9h30, reste 12 minutes',()=>{const n=P.next(p,new Date('2026-09-22T07:18:00Z'))[0];assert.equal(n.carrier,'Serge');assert.equal(P.label(n),'Il reste 12 min avant le départ');});

test('Durées lisibles sans conversion mentale',()=>{
 for(const [minutes,duration] of [[1,'1 min'],[59,'59 min'],[60,'1 h'],[574,'9 h 34 min'],[1440,'1 j'],[1501,'1 j 1 h 1 min']]){
  assert.equal(P.label({minutes,offset:1,time:'06:00'}),'Il reste '+duration+' avant le départ · Demain à 06:00');
 }
});
