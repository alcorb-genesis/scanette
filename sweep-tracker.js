(function(root){
'use strict';
class SweepTracker{
 constructor(){this.tracks=[];this.sequence=0;this.pausedAt=null;}
 pause(time){if(this.pausedAt===null)this.pausedAt=time;}
 resume(time){if(this.pausedAt!==null){for(const t of this.tracks)t.seen+=time-this.pausedAt;this.pausedAt=null;}}
 update(detections,time){
  if(this.pausedAt!==null)return [];
  const available=new Set(this.tracks),visible=[];
  for(const d of detections){
   if(!d.text||!d.position)continue;
   const points=Object.values(d.position).filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y));if(points.length!==4)continue;
   const x=points.reduce((s,p)=>s+p.x,0)/4,y=points.reduce((s,p)=>s+p.y,0)/4;
   let best=null,distance=.20;
   for(const t of available){if(t.code!==d.text)continue;const delta=Math.hypot(t.x-x,t.y-y);if(delta<distance){distance=delta;best=t;}}
   if(!best){best={id:++this.sequence,code:d.text,hits:0,counted:false,misses:0};this.tracks.push(best);}
   available.delete(best);best.hits=best.misses?1:best.hits+1;best.misses=0;best.x=x;best.y=y;best.seen=time;best.position=d.position;visible.push(best);
  }
  for(const t of available){t.misses++;t.hits=0;}
  this.tracks=this.tracks.filter(t=>t.misses<3||time-t.seen<1500);
  return visible;
 }
}
root.SweepTracker=SweepTracker;if(typeof module!=='undefined')module.exports=SweepTracker;
})(typeof globalThis!=='undefined'?globalThis:this);
