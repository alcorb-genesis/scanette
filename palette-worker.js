'use strict';
// Each photo gets a disposable worker: terminating it releases the WASM heap.
let loaded=false;
// Photo-only magnification, one reusable buffer. Never enlarge the whole photo.
function starts(length,size){const out=[0];while(out[out.length-1]+size<length)out.push(Math.min(length-size,out[out.length-1]+Math.floor(size*.75)));return out;}
function magnify(source,width,height,left,top,w,h,target){
 for(let y=0;y<h*2;y++)for(let x=0;x<w*2;x++){
  const sx=Math.max(0,Math.min(w-1,(x+.5)/2-.5)),sy=Math.max(0,Math.min(h-1,(y+.5)/2-.5));
  const x0=Math.floor(sx),y0=Math.floor(sy),dx=sx-x0,dy=sy-y0;
  const a=((top+y0)*width+left+x0)*4,b=((top+y0)*width+left+Math.min(w-1,x0+1))*4;
  const c=((top+Math.min(h-1,y0+1))*width+left+x0)*4,d=((top+Math.min(h-1,y0+1))*width+left+Math.min(w-1,x0+1))*4;
  const dest=(y*w*2+x)*4;
  for(let k=0;k<3;k++)target[dest+k]=(source[a+k]*(1-dx)+source[b+k]*dx)*(1-dy)+(source[c+k]*(1-dx)+source[d+k]*dx)*dy;
  target[dest+3]=255;
 }
}
function bounds(position){const points=Object.values(position);return {l:Math.min(...points.map(p=>p.x)),r:Math.max(...points.map(p=>p.x)),t:Math.min(...points.map(p=>p.y)),b:Math.max(...points.map(p=>p.y))};}
function sameZone(a,b){
 if(a.text!==b.text||!a.position||!b.position)return false;
 const x=bounds(a.position),y=bounds(b.position),overlap=Math.max(0,Math.min(x.r,y.r)-Math.max(x.l,y.l))*Math.max(0,Math.min(x.b,y.b)-Math.max(x.t,y.t));
 return overlap>Math.min((x.r-x.l)*(x.b-x.t),(y.r-y.l)*(y.b-y.t))*.5;
}
self.onmessage=async event=>{
 try{
  const {width,height,buffer}=event.data;
  if(width<1||height<1||width>1600||height>1600||buffer.byteLength!==width*height*4)throw Error('Dimensions de photo invalides.');
  if(!loaded){importScripts('https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/iife/reader/index.js');loaded=true;}
  const pixels=new Uint8ClampedArray(buffer),options={tryHarder:true,maxNumberOfSymbols:50,formats:['EAN13','EAN8','UPCA','UPCE','Code128','Code39','ITF','QRCode','DataMatrix']};
  const results=await ZXingWASM.readBarcodes(new ImageData(pixels,width,height),options);
  if(event.data.photo){
   const w=Math.min(800,width),h=Math.min(800,height),zoom=new Uint8ClampedArray(w*h*16);
   for(const top of starts(height,h))for(const left of starts(width,w)){
    magnify(pixels,width,height,left,top,w,h,zoom);
    const found=await ZXingWASM.readBarcodes(new ImageData(zoom,w*2,h*2),options);
    for(const item of found){
     if(!item.text||item.isValid===false||!item.position)continue;
     item.position=Object.fromEntries(Object.entries(item.position).map(([key,p])=>[key,{x:p.x/2+left,y:p.y/2+top}]));
     if(!results.some(previous=>sameZone(previous,item)))results.push(item);
    }
   }
  }
  self.postMessage({results:results.map(({text,position,isValid})=>({text,position,isValid}))});
 }catch(error){self.postMessage({error:error.message||'Mémoire insuffisante pour cette photo.'});}
};
