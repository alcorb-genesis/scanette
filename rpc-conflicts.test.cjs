const fs=require('node:fs'),test=require('node:test'),assert=require('node:assert/strict');
test('RPC business conflicts are non-retryable HTTP 409 errors',()=>{
 for(const file of ['delivery-position.sql','gestion-settings.sql','gestion-team.sql','gestion-partners.sql','gestion-sales.sql','gestion-purchases.sql','logistics-sessions.sql']){
  const sql=fs.readFileSync(file,'utf8');assert.doesNotMatch(sql,/errcode\s*=\s*'40001'/i,file);assert.match(sql,/errcode\s*=\s*'PT409'/i,file);
 }
});
test('Conflict responses preserve the reload advice',()=>{const G=require('./garage-records.js');assert.match(G.error({code:'PT409'}),/modifiée ailleurs/);assert.equal(G.error({code:'PT409'}),G.error({code:'40001'}));});
