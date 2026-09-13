from datetime import timedelta
from sqlalchemy import select
from .test_albums import api, preview, auth
from app.orbit_visits import router, now
from app.orbit_visit_models import OrbitVisitRow, OrbitVisitorRow
from app.api.routes.auth import router as auth_router
from app.api.routes.profile import router as profile_router
from app.api.routes.social import router as social_router
from app.api.routes.direct_chat import router as chat_router
from app.api.routes.memories import router as memories_router
from app.api.routes.memory_signals import router as memory_signals_router
from app.infrastructure.semantic_similarity import LocalSemanticSimilarity

def setup(api):
    client,database=api
    client.app.include_router(router)
    client.app.include_router(auth_router)
    client.app.include_router(profile_router)
    client.app.include_router(social_router)
    client.app.include_router(chat_router)
    client.app.include_router(memories_router)
    client.app.include_router(memory_signals_router)
    client.app.state.semantic_similarity=LocalSemanticSimilarity()
    album=preview(client).json()
    confirmed=client.post('/api/orbit/albums/'+album['album']['id']+'/confirm',headers=auth(album))
    assert confirmed.status_code==200,confirmed.text
    result=client.post('/api/orbit/visits',headers=auth(album),json={'name':'Host'})
    assert result.status_code==200,result.text
    return client,database,album,confirmed.json()['cosmos'],result.json()

def test_two_guest_clients_share_state_and_readonly_sessions(api):
    client,database,album,cosmos,visit=setup(api)
    path='/api/orbit/visits/'+visit['id']
    assert visit['page']==visit['revision']==0
    assert visit['planetId']==cosmos['selfPlanet']['id']
    assert visit['shareUrl']=='http://192.168.0.30:5174/?visit='+visit['id']
    a=client.post(path+'/join',headers={'Origin':'http://localhost:5174'},json={'name':'Rachel'});assert a.status_code==200,a.text
    b=client.post(path+'/join',json={'name':'Chandler'});assert b.status_code==200,b.text
    a=a.json();b=b.json()
    assert a['shareUrl']==visit['shareUrl']
    assert a['visitorToken']!=b['visitorToken']
    assert a['session']['token']!=b['session']['token']
    assert a['session']['readOnly'] and b['session']['readOnly']
    assert client.get('/api/cosmos',headers=auth(a)).status_code==200
    assert client.get('/api/v1/memories',headers=auth(a)).status_code==200
    assert client.get('/api/v1/memory-signals',headers=auth(a)).status_code==200
    planet=cosmos['friendPlanets'][0]['id']
    changed=client.post(path+'/state',headers=auth(a),json={'visitorToken':a['visitorToken'],'planetId':planet,'page':2})
    assert changed.status_code==200,changed.text
    state=client.get(path,headers=auth(b)).json()
    assert (state['planetId'],state['page'],state['revision'])==(planet,2,1)
    assert {p['name'] for p in state['participants']}=={'Host','Rachel','Chandler'}
    changed=client.post(path+'/state',headers=auth(b),json={'visitorToken':b['visitorToken'],'page':4})
    assert changed.status_code==200,changed.text
    assert client.get(path).json()['page']==4
    assert client.get(path).json()['revision']==2
    assert client.post(path+'/state',json={'visitorToken':'forged','page':0}).status_code==403
    assert client.post(path+'/state',json={'visitorToken':a['visitorToken'],'planetId':'not-owned'}).status_code==400
    assert client.post(path+'/state',json={'visitorToken':a['visitorToken'],'page':-1}).status_code==422
    assert client.post(path+'/state',json={'visitorToken':a['visitorToken'],'page':True}).status_code==422
    assert client.post('/api/orbit/visits',headers=auth(a),json={'name':'Clone room'}).status_code==403
    assert client.post('/api/orbit/albums/preview',headers=auth(a),data={'name':'Guest write'}).status_code==403
    assert client.post('/api/relationships',headers=auth(a),json={'targetUserId':'x','relationType':'friend','identityLabel':'Friend','description':'Change'}).status_code==403
    assert client.get('/api/v1/chat/conversations',headers=auth(a)).status_code==403
    assert client.get('/api/v1/users/me/intake',headers=auth(a)).status_code==200
    assert client.put('/api/v1/users/me/intake',headers=auth(a),json={}).status_code==403
    assert client.post('/api/v1/memory-signals/unknown/read',headers=auth(a)).status_code==403
    assert client.post('/api/auth/signin',headers=auth(a),json={'email':'test@example.test','password':'Password123!'}).status_code==403
    assert client.post('/api/auth/signout',headers=auth(a)).status_code==200
    assert client.get('/api/cosmos',headers=auth(a)).status_code==401

def test_room_and_presence_expiry_and_cross_room_tokens(api):
    client,database,album,cosmos,visit=setup(api)
    path='/api/orbit/visits/'+visit['id']
    guest=client.post(path+'/join',json={'name':'Guest'}).json()
    second=client.post('/api/orbit/visits',headers=auth(album),json={'name':'Host two'}).json()
    assert client.post('/api/orbit/visits/'+second['id']+'/heartbeat',json={'visitorToken':guest['visitorToken']}).status_code==403
    with database.session() as db:
        participant=db.scalar(select(OrbitVisitorRow).where(OrbitVisitorRow.id==guest['participantId']))
        participant.seen_at=now()-timedelta(seconds=61)
    assert 'Guest' not in {p['name'] for p in client.get(path).json()['participants']}
    assert client.post(path+'/heartbeat',json={'visitorToken':guest['visitorToken']}).status_code==200
    assert 'Guest' in {p['name'] for p in client.get(path).json()['participants']}
    with database.session() as db:db.get(OrbitVisitRow,visit['id']).expires_at=now()-timedelta(seconds=1)
    assert client.get(path).status_code==410
    assert client.post(path+'/join',json={'name':'Too late'}).status_code==410
    assert client.get('/api/cosmos',headers=auth(guest)).status_code==403
