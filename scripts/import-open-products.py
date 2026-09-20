import urllib.request,gzip,json,pathlib,datetime,re
out=pathlib.Path(__file__).resolve().parents[1]/'products-open-data.json'
url='https://static.openproductsfacts.org/data/openproductsfacts-products.jsonl.gz'
selected={};examined=0
def valid(code):
 return code.isdigit() and len(code) in [8,12,13,14] and sum(int(c)*(3 if i%2==0 else 1) for i,c in enumerate(code[-2::-1]))%10 == (-int(code[-1]))%10
automotive=re.compile(r'\b(car-parts|automotive|motor-oils|engine-oils|motor-vehicle|windshield|windscreen|brake-fluid|coolants|car-care|car-batteries|car-tires|car-tyres|car-accessories|huile-moteur|huiles-moteur|lave-glace|liquide-de-frein|liquides-de-frein|essuie-glace|essuie-glaces|liquide-de-refroidissement)\b',re.I)
with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Alcorb-Reference-Research/1.0'}),timeout=120) as response:
 with gzip.GzipFile(fileobj=response) as stream:
  for line in stream:
   p=json.loads(line);examined+=1
   evidence=' '.join(p.get('categories_tags',[]))+' '+str(p.get('categories',''))
   specific=re.search(r'\b(purflux|misfat|febi|brembo|mann-filter|delphi|valeo|ngk|hankook|goodyear|bridgestone|castrol|motul|liqui moly|wynn.s)\b',str(p.get('brands','')),re.I)
   named=re.search(r'\b(huile moteur|huiles moteur|filtre à (huile|air|gazole|carburant)|filtre habitacle|essuie.glace|lave.glace|liquide de frein|motor oil|engine oil|brake fluid|spark plug|oil filter|windshield washer|car battery|pneu voiture)\b',str(p.get('product_name_fr',''))+' '+str(p.get('product_name',''))+' '+str(p.get('product_name_en','')),re.I)
   if automotive.search(evidence) or specific or named:
    code=str(p.get('code','')); name=p.get('product_name_fr') or p.get('product_name') or p.get('product_name_en')
    if valid(code) and name and code not in {'8056269636179'}: # Goodyear branded footwear is not an automotive part.
     selected[code]={'gtin':code,'name':name,'brand':p.get('brands',''),'category':p.get('categories',''),'quantity':p.get('quantity',''),'manufacturerReference':None,'source':'https://world.openproductsfacts.org/product/'+code,'quality':'Donnée collaborative non certifiée par le fabricant'}
   if examined%50000==0:print(examined,'examined',len(selected),'automotive',flush=True)
data={'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':url,'license':'ODbL 1.0','licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/','attribution':'Open Products Facts contributors','scope':'Sous-ensemble automobile identifié par les catégories déclarées. GTIN à clé valide. Aucun prix, stock ou compatibilité véhicule présumé.','examined':examined,'entries':sorted(selected.values(),key=lambda p:(p['brand'],p['name']))}
out.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('FINISHED',examined,len(selected),flush=True)
