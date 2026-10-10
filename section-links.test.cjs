const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createNavHistory}=require('./nav-history.js');
const read=f=>fs.readFileSync(f,'utf8'),source=read('section-links.js');
/* The link helper loaded in a page: inside the shell (a parent that receives messages) or on its own. */
function load({embedded=true,search=''}={}){
 const sent=[],location={origin:'https://app.test',search,href:'https://app.test/module.html'+search},root={location};
 root.parent=embedded?{postMessage:(message,origin)=>sent.push({message,origin})}:root;root.open=()=>{throw Error('a link must never open a window');};
 vm.runInNewContext(source,{globalThis:root,URLSearchParams});return {L:root.SectionLinks,sent,location};
}
const receipt='0f8fad5b-d9cb-469f-a165-70867728950e';
test('inside the application, a link asks the shell for a section: one message, same origin, no window',()=>{
 const a=load();assert.equal(a.L.go('catalogue',{query:' TEST-123 ',resume:'case-1'}),true);
 assert.deepEqual(JSON.parse(JSON.stringify(a.sent)),[{message:{type:'alcorb-section',section:'catalogue',query:'TEST-123',resume:'case-1'},origin:'https://app.test'}]);
 assert.equal(a.location.href,'https://app.test/module.html','the module itself does not navigate');
});
test('outside the application, the same link is an ordinary address of the shell, in the same tab',()=>{
 const a=load({embedded:false});a.L.go('departures',{query:'CN AUTO'},'../');assert.equal(a.location.href,'../application.html?q=CN+AUTO#departures');assert.equal(a.sent.length,0);
 assert.equal(a.L.address('scan',{receiptId:receipt}),'application.html?receipt='+receipt+'#scan');assert.equal(a.L.address('home'),'application.html#home');
});
test('unknown sections and unusable values are dropped, never forwarded',()=>{
 const {L,sent}=load();assert.equal(L.go('admin',{query:'x'}),false);assert.equal(L.request('https://evil.test'),null);assert.equal(sent.length,0);
 const message=L.request('returns',{query:'a\u0000b\n c'+'x'.repeat(400),resume:'<script>',receiptId:'not-an-id'});
 assert.equal(message.query.length,160);assert.match(message.query,/^a b c/);assert.equal('resume' in message,false);assert.equal('receiptId' in message,false);
});
test('a module reads what the shell passed to it, cleaned the same way',()=>{
 const {L}=load({search:'?embedded=1&q=CN%20AUTO&resume=doc-42&receipt='+receipt});assert.equal(L.param('q'),'CN AUTO');assert.equal(L.param('resume'),'doc-42');assert.equal(L.param('receipt'),receipt);
 assert.equal(load({search:'?resume=a%20b&receipt=1'}).L.param('resume'),'');assert.equal(load({search:'?receipt=1'}).L.param('receipt'),'');
});
test('the link helper and the linked modules open no window and no tab',()=>{
 assert.doesNotMatch(source,/window\.open|_blank|target\s*=/);
 for(const file of ['bellecave.js','preparation.js','returns.js','store-partners.js'])assert.doesNotMatch(read(file).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,''),/SectionLinks[^;]*(window\.open|_blank)/,file);
 for(const [page,script] of [['bellecave.html','bellecave.js'],['preparation.html','preparation.js'],['returns.html','returns.js'],['store-partners.html','store-partners.js'],['index.html','receipt-link.js'],['inventory/index.html','app.js']]){
  const html=read(page),at=html.indexOf('section-links.js');assert.ok(at>0,page+' loads the link helper');assert.ok(at<html.lastIndexOf('src="'+script),page+' loads it before its own script');}
 assert.match(read('build.cjs'),/'section-links\.js'/);assert.ok(read('inventory/sw.js').includes("'../section-links.js'"));
});
test('each section offers its links, as buttons, towards existing sections only',()=>{
 const links={'preparation.js':['catalogue','departures'],'returns.js':['departures'],'store-partners.js':['returns'],'inventory/app.js':['catalogue'],'index.html':['catalogue']};
 const L=load().L;
 for(const [file,targets] of Object.entries(links)){const text=read(file);for(const target of targets){assert.ok(L.SECTIONS.includes(target));assert.match(text,new RegExp("(go|button)\\((document,[^)]*?)?'"+target+"'|leaveFor\\('"+target+"'|data-go=\""+target+"\"|dataset\\.go='"+target+"'"),file+' → '+target);}}
 assert.match(read('preparation.html'),/<button id="departureLink" type="button" class="section-link"/);assert.match(read('returns.html'),/<button[^>]*id="garageLink"/);
 assert.doesNotMatch(read('preparation.html')+read('returns.html')+read('store-partners.html'),/<a [^>]*section-link/);
});
test('the shell forwards the search to the destination and keeps the place to reopen on the screen left',()=>{
 const shell=read('application.js');assert.match(shell,/e\.data\.query,e\.data\.resume/);assert.match(shell,/nav\.annotate\(/);assert.match(shell,/'q='\+encodeURIComponent/);assert.match(shell,/'resume='\+encodeURIComponent/);
 assert.doesNotMatch(shell,/window\.open|_blank/);
});
/* Android Back: the screen that was left is rendered again with its marker; the destination keeps its search. */
test('Back after a link returns to the origin with its record, forward data is never invented',async()=>{
 const tick=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};
 const entries=[{state:null},{state:null}];let index=1,listener=null;const rendered=[];
 const history={get state(){return entries[index].state;},pushState(s){entries.splice(index+1);entries.push({state:structuredClone(s)});index++;},replaceState(s){entries[index]={state:structuredClone(s)};},back(){this.go(-1);},go(d){setImmediate(()=>{if(index+d<1)return;index+=d;listener?.(entries[index].state);});}};
 let section='home';const nav=createNavHistory({history,render:(s,r,entry)=>{rendered.push({s,query:entry?.query,resume:entry?.resume});section=s;},current:()=>section,canLeave:()=>true,closeLayer(){},toast(){}});listener=s=>nav.onPopState(s);
 nav.start('home');nav.openScreen('returns');section='returns';
 nav.annotate({resume:'case-1'});nav.openScreen('catalogue',{query:'TEST-123'});section='catalogue';
 history.back();await tick();assert.deepEqual(rendered.at(-1),{s:'returns',query:undefined,resume:'case-1'});
 history.back();await tick();assert.equal(rendered.at(-1).s,'home');assert.equal(rendered.at(-1).resume,undefined);
});
