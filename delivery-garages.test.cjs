const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('Map distinguishes private garages from public directory and never locates a namesake by name',async()=>{
 const nodes={},drawn=[];let auth;
 const node=()=>({value:'',checked:true,children:[],textContent:'',append(n){this.children.push(n)},replaceChildren(){this.children=[]}}),$=id=>nodes[id]??=node();
 const map={on(){},getBounds:()=>({contains:()=>true}),getZoom:()=>15};
 const db={auth:{onAuthStateChange(fn){auth=fn},getSession:async()=>({data:{session:{user:{id:'u'}}}})},from(){const q={select(){return q},eq(){return q},order(){return q},range:async()=>({data:[{name:'Private',source_key:'12345678901234',details:{}},{name:'Namesake',details:{}},{name:'Invalid',details:{coordinates:{lat:null,lon:null}}},{name:'Merged',details:{merged_into:'a',coordinates:{lat:43,lon:-1}}}]})};return q;}};
 const directory=[{id:'osm1',siret:'12345678901234',name:'Public name',kind:'garage',department:'64',coordinates:{lat:43.5,lon:-1.5}},{id:'osm2',name:'Namesake',kind:'garage',department:'40',coordinates:{lat:43.8,lon:-1}},{id:'osm3',name:'Bordeaux',kind:'garage',department:'33',coordinates:{lat:44.8,lon:-.6}}];
 const L={circleMarker(point,style){const item={point,style,removed:false};drawn.push(item);return {addTo(){return this},bindTooltip(label){item.name=label.textContent;return this},bindPopup(){return this},remove(){item.removed=true}};}};
 const w={deliveryMap:map};w.parent=w;
 vm.runInNewContext(fs.readFileSync('delivery-garages.js','utf8'),{window:w,document:{getElementById:$,createElement:node},L,supabase:{createClient:()=>db},fetch:async()=>({ok:true,json:async()=>({entries:directory})}),setTimeout,Number,Set});
 await new Promise(r=>setImmediate(r));let live=drawn.filter(x=>!x.removed);assert.deepEqual(live.map(x=>x.name),['Private','Namesake']);assert.notEqual(live[0].style.fillColor,live[1].style.fillColor);assert.match($('garageStatus').textContent,/2 sans coordonnées/);
 $('publicGarages').checked=false;$('publicGarages').onchange();live=drawn.filter(x=>!x.removed);assert.deepEqual(live.map(x=>x.name),['Private']);
 auth('SIGNED_OUT',null);await new Promise(r=>setTimeout(r,5));assert.equal(drawn.filter(x=>!x.removed).length,0);
});
