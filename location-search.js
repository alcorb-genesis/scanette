(function(g){'use strict';
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
function code(v){const s=norm(v).replace(/^(?:ALLEE|EMPLACEMENT)\s*/,'').replace(/[\s-]+/g,'');return /^A\d{1,3}[A-Z]?$/.test(s)?s:null;}
function belongs(value,query){const v=code(value),q=code(query);return !!v&&!!q&&(v===q||(/^A\d+$/.test(q)&&v.replace(/[A-Z]$/,'')===q));}
function filter(value){const c=code(value);if(!c)return null;return ( /^A\d+$/.test(c)?[c,...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(s=>c+s)]:[c]).map(s=>'location.ilike.'+s).join(',');}
function matches(row,query){const q=code(query);if(q)return belongs(row.code,q);const words=norm(query).split(/\s+/).filter(Boolean),text=norm([row.code,row.description,row.notes].join(' '));return words.every(w=>text.includes(w));}
function choices(rows){return [...new Set(rows.flatMap(r=>{const c=code(r.code);return c?[c.replace(/([0-9])[A-Z]$/,'$1'),c]:[r.code];}))].sort((a,b)=>a.localeCompare(b,'fr',{numeric:true}));}
const api={code,belongs,filter,matches,choices};if(typeof module!=='undefined')module.exports=api;else g.LocationSearch=api;
})(globalThis);
