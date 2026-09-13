import asyncio
import base64
import json
import os
import subprocess
from pathlib import Path

# Do not import app.main: that module creates its production/default application.


import pytest
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app import orbit_albums as album
from app.db import Database, MemoryRow, UserRow, PlanetRow, RelationshipRow, MemoryRevisionRow, NebulaRow
from app.schemas.memory import MemoryObject

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=')

def group(indexes, name='Shared coffee', description='Friends share coffee around a table.'):
    return {'name':name,'description':description,'indexes':indexes,'archetype':'terran','keywords':['coffee','gathering']}

class FakeAI:
    payload={'groups':[group([0,1]),group([2,3],'Park afternoon','Friends spend an afternoon in a park.')]}
    calls=[]
    def __init__(self,*args,**kwargs):pass
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def post(self,url,**kwargs):
        self.calls.append((url,kwargs))
        return httpx.Response(200,json={'output':[{'content':[{'type':'output_text','text':json.dumps(self.payload)}]}]},request=httpx.Request('POST',url))

@pytest.fixture
def api(tmp_path,monkeypatch):
    uploads=tmp_path/'uploads'
    uploads.mkdir()
    monkeypatch.setattr(album,'UPLOADS',uploads/'albums')
    monkeypatch.setattr(album.httpx,'AsyncClient',FakeAI)
    FakeAI.payload={'groups':[group([0,1]),group([2,3],'Park afternoon','Friends spend an afternoon in a park.')]}
    FakeAI.calls=[]
    database=Database('sqlite:///'+str(tmp_path/'review.db'))
    database.create_schema()
    app=FastAPI()
    app.state.database=database
    app.include_router(album.router)
    app.mount('/uploads',StaticFiles(directory=uploads))
    with TestClient(app,raise_server_exceptions=False) as client:
        yield client,database
    database.engine.dispose()

def preview(client,name='Our album'):
    return client.post('/api/orbit/albums/preview',data={'name':name},files=[('files',(f'photo-{i}.png',PNG,'image/png')) for i in range(4)])

def auth(payload):return {'Authorization':'Bearer '+payload['session']['token']}

@pytest.mark.parametrize('indexes',[[[0],[1]],[[1],[0]],[[0,1]]])
def test_grouping_accepts_each_photo_exactly_once(indexes,monkeypatch):
    monkeypatch.setattr(album.httpx,'AsyncClient',FakeAI)
    FakeAI.payload={'groups':[group(x) for x in indexes]}
    photos=[{'name':str(i),'raw':PNG,'mime':'image/png'} for i in range(2)]
    result=asyncio.run(album.group_photos(photos,'Album'))
    assert sorted(i for g in result for i in g['indexes'])==[0,1]

@pytest.mark.parametrize('indexes',[[[0],[0]],[[0]],[[0],[2]],[[0],[-1]],[[0,1],[1]]])
def test_grouping_rejects_duplicate_missing_or_out_of_range(indexes,monkeypatch):
    monkeypatch.setattr(album.httpx,'AsyncClient',FakeAI)
    FakeAI.payload={'groups':[group(x) for x in indexes]}
    photos=[{'name':str(i),'raw':PNG,'mime':'image/png'} for i in range(2)]
    with pytest.raises(HTTPException) as error:asyncio.run(album.group_photos(photos,'Album'))
    assert error.value.status_code==502

@pytest.mark.parametrize('url',['http://drive.google.com/drive/folders/abc','https://photos.google.com/share/abc','http://127.0.0.1/private','https://drive.google.com.evil.example/folders/abc','file:///private/etc/passwd','https://example.com/folders/abc','https://drive.google.com/file/d/abc/view'])
def test_unsupported_urls_rejected_before_network(url,monkeypatch):
    def fail(*args,**kwargs):raise AssertionError('Network client must not be created')
    monkeypatch.setattr(album.httpx,'AsyncClient',fail)
    with pytest.raises(HTTPException) as error:asyncio.run(album.drive_photos(url))
    assert error.value.status_code==400

