import urllib.request,json,pathlib,math
root=pathlib.Path(__file__).resolve().parents[1]
data=json.loads((root/'partners-osm-data.json').read_text(encoding='utf-8'))
grid={};polys=[]
for dep in ['16','17','19','23','24','33','40','47','64','79','86','87']:
 url=f'https://geo.api.gouv.fr/departements/{dep}/communes?fields=nom,code,codeDepartement&format=geojson&geometry=contour'
 with urllib.request.urlopen(url,timeout=90) as r:g=json.load(r)
 for f in g['features']:
  coords=f['geometry']['coordinates'];coords=[coords] if f['geometry']['type']=='Polygon' else coords
  for polygon in coords:
   ring=polygon[0];xs=[p[0] for p in ring];ys=[p[1] for p in ring];box=(min(xs),min(ys),max(xs),max(ys));idx=len(polys);polys.append((box,polygon,f['properties'],url))
   for x in range(math.floor(box[0]*10),math.floor(box[2]*10)+1):
    for y in range(math.floor(box[1]*10),math.floor(box[3]*10)+1):grid.setdefault((x,y),[]).append(idx)
def inside(x,y,ring):
 yes=False;j=len(ring)-1
 for i in range(len(ring)):
  xi,yi=ring[i][:2];xj,yj=ring[j][:2]
  if ((yi>y)!=(yj>y)) and (x<(xj-xi)*(y-yi)/(yj-yi)+xi):yes=not yes
  j=i
 return yes
count=0
for e in data['entries']:
 if e['city'] and e['department']:continue
 x=e['coordinates']['lon'];y=e['coordinates']['lat']
 if x is None or y is None:continue
 matches=[]
 for idx in grid.get((math.floor(x*10),math.floor(y*10)),[]):
  box,polygon,props,url=polys[idx]
  if box[0]<=x<=box[2] and box[1]<=y<=box[3] and inside(x,y,polygon[0]) and not any(inside(x,y,h) for h in polygon[1:]):matches.append((props,url))
 if len(matches)==1:
  p,url=matches[0];e['city']=e['city'] or p['nom'];e['department']=e['department'] or p['codeDepartement'];e['communeSource']=url;e['communeMethod']='Commune déterminée par inclusion du point OpenStreetMap dans le contour administratif ; adresse postale non déduite.';count+=1
data['administrativeEnrichment']={'source':'API découpage administratif geo.api.gouv.fr','license':'Licence Ouverte 2.0','method':'Point dans polygone communal','count':count}
(root/'partners-osm-data.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('FINISHED',count,'communes enriched')
