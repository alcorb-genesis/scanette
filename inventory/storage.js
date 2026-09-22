/* One current snapshot per dossier. Revision checks prevent two tabs overwriting each other. */
(function(root){'use strict';let connection;
function open(){return connection||(connection=new Promise((resolve,reject)=>{const r=indexedDB.open('alcorb-local-inventory-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}));}
async function all(){const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction('drafts'),r=t.objectStore('drafts').getAll();t.oncomplete=()=>resolve(r.result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));t.onerror=()=>reject(t.error);});}
async function save(d,revision){const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction('drafts','readwrite'),s=t.objectStore('drafts'),r=s.get(d.id);let conflict=false,next;
 r.onsuccess=()=>{if((r.result?.revision||0)!==revision){conflict=true;t.abort();return;}next={...structuredClone(d),revision:revision+1,updatedAt:new Date().toISOString()};s.put(next);};
 t.oncomplete=()=>resolve(next);t.onabort=()=>reject(Error(conflict?'Ce dossier a été modifié dans un autre onglet. Exportez votre saisie avant de recharger.':'Sauvegarde locale impossible. Exportez le relevé et gardez cette page ouverte.'));t.onerror=()=>{};
});}
root.InventoryStorage={all,save};
})(globalThis);
