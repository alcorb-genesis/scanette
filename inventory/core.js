(function(root){'use strict';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function catalogue(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>20000)throw Error('La liste doit contenir entre 1 et 20 000 articles.');
 const ids=new Set();return rows.map((r,i)=>{
  const p={};for(const [key,max] of Object.entries({id:128,reference:120,description:500,brand:120,range:120,location:160,internal_barcode:128,manufacturer_barcode:128})){
   p[key]=String(r[key]??'').trim();if(p[key].length>max)throw Error('Champ trop long à la ligne '+(i+1));
  }
  if(!p.id)p.id='import-'+i;
  if(!p.reference||!p.brand||!p.range)throw Error('Référence, marque et gamme obligatoires à la ligne '+(i+1));
  if(ids.has(p.id))throw Error('Identifiant en double : '+p.reference);ids.add(p.id);return p;
 });
}
function quantity(value){if(value===''||value===null)return null;const n=Number(value);if(!Number.isInteger(n)||n<0||n>1000000)throw Error('Quantité entière entre 0 et 1 000 000 attendue.');return n;}
function select(rows,brand,range,zone=''){return rows.filter(r=>(!brand||r.brand===brand)&&(!range||r.range===range)&&(!zone||norm(r.location)===norm(zone)));}
function lookup(rows,code){const s=String(code).trim();return rows.filter(r=>[r.reference,r.internal_barcode,r.manufacturer_barcode].some(v=>v&&v===s));}
function change(d,id,value,add=false){const r=d.lines.find(r=>r.id===id);if(!r)throw Error('Article introuvable.');const q=quantity(value);d.undo=d.undo||[];d.undo.push({id,quantity:r.quantity,added:add});d.undo=d.undo.slice(-50);r.quantity=q;d.lastId=id;return r;}
function undo(d){const a=d.undo?.pop();if(!a)return false;if(a.added)d.lines=d.lines.filter(r=>r.id!==a.id);else{const r=d.lines.find(r=>r.id===a.id);if(r)r.quantity=a.quantity;}d.lastId='';return true;}
function gate(delay=2000){let until=0;return {accept(now){if(now<until)return false;until=now+delay;return true;},left(now){return Math.max(0,until-now);}};}
function cell(v){let s=String(v??'');if(/^[\s\u0000-\u001f]*[=+@-]/u.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function csv(d){return '\ufeff'+[['Dossier','Employé','Deuxième personne','Date début','Marque','Gamme','Zone','Référence','Désignation','Emplacement','Quantité comptée','État','Code interne','Code fabricant'],...d.lines.map(r=>[d.id,d.employee,d.employee2||'',d.createdAt,r.brand,r.range,d.zone,r.reference,r.description,r.location,r.quantity,r.added?'Ajout pendant inventaire':r.quantity===null?'Non compté':'Compté',r.internal_barcode,r.manufacturer_barcode])].map(r=>r.map(cell).join(';')).join('\r\n');}
function parseCSV(text){
 text=text.replace(/^\ufeff/,'');const delimiter=text.split(/\r?\n/)[0].includes(';')?';':',';const records=[];let row=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(value);value='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(Boolean))records.push(row);row=[];value='';}else value+=c;}
 if(quoted)throw Error('Guillemets CSV non fermés.');row.push(value);if(row.some(Boolean))records.push(row);const headers=(records.shift()||[]).map(norm);
 const aliases={reference:['reference','référence'],description:['designation','description'],brand:['marque','brand'],range:['gamme','range'],location:['emplacement','location'],internal_barcode:['code interne','internal_barcode'],manufacturer_barcode:['code fabricant','code barre','code-barres','manufacturer_barcode']};
 return catalogue(records.map((cells,i)=>{const r={id:'import-'+i};for(const [key,names] of Object.entries(aliases)){const pos=headers.findIndex(h=>names.map(norm).includes(h));r[key]=pos<0?'':cells[pos]||'';}return r;}));
}
const api={norm,catalogue,quantity,select,lookup,change,undo,gate,csv,parseCSV};if(typeof module!=='undefined')module.exports=api;else root.InventoryCore=api;
})(globalThis);
