const test=require('node:test'),assert=require('node:assert/strict'),W=require('./workspaces.js');
test('workspace presets contain only real modules and menus stay independent',()=>{
 const a=W.clean();assert.equal(a.role,'sales');assert.ok(a.menus.sales.includes('sale'));assert.ok(a.menus.logistics.includes('receive'));
 for(const role of Object.values(W.roles))for(const id of role.menus)assert.ok(W.modules[id]);
 W.toggle(a,'accounting');assert.ok(a.menus.sales.includes('accounting'));W.toggle(a,'sale');assert.ok(!a.menus.sales.includes('sale'));assert.ok(W.roles.sales.menus.includes('sale'));
 const persisted=W.clean(JSON.parse(JSON.stringify(a)));assert.deepEqual(persisted,a);
 a.role='logistics';assert.ok(a.menus.logistics.includes('receive'));assert.ok(!a.menus.logistics.includes('accounting'));
 const otherStore=W.clean();assert.ok(otherStore.menus.sales.includes('sale'));assert.ok(!otherStore.menus.sales.includes('accounting'));
});
test('invalid preferences cannot introduce unknown navigation or remove the home escape',()=>{
 const a=W.clean({role:'__proto__',menus:{sales:['sale','sale','home','unknown','<script>']}});assert.equal(a.role,'sales');assert.deepEqual(a.menus.sales,['sale']);W.toggle(a,'home');W.toggle(a,'__proto__');assert.deepEqual(a.menus.sales,['sale']);W.toggle(a,'sale');assert.deepEqual(a.menus.sales,[]);
});
test('migration preserves existing menus and individual profiles do not share preferences',()=>{
 const legacy=W.clean();W.toggle(legacy,'receive');const migrated=W.people(null,legacy);assert.ok(migrated.people[0].preferences.menus.sales.includes('receive'));
 const book=W.people({active:'person-second',people:[migrated.people[0],{id:'person-second',name:'Deuxième vendeur',code:'M008',preferences:W.clean(),links:[]}]});assert.equal(book.active,'person-second');W.toggle(book.people[1].preferences,'clients');assert.ok(book.people[0].preferences.menus.sales.includes('clients'));assert.ok(!book.people[1].preferences.menus.sales.includes('clients'));assert.deepEqual(W.people(JSON.parse(JSON.stringify(book))),book);
});
test('catalogue links reject scripts, non-HTTPS links and embedded credentials',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,bad','http://example.com','https://user:secret@example.com'])assert.equal(W.safeLink(url),'');
 assert.equal(W.safeLink('https://example.com/catalogue'),'https://example.com/catalogue');
 const book=W.people({people:[{id:'person-test',name:'Test',links:[{name:'bad',url:'javascript:alert(1)'}]}]});assert.equal(book.people[0].links.length,0);
});
