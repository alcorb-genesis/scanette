(function(g){'use strict';
const parse=(value,scale=100)=>{const text=String(value).trim().replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(text))throw Error('Montant ou pourcentage invalide.');const [a,b='']=text.split('.');const n=Number(a)*scale+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n))throw Error('Montant trop élevé.');return n;};
function line(q,price,discount){const quantity=Number(q),base_cents=parse(price),discount_bp=parse(discount||'0');if(!Number.isInteger(quantity)||quantity<1||quantity>100000||base_cents>100000000||discount_bp>10000)throw Error('Quantité, prix ou remise hors limites.');const unit=Math.floor((base_cents*(10000-discount_bp)+5000)/10000);return {quantity,base_cents,discount_bp,unit,total:unit*quantity};}
const money=n=>(n/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'}),number=n=>'BL-'+String(n).padStart(6,'0');
const api={parse,line,money,number};if(typeof module!=='undefined')module.exports=api;else g.SalesCore=api;
})(globalThis);
