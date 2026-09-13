"""Build public fixtures solely from synthetic Friends seeds in a NEW isolated DB.
Never opens the live app DB, never signs in, never loads environment files or secrets.
"""
import os,sys,json,tempfile
from pathlib import Path
root=Path(__file__).parent/'orbit-friends-universe'
sys.path.insert(0,str(root/'backend'))
fd,dbfile=tempfile.mkstemp(prefix='orbit-public-fixture-',suffix='.db');os.close(fd)
os.environ['SOCIAL_COSMOS_DATABASE_URL']='sqlite:///'+dbfile
os.environ['NEO4J_URI']=''
os.environ['OPENVIKING_AI_PROVIDER']='local'
from app.seed_friends import seed_friends,PEOPLE
from app.db import Database,UserRow
from app.application.universe import get_cosmos,get_universe_window
from app.application.serialization import loads
seed_friends()
out=root/'public'/'demo-data';out.mkdir(exist_ok=True)
with Database().session() as db:
 for key,name,bio,interest,archetype in PEOPLE:
  user=db.get(UserRow,'friends-'+key)
  cosmos=get_cosmos(db,user)
  assert cosmos['profile']['id']=='friends-'+key
  assert all(p['ownerId'].startswith('friends-') for p in cosmos['friendPlanets'])
  cosmos['profile']={'id':'friends-'+key,'displayName':name,'bio':bio,'tags':[],'planetId':user.planet_id,'email':'','emailVerified':True}
  cosmos['session']={'userId':'friends-'+key,'token':'public-fictional-demo-'+key}
  for field in ['memories','timeline','activities','memorySignals']:cosmos[field]=[]
  window=get_universe_window(db,user,limit=24);window['activities']=[]
  data={'cosmos':cosmos,'snapshot':window['snapshot'],'window':window,'intake':{'displayName':name,'bio':bio,'interests':[]}}
  (out/(key+'.json')).write_text(json.dumps(data,default=lambda v:v.model_dump(mode="json",by_alias=True) if hasattr(v,"model_dump") else str(v)))
  print(key,len(window['snapshot'].nodes))
print('Only fresh synthetic Friends fixtures exported; no live user data accessed.')
