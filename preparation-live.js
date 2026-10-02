/* Sequential temporary camera frames: no recording or upload. */
(function(g){'use strict';
function create({video,media,read,result,status,schedule=setTimeout,unschedule=clearTimeout}){
 let generation=0,stream=null,timer=null;
 function stop(){generation++;if(timer!==null)unschedule(timer);timer=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;}
 async function start(){stop();const ticket=generation;let attempts=0;
 try{const acquired=await media.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1920}}});if(ticket!==generation){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;video.srcObject=stream;await video.play();if(ticket!==generation)return;
 async function sample(){if(ticket!==generation)return;try{status('Gardez le BL entier immobile · lecture '+(++attempts)+' / 3');const value=await read(video);if(ticket!==generation)return;stop();await result(value);}catch(e){if(ticket!==generation)return;if(attempts>=3){stop();status('Lecture non aboutie : '+e.message+' Améliorez le cadrage puis relancez.');return;}status('Ajustez le cadrage : '+e.message);timer=schedule(sample,2500);}}
 timer=schedule(sample,2500);
 }catch(e){if(ticket===generation){stop();status('Caméra indisponible : '+e.message);}}
 }
 return {start,stop};
}
const api={create};if(typeof module!=='undefined')module.exports=api;else g.PreparationLive=api;
})(globalThis);
