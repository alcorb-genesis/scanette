import urllib.request,urllib.parse,json,pathlib,datetime
query='[out:json][timeout:120];area["ISO3166-2"="FR-NAQ"]["boundary"="administrative"]->.r;nwr["shop"~"^(car_repair|car_parts)$"](area.r);out center tags;'
req=urllib.request.Request('https://overpass-api.de/api/interpreter',data=urllib.parse.urlencode({'data':query}).encode(),headers={'User-Agent':'Alcorb-Public-Reference/1.0'})
with urllib.request.urlopen(req,timeout=180) as r:data=json.load(r)
if data.get('remark'):raise RuntimeError(data['remark'])
entries=[]
for e in data['elements']:
 t=e['tags'];name=t.get('name') or t.get('brand')
 if not name or t.get('disused')=='yes' or t.get('access')=='private':continue
 siret=t.get('ref:FR:SIRET','');siret=siret if len(siret)==14 and siret.isdigit() else None
 entries.append({'id':f"osm-{e['type']}-{e['id']}",'siret':siret,'name':name,'kind':'garage' if t['shop']=='car_repair' else 'supplier','address':' '.join(filter(None,[t.get('addr:housenumber'),t.get('addr:street'),t.get('addr:postcode'),t.get('addr:city')])),'city':t.get('addr:city',''),'postcode':t.get('addr:postcode',''),'department':t.get('addr:postcode','')[:2],'phone':t.get('contact:phone') or t.get('phone'),'email':t.get('contact:email') or t.get('email'),'website':t.get('contact:website') or t.get('website'),'source':f"https://www.openstreetmap.org/{e['type']}/{e['id']}",'license':'ODbL 1.0','quality':'Coordonnées collaboratives à vérifier ; activité et statut administratif non certifiés','coordinates':e.get('center') or {'lat':e.get('lat'),'lon':e.get('lon')}})
out={'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'OpenStreetMap contributors','license':'ODbL 1.0','licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/','query':query,'entries':entries}
path=pathlib.Path(__file__).resolve().parents[1]/'partners-osm-data.json'
path.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('FINISHED',len(entries),'phones',sum(bool(x['phone']) for x in entries),'emails',sum(bool(x['email']) for x in entries),flush=True)
