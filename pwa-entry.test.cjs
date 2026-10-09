const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
/* Home-screen shortcut and entry navigation. Without a web app manifest, « Add to Home screen »
   only creates a bookmark and the browser opens a new tab at every launch. With one, the site is
   installed as an application with a single window. Nothing in the entry path may open a window. */
const read=f=>fs.readFileSync(f,'utf8'),json=f=>JSON.parse(read(f));
const png=f=>{const b=fs.readFileSync(f);assert.equal(b.subarray(1,4).toString(),'PNG',f);return [b.readUInt32BE(16),b.readUInt32BE(20)];};
const resolve=(base,ref)=>new URL(ref,'https://app.test/'+base).pathname;
function checkManifest(file,page){
 const m=json(file);
 assert.ok(m.name&&m.short_name&&m.short_name.length<=12,file+' names');assert.equal(m.display,'standalone',file);assert.equal(m.lang,'fr');
 // Start page inside the scope, and the scope does not escape the site folder.
 const start=resolve(file,m.start_url),scope=resolve(file,m.scope);assert.ok(start.startsWith(scope),file+' start_url in scope');assert.equal(start,'/'+page);assert.equal(resolve(file,m.id),start,'stable identity');
 assert.equal(/^https?:|^\/\//.test(m.start_url+m.scope),false,'relative addresses: the same files work on any host');
 // Icons Chrome needs to offer the installation: 192 and 512, plus a maskable one.
 const sizes=new Set();for(const icon of m.icons){const [w,h]=png(icon.src);assert.equal(icon.sizes,w+'x'+h,icon.src);assert.equal(icon.type,'image/png');sizes.add(icon.sizes+':'+icon.purpose);}
 for(const need of ['192x192:any','512x512:any','512x512:maskable'])assert.ok(sizes.has(need),file+' '+need);
 // A second launch goes to the window already open instead of creating another one.
 assert.equal([].concat(m.launch_handler.client_mode)[0],'navigate-existing');
 assert.match(m.theme_color,/^#[0-9a-f]{6}$/);assert.match(m.background_color,/^#[0-9a-f]{6}$/);
 return m;
}
test('logistics is installable: manifest, icons, single window, starting on the access screen',()=>{
 const m=checkManifest('manifest.webmanifest','application.html');assert.equal(resolve('manifest.webmanifest',m.scope),'/');
 const html=read('application.html');assert.match(html,/<link rel="manifest" href="manifest\.webmanifest">/);assert.match(html,/<meta name="theme-color"/);assert.match(html,/<link rel="apple-touch-icon"/);
 // No login state, token or section travels in the start address.
 assert.equal(/[?#]/.test(m.start_url),false);
});
test('the garage portal stays a direct, separate entry: its own manifest, limited to its own page',()=>{
 const m=checkManifest('returns-portal.webmanifest','returns-portal.html'),scope=resolve('returns-portal.webmanifest',m.scope);
 for(const inside of ['/returns-portal.html','/returns-portal.js','/returns-portal.css'])assert.ok(inside.startsWith(scope),inside);
 for(const outside of ['/application.html','/returns.html','/index.html','/shared-access.js','/inventory/index.html'])assert.equal(outside.startsWith(scope),false,outside+' is outside the garage application');
 assert.notEqual(m.id,json('manifest.webmanifest').id);
 const html=read('returns-portal.html');assert.match(html,/<link rel="manifest" href="returns-portal\.webmanifest">/);assert.equal(/manifest\.webmanifest">/.test(html.replace('returns-portal.webmanifest">','')),false);
 assert.equal(/<a [^>]*href|shared-access|application\.js/.test(html),false,'still no link or script towards logistics');
});
test('manifests and icons are published',()=>{
 execFileSync(process.execPath,['build.cjs']);
 for(const f of ['manifest.webmanifest','returns-portal.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png'])assert.ok(fs.existsSync(path.join('public',f)),f);
 assert.deepEqual(json('public/manifest.webmanifest'),json('manifest.webmanifest'));
});
test('entry, login and navigation never create a window or a tab',()=>{
 // Shell, login forms, module redirection, history, garage portal (whichever of them this version has).
 const entry=['application.js','shared-access.js','auth-pin/pin-ui.js','password-visibility.js','application-nav.js','nav-history.js','nav-layers.js','returns-portal.js','returns-portal-core.js'].filter(f=>fs.existsSync(f));
 for(const f of ['application.js','application-nav.js','nav-history.js','returns-portal.js'])assert.ok(entry.includes(f),f);
 for(const f of entry){
  const t=read(f);assert.equal(/window\.open|\.open\(\s*['"`]|_blank|_top|\.target\s*=|['"]target['"]|openWindow|noopener/.test(t),false,f);}
 for(const f of ['application.html','returns-portal.html']){const t=read(f);assert.equal(/target=|window\.open|<base /.test(t),false,f);}
 // Redirections of the entry path replace or reuse the current page; all stay on the site.
 const moved=[];for(const f of entry)for(const m of read(f).matchAll(/location\.(replace|assign|href\s*=)\s*\(?\s*([^;]{0,60})/g))moved.push(f+': '+m[1]+' '+m[2]);
 assert.deepEqual(moved.map(x=>x.replace(/\s+/g,' ').slice(0,56)),["application-nav.js: replace 'application.html#'+(file==="]);
 // The service worker only caches the inventory files: it never opens or focuses a window.
 assert.equal(/openWindow|clients\.(matchAll|get)|\.focus\(|navigate\(/.test(read('inventory/sw.js')),false);
});
test('every remaining new window is a known, deliberate one (print, external site)',()=>{
 execFileSync(process.execPath,['build.cjs']);
 // Print windows (receipts, inventory, inventory lists), the scanner's web search, catalogue and directory links to other sites.
 const allowed={'index.html':1,'logistics-sessions.js':1,'inventory/app.js':1,'inventory/prepare.html':1,'bellecave.js':1,'reference-ui.js':5,'workspaces.js':3,'partenaires.js':1};
 const found={},walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(html|js)$/.test(e.name)&&!e.name.includes('html5-qrcode')){const n=(read(p).match(/window\.open\(|target\s*=\s*["']_blank|\.target\s*=\s*'_blank'/g)||[]).length;if(n)found[path.relative('public',p)]=n;}}};walk('public');
 for(const [file,count] of Object.entries(found))assert.ok(count<=(allowed[file]||0),file+' opens '+count+' window(s): a new window.open or target=_blank appeared, check it is not on the entry path');
});
