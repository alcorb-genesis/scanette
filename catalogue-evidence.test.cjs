'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const E=require('./catalogue-evidence.js');
test('GTIN check digit rejects typos and placeholders, keeps leading zeroes',()=>{
 assert.equal(E.gtin('5056197292037'),true);assert.equal(E.gtin('3286065010483'),true);
 for(const code of ['5056197292038','.','','NST4073','200'])assert.equal(E.gtin(code),false);
});
test('vehicle search does not infer fitments from OEM numbers or pair references',()=>{
 assert.equal(E.searchText({oem:['8200166160'],paired:'NST6621'}),'');
 assert.equal(E.searchText({vehicles:[{make:'Citroën',model:'C1 II',source_url:'https://www.purflux.com/bulletin.pdf'}]}),'Citroen C1 II');
});
test('source links reject executable protocols and malformed evidence',()=>{
 assert.equal(E.sourceUrl('javascript:alert(1)'),null);assert.deepEqual(E.vehicles({vehicles:[null,{make:'Audi',model:'A4',source_url:'data:text/html,x'}]}),[]);
});
test('filter sanitization removes PostgREST syntax and wildcards',()=>{
 assert.equal(E.clean(' Citroën , A4%_*() '),'Citroen A4');
});
