const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('photo import preserves small PNG pixels and bounds rotated JPEG decoding',async()=>{
 const source=fs.readFileSync(__dirname+'/warehouse.js','utf8');
 const fn=source.slice(source.indexOf('async function photoDecodeWidth('),source.indexOf("byId('paletteFile').onchange="));
 const context=vm.createContext({DataView});vm.runInContext(fn,context);
 const png=Buffer.alloc(24);png.writeUInt32BE(0x89504e47,0);png.writeUInt32BE(0x0d0a1a0a,4);png.writeUInt32BE(720,16);png.writeUInt32BE(1600,20);
 assert.equal(await context.photoDecodeWidth(new Blob([png])),720);
 const jpeg=Buffer.alloc(49);jpeg.writeUInt16BE(0xffd8,0);jpeg.writeUInt16BE(0xffe1,2);jpeg.writeUInt16BE(34,4);jpeg.write('Exif\0\0',6);jpeg.write('II',12);jpeg.writeUInt16LE(42,14);jpeg.writeUInt32LE(8,16);jpeg.writeUInt16LE(1,20);jpeg.writeUInt16LE(0x112,22);jpeg.writeUInt16LE(3,24);jpeg.writeUInt32LE(1,26);jpeg.writeUInt16LE(6,30);jpeg.writeUInt16BE(0xffc0,38);jpeg.writeUInt16BE(9,40);jpeg.writeUInt16BE(3000,43);jpeg.writeUInt16BE(4000,45);
 assert.equal(await context.photoDecodeWidth(new Blob([jpeg])),1200);
});
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
