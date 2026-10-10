/* Public garage portal. No account, no session, no token: three public RPCs and nothing else
   (garage names, the designation of one exact reference, the request itself). */
(()=>{'use strict';
const G=GaragePortal,$=id=>document.getElementById(id),shop='8770297c-cadb-4cc6-8b93-55a0f9bd154e';
// Never reuse a staff session that may exist on this device: the portal always calls as an anonymous visitor.
const db=supabase.createClient('https://pryocchvwmnuoidtitow.supabase.co','sb_publishable_AQ9cr2Z7Kr6EAravVOgB9Q_Z5Mx2yOZ',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
let garages=[],lines=[],scanner=null,last='',lastAt=0,busy=false,pending=null;
// Designations already answered, by reference: '' = the catalogue has none. Never sent back to the server.
const designations=new Map(),asking=new Set();
function say(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
function paintGarageHint(){const value=G.space($('garage').value);if(!value){$('garageHint').textContent='';return;}const g=G.garage(value,garages);$('garageHint').textContent=g.listed?'Garage reconnu.':g.ambiguous?'Plusieurs garages portent ce nom : l’équipe vérifiera.':'Nom saisi : l’équipe vérifiera le garage.';}
function paint(){const host=$('lines');host.replaceChildren();if(!lines.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Aucune pièce ajoutée pour l’instant.';host.append(empty);return;}
 for(const item of lines){const card=document.createElement('article'),what=document.createElement('div'),ref=document.createElement('strong'),label=document.createElement('span'),about=G.describe(designations.get(item.reference)),quantity=document.createElement('span'),less=document.createElement('button'),more=document.createElement('button'),remove=document.createElement('button');
  card.className='line';what.className='what';ref.textContent=item.reference;label.textContent=about.text;label.className=about.known?'designation':'designation none';label.hidden=!about.text;what.append(ref,label);quantity.className='quantity';quantity.textContent=String(item.quantity);less.type=more.type=remove.type='button';less.className=more.className=remove.className='secondary';less.textContent='−';more.textContent='+';remove.textContent='Retirer';
  less.setAttribute('aria-label','Une pièce de moins pour '+item.reference);more.setAttribute('aria-label','Une pièce de plus pour '+item.reference);remove.setAttribute('aria-label','Retirer '+item.reference);
  less.onclick=()=>{lines=item.quantity===1?lines.filter(l=>l!==item):lines.map(l=>l===item?{...l,quantity:l.quantity-1}:l);paint();};
  more.onclick=()=>{if(item.quantity<G.LIMITS.quantity)lines=lines.map(l=>l===item?{...l,quantity:l.quantity+1}:l);paint();};
  remove.onclick=()=>{lines=lines.filter(l=>l!==item);paint();say(item.reference+' retirée.');};
  card.append(what,less,quantity,more,remove);host.append(card);}}
function add(raw){const result=G.addLine(lines,raw);if(result.error){say(result.error,true);return;}if(!result.line)return;lines=result.lines;$('reference').value='';say(result.line.quantity>1?result.line.reference+' : '+result.line.quantity+' pièces.':result.line.reference+' ajoutée.');paint();lookup(result.line.reference);}
/* One question per reference, after the line is already on screen: adding never waits for it, and a failed
   or missing answer leaves the line as it is. */
async function lookup(reference){if(designations.has(reference)||asking.has(reference))return;asking.add(reference);
 try{const {data,error}=await db.rpc('returns_public_designation',{shop_id:shop,code:reference});if(error)throw error;designations.set(reference,G.designation(data));if(lines.some(line=>line.reference===reference))paint();}
 catch{/* No designation shown; the reference stays usable. */}
 finally{asking.delete(reference);}}
async function stop(){const old=scanner;scanner=null;$('scanner').hidden=true;if(old)try{await old.stop();old.clear();}catch{}}
async function start(){if(scanner)return;scanner=new Html5Qrcode('reader');$('scanner').hidden=false;try{await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:260,height:120}},code=>{const now=Date.now();if(code===last&&now-lastAt<1300)return;last=code;lastAt=now;add(code);},()=>{});}catch{await stop();say('Caméra indisponible. Saisissez la référence.',true);}}
async function loadGarages(){try{const {data,error}=await db.rpc('returns_public_garages',{shop_id:shop});if(error)throw error;garages=Array.isArray(data)?data.filter(g=>g&&typeof g.id==='string'&&typeof g.name==='string'):[];const list=$('garageList');list.replaceChildren();for(const g of garages){const option=document.createElement('option');option.value=g.name;list.append(option);}paintGarageHint();}catch{garages=[];/* The name can always be typed. */}}
async function submit(event){event.preventDefault();if(busy)return;
 const problem=G.validate({garageName:$('garage').value,lines,location:$('location').value});if(problem){say(problem,true);return;}
 const draft=G.payload({shopId:shop,requestId:'',garageName:$('garage').value,list:garages,lines,location:$('location').value}),fingerprint=JSON.stringify({...draft,request_id:''});
 // The same request id is reused only for an identical retry, so a lost answer never creates a duplicate.
 if(!pending||pending.fingerprint!==fingerprint)pending={id:crypto.randomUUID(),fingerprint};
 busy=true;$('submit').disabled=true;say('Envoi…');
 try{const {error}=await db.rpc('returns_public_submit',{...draft,request_id:pending.id});if(error)throw error;
  pending=null;lines=[];paint();await stop();$('form').hidden=true;$('done').hidden=false;say('');}
 catch(error){say(G.errorMessage(error),true);}
 finally{busy=false;$('submit').disabled=false;}}
$('garage').oninput=paintGarageHint;$('add').onclick=()=>add($('reference').value);$('reference').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();add($('reference').value);}};
$('camera').onclick=start;$('stop').onclick=stop;$('form').onsubmit=submit;
$('again').onclick=()=>{$('done').hidden=true;$('form').hidden=false;$('reference').value='';$('location').value='';lines=[];paint();say('');};
window.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
paint();loadGarages();
})();
