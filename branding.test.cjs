const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
/* The software is called « Repclick ». « Alcorb » is the company that publishes it: it must not
   appear as the product name on any screen, title, meta tag or installable-application label. */
const read=f=>fs.readFileSync(f,'utf8');
// Technical identifiers that keep the company prefix on purpose: renaming them would lose data
// already stored on devices (local storage keys, offline cache) or break messages between frames.
const technical=/Alcorb(Auth|NavHistory|Layers)\b|alcorb[-.][a-z0-9.-]*|['"#.]alcorb\b|\balcorb:1\b|id="alcorb-demo"/g;
const sources=()=>{const out=[],skip=new Set(['.git','node_modules','public','private-import','scripts']);
 const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(skip.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);
  else if(/\.(html|js|css|webmanifest)$/.test(e.name)&&!/\.test\.|html5-qrcode|\.min\./.test(e.name))out.push(p);}};walk('.');return out;};
test('no screen, title or label names the product « Alcorb »',()=>{
 const files=sources();assert.ok(files.length>60,String(files.length));
 for(const f of files){const left=read(f).replace(technical,'').match(/.{0,30}alcorb.{0,30}/i);assert.equal(left,null,f+' → '+left);}
});
test('published pages and the redirect pages carry the product name, not the company name',()=>{
 execFileSync(process.execPath,['build.cjs']);const pages=[];
 const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.html'))pages.push(p);}};walk('public');
 assert.ok(pages.length>=15,String(pages.length));
 for(const p of pages){const title=(read(p).match(/<title>([^<]*)<\/title>/)||[])[1];assert.ok(title,p+' has a title');assert.equal(/alcorb/i.test(title),false,p+' title: '+title);}
 const named=/<title>[^<]*R[Ee][Pp][Cc][Ll][Ii][Cc][Kk][^<]*<\/title>/;
 for(const p of ['application.html','index.html','inventory/index.html','inventory/prepare.html'])assert.match(read(path.join('public',p)),named,p);
 // Retired screens are published as a redirection to the application: their title is the product name.
 const redirects=pages.filter(p=>/http-equiv="refresh" content="0;url=application\.html/.test(read(p)));assert.ok(redirects.length>=4,String(redirects.length));
 for(const p of redirects)assert.match(read(p),/<title>Repclick<\/title>/,p);
});
test('installable application, meta tags and garage portal agree on « Repclick »',()=>{
 const main=JSON.parse(read('manifest.webmanifest')),portal=JSON.parse(read('returns-portal.webmanifest'));
 assert.equal(main.name,'Repclick');assert.equal(main.short_name,'Repclick');assert.match(portal.name,/^Repclick · /);
 for(const m of [main,portal])assert.equal(/alcorb/i.test([m.name,m.short_name,m.description].join(' ')),false);
 for(const page of ['application.html','returns-portal.html']){const html=read(page);
  assert.match(html,/<meta name="application-name" content="Repclick">/,page);assert.match(html,/<meta name="apple-mobile-web-app-title" content="Repclick">/,page);}
 assert.match(read('application.html'),/<title>Repclick · Logistique<\/title>/);assert.match(read('application.html'),/<strong>REPCLICK · Logistique<\/strong>/);
 // The portal still shows nothing internal and no link towards logistics.
 assert.equal(/<a [^>]*href|shared-access|application\.js/.test(read('returns-portal.html')),false);
});
test('stored data and messages keep their identifiers: nothing saved on a device is orphaned by the new name',()=>{
 // Keys and message types in use before the rename are still the ones the code reads.
 for(const [file,key] of [['inventory/sw.js','alcorb-inventory-static-'],['application.js','alcorb-dirty'],['application.js','alcorb-section'],['application-nav.js','alcorb-section'],['nav-history.js','AlcorbNavHistory'],['nav-layers.js','AlcorbLayers']])
  assert.ok(read(file).includes(key),file+' keeps '+key);
});
