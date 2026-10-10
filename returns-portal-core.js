/* Public garage portal: the same normalisation and limits as returns_public_submit on the server.
   The server repeats every check; this file only gives immediate, readable feedback. */
(function(root){
'use strict';
const LIMITS=Object.freeze({garage:[2,120],location:[2,160],reference:[1,80],lines:100,quantity:999});
const space=value=>String(value??'').trim().replace(/\s+/g,' ');
const hasControl=value=>/[\u0000-\u001f\u007f]/.test(value);
function reference(raw){const value=space(raw).toUpperCase();if(!value)return {ok:false,value:'',error:''};if(value.length>LIMITS.reference[1]||hasControl(value))return {ok:false,value,error:'Référence trop longue ou illisible.'};return {ok:true,value,error:''};}
/* One line per reference; the same reference again adds one piece. Unknown references are kept. */
function addLine(lines,raw){
 const r=reference(raw);if(!r.ok)return {lines,error:r.error,line:null};
 const existing=lines.find(line=>line.reference===r.value);
 if(existing){if(existing.quantity>=LIMITS.quantity)return {lines,error:'Quantité maximale atteinte pour '+r.value+'.',line:existing};return {lines:lines.map(line=>line===existing?{...line,quantity:line.quantity+1}:line),error:'',line:{...existing,quantity:existing.quantity+1}};}
 if(lines.length>=LIMITS.lines)return {lines,error:'100 références au maximum par demande.',line:null};
 const line={reference:r.value,quantity:1};return {lines:[...lines,line],error:'',line};
}
const key=value=>space(value).normalize('NFC').toLocaleLowerCase('fr');
/* A typed name is linked to the list only when it matches exactly one garage; otherwise it is sent as typed. */
function garage(raw,list){
 const name=space(raw),matches=list.filter(g=>key(g.name)===key(name));
 return matches.length===1?{garage_id:matches[0].id,garage_name:null,label:matches[0].name,listed:true}:{garage_id:null,garage_name:name,label:name,listed:false,ambiguous:matches.length>1};
}
const TYPES=Object.freeze(['return','warranty']);
function validate({garageName,lines,location,type}){
 const name=space(garageName),place=space(location);
 if(name.length<LIMITS.garage[0]||name.length>LIMITS.garage[1]||hasControl(name))return 'Indiquez le nom du garage.';
 if(!TYPES.includes(type))return 'Choisissez le type de la demande : retour client ou garantie.';
 if(!lines.length)return 'Ajoutez au moins une référence.';
 if(lines.length>LIMITS.lines)return '100 références au maximum par demande.';
 for(const line of lines)if(!reference(line.reference).ok||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>LIMITS.quantity)return 'Vérifiez les références et les quantités.';
 if(place.length<LIMITS.location[0]||place.length>LIMITS.location[1]||hasControl(place))return 'Indiquez où se trouvent les retours dans le garage.';
 return '';
}
/* Exactly the fields the public RPC accepts: nothing else leaves the page. */
function payload({shopId,requestId,garageName,list,lines,location,type}){
 const g=garage(garageName,list);
 return {shop_id:shopId,request_id:requestId,garage_id:g.garage_id,garage_name:g.garage_name,pickup_location:space(location),case_lines:lines.map(line=>({reference:line.reference,quantity:line.quantity})),case_type:TYPES.includes(type)?type:null};
}
function errorMessage(error){
 if(error?.code==='PT429')return 'Trop de demandes en peu de temps. Réessayez dans quelques minutes.';
 if(error?.code==='42501')return 'Le portail garage est fermé pour le moment. Contactez Bellecave par téléphone.';
 if(error?.code==='22023')return 'La demande a été refusée : vérifiez le garage, le type, les références et l’emplacement.';
 return 'La demande n’a pas été transmise. Vérifiez la connexion puis réessayez : elle ne sera pas enregistrée deux fois.';
}
/* The designation shown under a reference is only ever the text the catalogue answered: cleaned, bounded,
   and nothing when the answer is not a usable text. Nothing is deduced from the reference itself. */
function designation(answer){const value=typeof answer==='string'?space(answer.replace(/[\u0000-\u001f\u007f]/g,' ')):'';return value.length>120?value.slice(0,120):value;}
/* What a line says about the part. unknown = not asked yet or the lookup failed: say nothing rather than something false. */
const NO_DESIGNATION='Désignation non renseignée';
function describe(state){return state===undefined?{text:'',known:false}:state?{text:state,known:true}:{text:NO_DESIGNATION,known:false};}
const api={TYPES,LIMITS,space,reference,addLine,garage,validate,payload,errorMessage,designation,describe,NO_DESIGNATION};
root.GaragePortal=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
