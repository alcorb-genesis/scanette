/* Back button inside a module: dialogs, panels and cameras close before the screen.
   A layer is any <dialog>, or an element marked data-layer:
     data-layer-open-class="x"  open while the class is present (otherwise: while not [hidden], or [open])
     data-layer-close="id"      the button that closes it the normal way (confirmations included)
   Inside the application the shell owns the history; on a standalone page this file
   keeps one history entry per open layer and nothing else. */
(function(){
'use strict';
if(window.AlcorbLayers)return;
const embedded=window.parent!==window;
const opened=[];                 // ids, in opening order
const byBack=new Set();          // closing because of the Back button: not reported again
let standalone=null;

function layerOf(node){return node&&node.nodeType===1&&(node.matches('dialog')||node.hasAttribute('data-layer'))&&node.id?node:null;}
function isOpen(el){
 const cls=el.getAttribute('data-layer-open-class');
 if(cls)return el.classList.contains(cls);
 if(el.matches('dialog,details'))return el.open;
 return !el.hidden;
}
function close(el){
 const button=document.getElementById(el.getAttribute('data-layer-close')||'');
 if(button){button.click();return;}
 if(el.matches('dialog')){const event=new Event('cancel',{cancelable:true});el.dispatchEvent(event);if(!event.defaultPrevented&&el.open)el.close();return;}
 if(el.matches('details')){el.open=false;return;}
 el.hidden=true;
}
function report(action,id){
 if(embedded){try{window.parent.postMessage({type:'alcorb-layer',action,id},location.origin);}catch(_){}}
 else if(standalone){action==='open'?standalone.layerOpened(id,'page'):standalone.layerClosed(id);}
}
function update(el){
 const id=el.id,was=opened.includes(id),now=isOpen(el);
 if(now&&!was){opened.push(id);report('open',id);}
 else if(!now&&was){opened.splice(opened.indexOf(id),1);if(byBack.delete(id))return;report('closed',id);}
}
/* Back: close the layer the normal way. If the page keeps it open (a confirmation
   was refused), its history entry is put back. */
function back(id){
 const el=document.getElementById(id);
 if(!el||!opened.includes(id))return;
 byBack.add(id);close(el);
 setTimeout(()=>{if(isOpen(el)){byBack.delete(id);if(!opened.includes(id))opened.push(id);report('open',id);}else byBack.delete(id);},0);
}
function scan(){for(const el of document.querySelectorAll('dialog[id],[data-layer][id]'))update(el);}

new MutationObserver(records=>{
 const seen=new Set();
 for(const r of records){const el=layerOf(r.target);if(el&&!seen.has(el)){seen.add(el);update(el);}}
}).observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:['open','hidden','class']});

if(embedded){
 window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent)return;if(e.data?.type==='alcorb-back'&&typeof e.data.id==='string')back(e.data.id);});
 let told=false;const activated=()=>{if(told)return;told=true;try{window.parent.postMessage({type:'alcorb-activated'},location.origin);}catch(_){}};
 for(const type of ['pointerdown','keydown'])document.addEventListener(type,activated,true);
}else if(window.AlcorbNavHistory&&typeof history.pushState==='function'){
 standalone=AlcorbNavHistory.createNavHistory({history,rootGuard:false,render(){},current:()=>undefined,canLeave:()=>true,toast(){},closeLayer:entry=>back(entry.id)});
 standalone.start(undefined);
 window.addEventListener('popstate',e=>standalone.onPopState(e.state));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
window.AlcorbLayers={scan,get opened(){return opened.slice();}};
})();
