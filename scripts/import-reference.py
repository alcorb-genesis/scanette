import json, urllib.request, urllib.parse, time, pathlib, datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]
CACHE=pathlib.Path(__file__).resolve().parents[1]/'private-import'/'reference-cache'
CACHE.mkdir(exist_ok=True,parents=True)
departments=['64','40','16','17','19','23','24','33','47','79','86','87']
entries={}; reports=[]
def get(url):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Alcorb-Public-Directory/1.0 (reference research)'}),timeout=45) as r:return json.load(r)
        except Exception as e:
            if attempt==5:raise
            time.sleep(2**attempt+1)
def write():
    data={'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'API Recherche d’entreprises — données Sirene','license':'Licence Ouverte 2.0','scope':'Établissements actifs diffusibles de sociétés : garages de Nouvelle-Aquitaine, grossistes en pièces automobiles de France. Annuaire public non exhaustif, sans preuve de relation commerciale. Coordonnées inconnues non déduites.','queries':reports,'entries':sorted(entries.values(),key=lambda x:(0 if x['department'] in ['64','40'] else 1,x['city'],x['name'],x['siret']))}
    (ROOT/'partners-data.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
for kind,activity,deps in [('garage','45.20A',departments),('supplier','45.31Z',[''])]:
  for dep in deps:
    page=1;total=1;accepted=0
    while page<=total:
      params={'activite_principale':activity,'etat_administratif':'A','est_entrepreneur_individuel':'false','per_page':25,'page':page,'limite_matching_etablissements':100}
      if dep:params['departement']=dep
      else:params['region']='11,24,27,28,32,44,52,53,75,76,84,93,94,01,02,03,04,06'
      url='https://recherche-entreprises.api.gouv.fr/search?'+urllib.parse.urlencode(params)
      cache=CACHE/f'{kind}-{dep or "fr2"}-{page}.json'
      if cache.exists():payload=json.loads(cache.read_text(encoding='utf-8'))
      else:
        try:raw=get(url)
        except Exception as e:
          reports.append({'url':url,'error':str(e)}); print('FAILED',url,str(e),flush=True);break
        result=[]
        for c in raw.get('results',[]):
          if c.get('statut_diffusion')!='O' or c.get('nature_juridique')=='1000':continue
          for e in c.get('matching_etablissements',[]):
            if e.get('etat_administratif')!='A' or e.get('statut_diffusion_etablissement')!='O' or e.get('activite_principale')!=activity:continue
            d=(e.get('commune') or '')[:2]
            if dep and d!=dep:continue
            result.append({'siret':e['siret'],'name':c.get('nom_complet') or c.get('nom_raison_sociale'),'address':e.get('adresse') or '', 'city':e.get('libelle_commune') or '', 'postcode':e.get('code_postal') or '', 'department':d,'activity':activity,'kind':kind,'phone':None,'email':None,'source':url})
        payload={'total_pages':raw.get('total_pages',1),'total_results':raw.get('total_results'), 'entries':result}
        cache.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8');time.sleep(.6)
      total=min(int(payload['total_pages']),400)
      for e in payload['entries']:entries[e['siret']]=e;accepted+=1
      if page==1:reports.append({'kind':kind,'department':dep or 'France','totalResults':payload.get('total_results'),'pagesPlanned':total,'url':url})
      if page%10==0:write();print(kind,dep,page,'/',total,'unique',len(entries),flush=True)
      page+=1
    write();print('DONE',kind,dep,'unique',len(entries),flush=True)
print('FINISHED',len(entries),flush=True)
