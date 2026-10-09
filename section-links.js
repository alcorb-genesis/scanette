/* Links between the sections of the application.
   A module never opens a window or a tab: it asks the shell to show another section, in the same
   frame, with one history entry — so the Android Back button returns to where the user was.
     query   what the destination should search or open (a reference, a garage name);
     resume  where the ORIGIN should reopen when the user comes back (a record identifier);
     receiptId  the receipt a pointage belongs to (existing Réception ↔ Scanette link).
   Outside the shell (a module opened on its own) the same request becomes an ordinary address. */
(function(root){
'use strict';
const SECTIONS=Object.freeze(['home','receipts','scan','inventory','preparation','departures','catalogue','returns']);
const LABELS=Object.freeze({home:'Accueil',receipts:'Réception',scan:'Scanette',inventory:'Inventaire',preparation:'Préparation',departures:'Départs',catalogue:'Catalogue',returns:'Retours'});
const text=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,160);
const token=value=>/^[\w:.-]{1,80}$/.test(String(value??''))?String(value):'';
const uuid=value=>/^[0-9a-f-]{36}$/i.test(String(value??''))?String(value):'';
/* The message a module sends to the shell. Unknown sections and empty values are dropped. */
function request(section,{query='',resume='',receiptId=''}={}){
 if(!SECTIONS.includes(section))return null;
 const message={type:'alcorb-section',section};
 if(text(query))message.query=text(query);if(token(resume))message.resume=token(resume);if(uuid(receiptId))message.receiptId=uuid(receiptId);
 return message;
}
/* The same destination as an address of the shell, for a module opened outside it. */
function address(section,options={},base=''){
 const message=request(section,options);if(!message)return null;const search=new URLSearchParams();
 if(message.receiptId)search.set('receipt',message.receiptId);if(message.query)search.set('q',message.query);
 const tail=search.toString();return base+'application.html'+(tail?'?'+tail:'')+'#'+section;
}
const embedded=()=>!!root.parent&&root.parent!==root;
function go(section,options={},base=''){
 const message=request(section,options);if(!message)return false;
 if(embedded())root.parent.postMessage(message,root.location.origin);else root.location.href=address(section,options,base);
 return true;
}
/* What the shell passed to this module when it opened it. */
function param(name){try{const value=new URLSearchParams(root.location.search).get(name);return name==='resume'?token(value):name==='receipt'?uuid(value):text(value);}catch{return '';}}
/* A real button: never an anchor with a target, never a new window. */
function button(doc,label,section,options,base=''){
 const b=doc.createElement('button');b.type='button';b.className='section-link';b.textContent=label;b.dataset.go=section;
 b.addEventListener('click',()=>go(section,typeof options==='function'?options():options,base));return b;
}
const api={SECTIONS,LABELS,text,token,request,address,go,param,button,embedded};
root.SectionLinks=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
