const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),R=require('./reference-core.js');
test('live directory search leaves the editing field untouched and updates filtered results',async()=>{
 const results={innerHTML:''};let repaints=0;
 const context={ReferenceCore:R,document:{getElementById:id=>id==='ref-results'?results:null},fetch:async file=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))})};
 vm.createContext(context);vm.runInContext(fs.readFileSync('reference-ui.js','utf8'),context);
 const ui=context.ReferenceUI.create({partners:()=>[],store:()=> 'test',attach(){},repaint(){repaints++;}});
 await ui.load();ui.setKind('supplier');assert.match(ui.render(),/id="ref-results"/);
 const before=repaints,field={id:'ref-query',value:'',selectionStart:0,selectionEnd:0,focus(){throw Error('Search must not refocus or replace the input');}};
 for(const letter of 'bosch'){field.value+=letter;field.selectionStart=field.selectionEnd=field.value.length;ui.input(field);assert.equal(field.selectionStart,field.value.length);}
 assert.equal(repaints,before);assert.equal(field.value,'bosch');assert.match(results.innerHTML,/Bosch · Automotive Aftermarket/);assert.doesNotMatch(results.innerHTML,/id="ref-query"/);
 field.value='aucun-resultat-xyz';ui.input(field);assert.match(results.innerHTML,/Aucun résultat/);
 field.value='';ui.input(field);assert.match(results.innerHTML,/Afficher 18 résultats/);
 ui.input({id:'ref-country',value:'Suisse'});assert.equal(repaints,before+1);assert.match(ui.render(),/Kraftwerk/);
 ui.setKind('garage');field.value='Bayonne';ui.input(field);assert.match(results.innerHTML,/BAYONNE|Bayonne/);
 ui.setKind('product');field.value='xyz-impossible';ui.input(field);assert.match(results.innerHTML,/Aucun résultat/);
});
