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