def test_private_drive_folder_rejected(monkeypatch):
    class PrivateFolder:
        def __init__(self,*args,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,url,**kwargs):return httpx.Response(200,text='<html>Sign in to request access</html>',request=httpx.Request('GET',url))
    monkeypatch.setattr(album.httpx,'AsyncClient',PrivateFolder)
    with pytest.raises(HTTPException) as error:asyncio.run(album.drive_photos('https://drive.google.com/drive/folders/private123'))
    assert error.value.status_code==400

def test_confirm_requires_matching_owner_token(api):
    client,database=api
    first=preview(client).json()
    other=preview(client).json()
    path='/api/orbit/albums/'+first['album']['id']+'/confirm'
    assert client.post(path).status_code==401
    assert client.post(path,headers={'Authorization':'Bearer fabricated'}).status_code==401
    assert client.post(path,headers=auth(other)).status_code==404
    with database.session() as db:
        assert db.get(album.AlbumRow,first['album']['id']).status=='preview'
    assert client.post(path,headers=auth(first)).status_code==200

def test_confirm_idempotent_and_photos_survive_to_memory_media(api):
    client,database=api
    pre=preview(client)
    assert pre.status_code==200,pre.text
    payload=pre.json();album_id=payload['album']['id'];path='/api/orbit/albums/'+album_id+'/confirm'
    first=client.post(path,headers=auth(payload));assert first.status_code==200,first.text
    def counts():
        with database.session() as db:
            return {table.__name__:db.scalar(select(func.count()).select_from(table)) for table in [UserRow,PlanetRow,RelationshipRow,MemoryRow,MemoryRevisionRow,NebulaRow]}
    before=counts()
    second=client.post(path,headers=auth(payload));assert second.status_code==200,second.text
    assert counts()==before
    assert second.json()['album']==first.json()['album']
    photos=payload['album']['photos']
    with database.session() as db:
        rows=list(db.scalars(select(MemoryRow).where(MemoryRow.owner_user_id==payload['session']['userId'])))
        assert len(rows)==4
        for row in rows:
            memory=MemoryObject.model_validate(json.loads(row.memory_json))
            photo=next(p for p in photos if p['url']==memory.media_url)
            assert len(memory.media)==1
            assert memory.media[0].url==photo['url']
            assert memory.media[0].name==photo['name']
            assert memory.media[0].mime_type=='image/png'
            assert memory.media[0].size==len(PNG)
            result=client.get(photo['url']);assert result.status_code==200
            assert result.content==PNG

def test_one_character_album_name_can_be_confirmed_or_is_rejected_at_preview(api):
    client,_=api
    pre=preview(client,name='A')
    if pre.status_code>=400:return
    payload=pre.json()
    result=client.post('/api/orbit/albums/'+payload['album']['id']+'/confirm',headers=auth(payload))
    assert result.status_code==200,f'Preview accepted name but confirm returned {result.status_code}: {result.text}'

@pytest.mark.parametrize('bad_group',[group([0,1],'X'),group([0,1],description='')])
def test_malformed_ai_strings_rejected_before_persisting_preview(api,bad_group):
    client,_=api
    FakeAI.payload={'groups':[bad_group,group([2,3],'Park afternoon')]}
    pre=preview(client)
    if pre.status_code>=400:return
    payload=pre.json()
    result=client.post('/api/orbit/albums/'+payload['album']['id']+'/confirm',headers=auth(payload))
    assert result.status_code==200,f'Invalid generated text persisted by preview and confirm failed {result.status_code}: {result.text}'

def test_unsupported_image_rejected(api):
    client,_=api
    result=client.post('/api/orbit/albums/preview',data={'name':'Album'},files=[('files',('fake.svg',b'<svg/>','image/svg+xml'))])
    assert result.status_code==400

def test_original_domain_files_match_git_index():
    repo=Path(__file__).resolve().parents[3]
    paths=subprocess.check_output(['git','ls-files','backend/app/domain'],cwd=repo,text=True).splitlines()
    assert paths
    changed=[]
    for path in paths:
        original=subprocess.check_output(['git','show',':'+path],cwd=repo)
        if original!=(repo/path).read_bytes():changed.append(path)
    assert not changed,'Original domain files modified: '+', '.join(changed)
