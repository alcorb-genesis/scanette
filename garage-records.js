(function(g){'use strict';
function source(p){return p.siret||p.id;}
function fromPublic(p){return {id:crypto.randomUUID(),kind:'client',name:p.name,source_key:source(p),version:0,departures:[],details:{city:p.city||'',address:p.address||'',phone:p.phone||'',email:p.email||'',siret:p.siret||'',coordinates:p.coordinates||null,source:p.source||''}};}
function request(shop,p,details=p.details){return {shop_id:shop,partner_id:p.id,expected_version:p.version||0,partner_kind:p.kind||'client',partner_name:p.name,partner_details:details||{},partner_departures:p.departures||[],partner_source:p.source_key||''};}
function archived(p){return p.details?.archived===true;}
function archive(p,value){return {...p.details,archived:value};}
function error(e){return ['PT409','40001'].includes(e?.code)?'Cette fiche a été modifiée ailleurs. Actualisez avant de recommencer.':e?.code==='23505'?'Ce garage possède déjà une fiche. Actualisez pour la retrouver.':'Enregistrement non confirmé. Actualisez avant de réessayer.';}
const api={source,fromPublic,request,archived,archive,error};if(typeof module!=='undefined')module.exports=api;else g.GarageRecords=api;
})(globalThis);
