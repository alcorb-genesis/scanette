const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8');
const logistics=['application.html','logistics-sessions.html','store-partners.html','team.html','store-settings.html','preparation.html','returns.html','inventory/index.html','inventory/prepare.html'];
test('logistics pages share the base stylesheet, loaded before their own',()=>{
 for(const page of logistics){const html=read(page),base=html.search(/ui-base\.css/);assert.ok(base>0,page);assert.match(html,/<html lang="fr" class="ui">/,page);
  for(const own of html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g))if(!own[1].includes('ui-base'))assert.ok(html.indexOf(own[1])>base,page+' '+own[1]);}
 for(const page of ['logistics-sessions.html','store-partners.html','team.html','store-settings.html'])assert.equal(read(page).includes('application.css'),false,page+' no longer borrows the shell stylesheet');
});
test('the garage portal keeps its own isolated stylesheet and scripts',()=>{const html=read('returns-portal.html');assert.equal(/ui-base|nav-layers|nav-history/.test(html),false);});
test('each declared layer names an existing close button in the same page',()=>{
 for(const page of ['index.html','bellecave.html','preparation.html','returns.html','inventory/index.html']){const html=read(page);
  for(const m of html.matchAll(/data-layer-close="([^"]+)"/g))assert.match(html,new RegExp('id="'+m[1]+'"'),page+' → '+m[1]);
  assert.match(html,/nav-layers\.js/,page);}
 for(const page of ['preparation.html','inventory/index.html']){const html=read(page);assert.ok(html.indexOf('nav-history.js')<html.indexOf('nav-layers.js'),page+' can run outside the application');}
 const shell=read('application.html');assert.ok(shell.indexOf('nav-history.js')<shell.indexOf('application.js'));assert.match(shell,/id="backHint"[^>]*hidden/);
});
test('main actions are marked, so they stand out from secondary ones',()=>{
 const primary=(page,id)=>assert.match(read(page),new RegExp('id="'+id+'"[^>]*class="primary"'),page+' #'+id);
 primary('logistics-sessions.html','save');primary('store-partners.html','save');primary('team.html','save');primary('store-settings.html','save');
 for(const id of ['new','aim','begin','cameraButton','finish'])primary('preparation.html',id);
 for(const id of ['new','save','next'])primary('returns.html',id);
});
test('new shared files are published and kept offline for the inventory',()=>{
 const build=read('build.cjs');for(const f of ['ui-base.css','nav-history.js','nav-layers.js'])assert.match(build,new RegExp("'"+f.replace('.','\\.')+"'"));
 const sw=read('inventory/sw.js');for(const f of ['../ui-base.css','../nav-history.js','../nav-layers.js','../shared-access.js'])assert.ok(sw.includes("'"+f+"'"),f);assert.match(sw,/alcorb-inventory-static-v6/);
});
test('the base stylesheet adds no specificity to element rules',()=>{
 const css=read('ui-base.css').replace(/\/\*[\s\S]*?\*\//g,'').replace(/@media[^{]*\{/g,'');let checked=0;
 for(const rule of css.split('}')){const selector=rule.split('{')[0].trim();if(!selector||selector===':root'||selector==='.ui-back-hint')continue;
  for(const part of selector.split(/,(?![^(]*\))/)){assert.match(part.trim(),/^:where\(\.ui\)/,part);checked++;}}
 assert.ok(checked>30,'rules were actually inspected: '+checked);
});
