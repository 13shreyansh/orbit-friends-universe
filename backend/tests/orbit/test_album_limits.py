from .test_albums import api, FakeAI, PNG, group, auth
from sqlalchemy import select, func
from app.db import MemoryRow

def test_thirty_six_photos_preview_and_confirm(api):
    client,database=api
    FakeAI.payload={'groups':[group(list(range(i*6,(i+1)*6)),name=f'Memory chapter {i+1}') for i in range(6)]}
    result=client.post('/api/orbit/albums/preview',data={'name':'Thirty six moments'},files=[('files',(f'photo-{i}.png',PNG,'image/png')) for i in range(36)])
    assert result.status_code==200,result.text
    payload=result.json()
    assert len(payload['album']['photos'])==36
    assert len(payload['album']['groups'])==6
    confirmed=client.post('/api/orbit/albums/'+payload['album']['id']+'/confirm',headers=auth(payload))
    assert confirmed.status_code==200,confirmed.text
    assert len(confirmed.json()['cosmos']['friendPlanets'])==6
    with database.session() as db:
        assert db.scalar(select(func.count()).select_from(MemoryRow).where(MemoryRow.owner_user_id==payload['session']['userId']))==36

def test_thirty_seven_photos_rejected_before_ai(api):
    client,_=api
    result=client.post('/api/orbit/albums/preview',data={'name':'Too many moments'},files=[('files',(f'photo-{i}.png',PNG,'image/png')) for i in range(37)])
    assert result.status_code==400,result.text
    assert FakeAI.calls==[]
