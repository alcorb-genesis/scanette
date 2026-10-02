(function(g){'use strict';
const norm=v=>String(v??'').trim().toUpperCase();
function validate(d){
 if(!d||d.format!==1||!d.id||typeof d.number!=='string'||!d.number.trim()||d.number.length>80||typeof d.employee!=='string'||!d.employee.trim()||d.employee.length>100||!['pickup','delivery'].includes(d.mode)||typeof d.customer!=='string'||!d.customer.trim()||d.customer.length>180||!Array.isArray(d.events)||d.events.length>100000||!Array.isArray(d.lines)||!d.lines.length||d.lines.length>300)throw Error('Renseignez le BL, le client, le préparateur et les articles.');
 const seen=new Set();for(const l of d.lines){if(!l.productId||seen.has(l.productId)||!l.reference||!Number.isSafeInteger(l.expected)||l.expected<1||l.expected>10000||!Number.isSafeInteger(l.count)||l.count<0||l.count>l.expected)throw Error('Référence en double ou quantité invalide. Regroupez les quantités d’une même pièce.');seen.add(l.productId);}
 if(d.completedAt&&!d.lines.every(l=>l.count===l.expected))throw Error('Un BL incomplet ne peut pas être validé.');return d;
}
function scan(d,products,code,at){
 validate(d);if(d.completedAt)throw Error('Ce BL est déjà terminé.');
 if(!norm(code))throw Error('Code vide.');
 if(products.length!==1)throw Error(products.length?'Code partagé entre plusieurs articles : contrôle nécessaire dans le catalogue.':'Code inconnu du catalogue : aucune quantité ajoutée.');
 const line=d.lines.find(l=>l.productId===products[0].id);if(!line)throw Error('Cette pièce ne figure pas sur ce BL.');
 if(line.count>=line.expected)throw Error('Quantité déjà complète pour '+line.reference+'.');
 const next=structuredClone(d);next.lines.find(l=>l.productId===line.productId).count++;
 next.events.push({productId:line.productId,code: norm(code),at,action:'scan'});return validate(next);
}
function undo(d,at){validate(d);if(d.completedAt)throw Error('Ce BL est déjà terminé.');const next=structuredClone(d),counts=new Map();let target;
 for(let i=next.events.length-1;i>=0;i--){const e=next.events[i];if(e.action==='undo')counts.set(e.productId,(counts.get(e.productId)||0)+1);else if(e.action==='scan'){if(counts.get(e.productId))counts.set(e.productId,counts.get(e.productId)-1);else{target=e;break;}}}
 if(!target)throw Error('Aucun scan à annuler.');next.lines.find(l=>l.productId===target.productId).count--;next.events.push({action:'undo',productId:target.productId,at});return validate(next);
}
function complete(d,at){validate(d);if(d.completedAt)return d;if(!d.lines.every(l=>l.count===l.expected))throw Error('Il reste des pièces à scanner.');return {...structuredClone(d),completedAt:at};}
function key(shop,actor){if(!shop||!actor)throw Error('Compte requis.');return 'alcorb-preparation-v1:'+shop+':'+actor;}
function save(storage,k,documents){if(documents.length>300)throw Error('Archivez vos BL avant de dépasser 300 dossiers sur cet appareil.');documents.forEach(validate);storage.setItem(k,JSON.stringify(documents));}
const api={norm,validate,scan,undo,complete,key,save};if(typeof module!=='undefined')module.exports=api;else g.Preparation=api;
})(globalThis);
