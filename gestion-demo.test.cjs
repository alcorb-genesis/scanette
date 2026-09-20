const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('gestion-demo.js','utf8');
function setup(){const body={innerHTML:''},root={querySelector:()=>body,querySelectorAll:()=>[],dataset:{},style:{setProperty(){}},addEventListener(){}};const c={document:{getElementById:()=>root},window:{addEventListener(){}},console};vm.createContext(c);vm.runInContext(source.replace(' restore(window.openai?.widgetState);',' globalThis.api={switchStore,handle,stock,extension,routing,calendarRows,replenishmentState,dueFor,creditFor,ttc,journalRows,views,render,readyQty,simulationStale,getState:()=>s}; restore(window.openai?.widgetState);'),c);return c.api;}
{
const a=setup(),d=a.getState().docs.find(d=>d.type==='FA');a.handle('x-pay-open:'+d.id);a.handle('x-pay-confirm');a.handle('return-open:'+d.id);a.handle('return-confirm');assert.equal(a.creditFor(d),1740);assert.ok(a.views.payments().includes('Crédit client'));a.handle('refund:'+d.id);a.handle('refund:'+d.id);assert.equal(a.creditFor(d),0);assert.equal(a.journalRows().reduce((n,r)=>n+r[2]-r[3],0),0);
}
{
const a=setup(),d=a.getState().docs[0],before=a.stock(0);a.handle('return-open:'+d.id);a.handle('return-confirm');assert.equal(a.stock(0),before+1);assert.equal(a.readyQty(d)[0],1);assert.ok(a.views.dispatch().includes('1 × Filtre à huile'));
}
{
const a=setup(),e=a.extension();e.purchase={i:5,qty:100,supplier:0};a.handle('x-order');a.handle('m-simulate');const r=a.routing();r.query='purflux';a.handle('m-all');a.handle('m-prepare');assert.equal(r.lots.length,0);e.orders[0].due='2026-09-22';a.handle('m-simulate');assert.equal(r.rows[5].qty,0);
}
{
const a=setup(),e=a.extension();e.purchase={i:8,qty:1,supplier:1};a.handle('x-order');assert.equal(e.orders[0].unit,a.calendarRows(a.replenishmentState())[8].unit);assert.ok(a.views.restock().includes('Total CA net HT'));
}
{
const a=setup();a.handle('m-simulate');const r=a.routing();a.replenishmentState().date='2026-09-22';assert.ok(a.simulationStale());r.query='purflux';a.handle('m-all');a.handle('m-prepare');assert.equal(r.lots.length,0);a.handle('m-simulate');a.handle('m-all');a.handle('m-prepare');a.handle('m-validate:'+r.lots[0].id);assert.equal(a.extension().orders[0].due,'2026-09-24');
}
{
const a=setup();for(const page of Object.keys(a.views)){a.getState().page=page;a.render();}const initial=a.stock(0);a.handle('x-portal-add:0');a.handle('x-portal-send');const d=a.getState().docs.at(-1);a.handle('invoice:'+d.id);a.handle('invoice:'+d.id);a.handle('stage:'+d.id);a.handle('dispatch-ready');assert.equal(a.stock(0),initial-1);
}
console.log('PASS six corrections, remboursement unique, 15 vues, portail/facturation/départ sans double sortie');

{const a=setup();a.getState().moves.push({i:0,n:7,doc:'STORE-TEST',kind:'receive'});const first=a.stock(0);a.switchStore('landes');assert.equal(a.stock(0),first-7);a.getState().moves.push({i:0,n:2,doc:'OTHER-TEST',kind:'receive'});a.switchStore('bellecave');assert.equal(a.stock(0),first);a.switchStore('landes');assert.equal(a.stock(0),first-5);}console.log('PASS magasins de demonstration independants pendant la session');
