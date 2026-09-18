const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('photo zoom stays bounded, maps coordinates back and merges overlapping detections',async()=>{
 let calls=0,reply;
 const ctx={Uint8ClampedArray,ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},importScripts(){},self:{postMessage(r){reply=r;}},ZXingWASM:{async readBarcodes(image){
  assert(image.width<=1600&&image.height<=1600);calls++;
  if(calls===1)return [];
  // The same barcode in the two overlapping vertical tiles.
  const y=calls===2?900:100;
  return [{text:'8076809587310',isValid:true,position:{topLeft:{x:100,y},topRight:{x:200,y},bottomLeft:{x:100,y:y+40},bottomRight:{x:200,y:y+40}}}];
 }}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/palette-worker.js','utf8'),ctx);
 await ctx.self.onmessage({data:{width:600,height:1200,buffer:new Uint8ClampedArray(600*1200*4).buffer,photo:true}});
 assert(!reply.error,reply.error);assert.equal(calls,3);assert.equal(reply.results.length,1);
 assert.equal(reply.results[0].position.topLeft.x,50);assert.equal(reply.results[0].position.topLeft.y,450);
 calls=0;await ctx.self.onmessage({data:{width:600,height:1200,buffer:new Uint8ClampedArray(600*1200*4).buffer}});
 assert.equal(calls,1,'video must keep its single-pass decoding');
});
