/* Scan decision helpers shared by camera, external reader and typed entry.
   Pure logic only: no DOM, no network, no storage. */
(function(root){
'use strict';
const MAX_LENGTH=256;

/* The value is only trimmed: it is never corrected. */
function clean(raw){
 const value=String(raw??'').trim();
 if(!value)return {ok:false,value:'',error:''};
 if(value.length>MAX_LENGTH)return {ok:false,value:'',error:'Code trop long ('+MAX_LENGTH+' caractères maximum).'};
 return {ok:true,value,error:''};
}

/* Exact catalogue match on either barcode or on the reference. The upper-case
   spelling is also searched so that a typed reference finds its record; two
   different records are never merged: several matches require a choice. */
function catalogueFilter(value){
 const quote=text=>'"'+text.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
 const parts=['internal_barcode.eq.'+quote(value),'manufacturer_barcode.eq.'+quote(value),'reference.eq.'+quote(value)];
 const upper=value.toUpperCase();
 if(upper!==value)parts.push('reference.eq.'+quote(upper));
 return '('+parts.join(',')+')';
}

/* One decision for every source. Nothing is ever picked among several records,
   and an unknown value is never recorded without an explicit choice. */
function decide({products,alias,freeLine}){
 if(!Array.isArray(products))throw Error('Réponse catalogue invalide.');
 const unique=[...new Map(products.filter(p=>p&&p.id).map(p=>[p.id,p])).values()];
 if(unique.length===1)return {kind:'product',product:unique[0]};
 if(unique.length>1)return {kind:'choose',products:unique};
 if(alias)return {kind:'alias',reference:alias};
 if(freeLine)return {kind:'free'};
 return {kind:'unknown'};
}

/* Camera only. A label is counted once while it stays in view. Another code is
   accepted at once. The same code counts again only after it has left the view
   for `rearm` ms. External readers and typed entries never use this gate. */
function createCameraGate({confirmWindow=800,rearm=1500}={}){
 let seen=new Map(),heldAt=null;
 return {
  sight(code,now){
   if(heldAt!==null||!code)return false;
   const entry=seen.get(code);
   if(!entry||now-entry.last>rearm){seen.set(code,{last:now,hits:1,counted:false});return false;}
   const gap=now-entry.last;entry.last=now;
   if(entry.counted)return false;
   if(gap>confirmWindow){entry.hits=1;return false;}
   entry.hits++;entry.counted=true;return true;
  },
  /* A decision or a camera restart must not look like the label left the view. */
  hold(now){if(heldAt===null)heldAt=now;},
  release(now){if(heldAt===null)return;const pause=now-heldAt;heldAt=null;for(const entry of seen.values())entry.last+=pause;},
  reset(){seen=new Map();heldAt=null;},
  get held(){return heldAt!==null;}
 };
}

/* Events are handled one at a time, in arrival order. None is merged or dropped
   silently: a refused event is reported to the caller by `push` returning false. */
function createQueue(handle,{limit=50}={}){
 let items=[],running=false,idle=Promise.resolve();
 async function drain(){
  running=true;
  try{while(items.length){const item=items.shift();try{await handle(item);}catch(_){/* the handler reports its own errors */}}}
  finally{running=false;}
 }
 return {
  push(item){if(items.length>=limit)return false;items.push(item);if(!running)idle=drain();return true;},
  clear(){items=[];},
  whenIdle(){return idle;},
  get size(){return items.length;},
  get busy(){return running;}
 };
}

const api={MAX_LENGTH,clean,catalogueFilter,decide,createCameraGate,createQueue};
root.ScanInputCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
