(function(root){
'use strict';
function roundedZoom(value,caps){const min=Number(caps.min),max=Math.max(min,Math.min(Number(caps.max),4)),step=Number(caps.step)||0.1;return Math.min(max,Math.max(min,Math.round((value-min)/step)*step+min));}
function controller(track){let active=true,queue=Promise.resolve();const caps=track.getCapabilities?.()||{};
 return {caps,dispose(){active=false;},apply(settings){const task=queue.then(async()=>{if(!active||track.readyState==='ended')return false;const current=track.getConstraints?.()||{};await track.applyConstraints({...current,advanced:[Object.assign({},...(current.advanced||[]),settings)]});return active&&track.readyState!=='ended';});queue=task.catch(()=>{});return task;}};
}
function mount(track,host){host.replaceChildren();host.hidden=false;let control;
 try{control=controller(track);}catch{host.hidden=true;return()=>{};}
 const status=document.createElement('small');status.setAttribute('role','status');host.append(status);
 const report=()=>{const s=track.getSettings?.()||{};status.textContent=(s.width&&s.height?s.width+' × '+s.height+' · ':'')+'Stabilisez le téléphone. Évitez les reflets.';};report();
 if(control.caps.focusMode?.includes('continuous'))control.apply({focusMode:'continuous'}).catch(()=>{});
 if(control.caps.torch){const b=document.createElement('button');b.type='button';let on=false;b.textContent='Allumer la lampe';b.setAttribute('aria-pressed','false');host.append(b);b.onclick=async()=>{b.disabled=true;try{if(await control.apply({torch:!on})){on=!!track.getSettings?.().torch;b.textContent=on?'Éteindre la lampe':'Allumer la lampe';b.setAttribute('aria-pressed',String(on));report();}}catch{status.textContent='Lampe refusée par cette caméra.';}finally{b.disabled=false;}};}
 const caps=control.caps.zoom;if(caps&&Number.isFinite(caps.min)&&Number.isFinite(caps.max)&&caps.max>caps.min){const label=document.createElement('label'),input=document.createElement('input'),value=document.createElement('span');label.textContent='Zoom ';input.type='range';input.min=caps.min;input.max=Math.max(caps.min,Math.min(caps.max,4));input.step=caps.step||0.1;input.value=roundedZoom(track.getSettings?.().zoom||caps.min,caps);value.textContent=Number(input.value).toFixed(1)+'×';label.append(value,input);host.append(label);input.onchange=async()=>{input.disabled=true;try{if(await control.apply({zoom:roundedZoom(Number(input.value),caps)})){input.value=track.getSettings?.().zoom||caps.min;value.textContent=Number(input.value).toFixed(1)+'×';report();}}catch{status.textContent='Zoom refusé par cette caméra.';}finally{input.disabled=false;}};}
 return()=>{control.dispose();host.hidden=true;host.replaceChildren();};
}
const api={roundedZoom,controller,mount};root.CameraControls=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
