'use strict';
// Each photo gets a disposable worker: terminating it releases the WASM heap.
let loaded=false;
self.onmessage=async event=>{
 try{
  const {width,height,buffer}=event.data;
  if(width<1||height<1||width>1600||height>1600||buffer.byteLength!==width*height*4)throw Error('Dimensions de photo invalides.');
  if(!loaded){importScripts('https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/iife/reader/index.js');loaded=true;}
  const results=await ZXingWASM.readBarcodes(new ImageData(new Uint8ClampedArray(buffer),width,height),{tryHarder:true,maxNumberOfSymbols:50,formats:['EAN13','EAN8','UPCA','UPCE','Code128','Code39','ITF','QRCode','DataMatrix']});
  self.postMessage({results:results.map(({text,position,isValid})=>({text,position,isValid}))});
 }catch(error){self.postMessage({error:error.message||'Mémoire insuffisante pour cette photo.'});}
};
