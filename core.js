(function(root){
  'use strict';
  const VERSION=1;
  const empty=()=>({version:VERSION,sections:[],aliases:{},pushQueue:[]});
  function validate(value){
    if(!value || value.version!==VERSION || !Array.isArray(value.sections) ||
       !value.aliases || typeof value.aliases!=='object' || Array.isArray(value.aliases) ||
       !Array.isArray(value.pushQueue)) throw Error('Sauvegarde non reconnue.');
    if(value.sections.length>10000 || Object.keys(value.aliases).length>1000000) throw Error('Sauvegarde trop volumineuse.');
    const out=empty();
    out.sections=value.sections.map(s=>{
      if(!s || typeof s.name!=='string' || !s.items || typeof s.items!=='object' || Array.isArray(s.items)) throw Error('Section invalide.');
      const items=Object.create(null);
      for(const [ref,raw] of Object.entries(s.items)){
        const it=typeof raw==='number'?{qty:raw,prix:null}:raw;
        if(!ref || !it || !Number.isSafeInteger(it.qty) || it.qty<0 ||
           (it.prix!==null && (!Number.isFinite(it.prix) || it.prix<0))) throw Error('Quantité ou prix invalide.');
        items[ref]={qty:it.qty,prix:it.prix};
        for(const key of ['productId','reference','description','barcode']){
          if(it[key]!==undefined){if(typeof it[key]!=='string'||it[key].length>2000)throw Error('Fiche invalide.');items[ref][key]=it[key];}
        }
      }
      return {name:s.name,items};
    });
    out.aliases=Object.create(null);
    for(const [ean,ref] of Object.entries(value.aliases)){
      if(!ean || typeof ref!=='string' || !ref) throw Error('Référence invalide.');
      out.aliases[ean]=ref;
    }
    out.pushQueue=value.pushQueue.map(row=>{
      if(!row || typeof row.ean!=='string' || !row.ean || typeof row.ref!=='string' || !row.ref) throw Error('Catalogue en attente invalide.');
      return {ean:row.ean,ref:row.ref};
    });
    return out;
  }
  function storageKey(userId){if(!userId)throw Error('Session absente.');return 'scanette_account_v1:'+userId;}
  function read(storage,userId){const raw=storage.getItem(storageKey(userId));return raw===null?empty():validate(JSON.parse(raw));}
  function write(storage,userId,value){
    const key=storageKey(userId), next=JSON.stringify(validate(value));
    const previous=storage.getItem(key);
    if(previous!==null) storage.setItem(key+':previous',previous);
    storage.setItem(key,next);
  }
  async function pullAll(fetchPage,isCurrent){
    const rows=[], size=500;
    for(let offset=0;;){
      const page=await fetchPage(offset,size);
      if(!isCurrent()) throw Error('Session modifiée.');
      if(!Array.isArray(page))throw Error('Réponse catalogue invalide.');
      rows.push(...page);
      if(!page.length) return rows;
      offset+=page.length;
    }
  }
  function acknowledge(queue,batch){
    return queue.filter(row=>!batch.some(sent=>sent.ean===row.ean && sent.ref===row.ref));
  }
  root.ScanetteCore={empty,validate,storageKey,read,write,pullAll,acknowledge};
  if(typeof module!=='undefined')module.exports=root.ScanetteCore;
})(typeof globalThis!=='undefined'?globalThis:this);
