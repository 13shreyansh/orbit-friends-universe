"""Shared planet/page visits with original, explicitly read-only guest sessions."""
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from app.api.dependencies import current_user, db_session
from app.application.universe import get_cosmos
from app.db import UserRow
from app.security import create_session
from app.orbit_visit_models import OrbitVisitRow, OrbitVisitorRow, OrbitReadOnlySessionRow

router = APIRouter()

def now(): return datetime.now(timezone.utc)
def aware(value): return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value

def room(db, visit_id):
    value = db.get(OrbitVisitRow, visit_id)
    if not value: raise HTTPException(404, 'Visit unavailable.')
    if aware(value.expires_at) <= now(): raise HTTPException(410, 'This visit has expired. Ask the host for a new invitation.')
    return value

def participant(db, visit_id, token):
    value = db.scalar(select(OrbitVisitorRow).where(OrbitVisitorRow.visit_id == visit_id, OrbitVisitorRow.token_hash == hashlib.sha256(token.encode()).hexdigest()))
    if not value: raise HTTPException(403, 'Visitor token is not valid for this visit.')
    return value

def add_participant(db, visit_id, name):
    token = secrets.token_urlsafe(32)
    value = OrbitVisitorRow(id=secrets.token_urlsafe(12), visit_id=visit_id, token_hash=hashlib.sha256(token.encode()).hexdigest(), name=name, seen_at=now())
    db.add(value); db.flush()
    return value, token

def snapshot(db, value):
    people = db.scalars(select(OrbitVisitorRow).where(OrbitVisitorRow.visit_id == value.id, OrbitVisitorRow.seen_at > now()-timedelta(seconds=60)).order_by(OrbitVisitorRow.seen_at, OrbitVisitorRow.id))
    return {'id':value.id, 'planetId':value.planet_id, 'page':value.page, 'revision':value.revision, 'expiresAt':aware(value.expires_at).isoformat(), 'participants':[{'id':p.id,'name':p.name} for p in people]}

def public_origin(request):
    configured = os.getenv('ORBIT_PUBLIC_ORIGIN', '').rstrip('/')
    if configured: return configured
    origin = request.headers.get('origin', '').rstrip('/')
    parsed = urlparse(origin)
    if parsed.scheme in ('http','https') and parsed.hostname and parsed.hostname not in ('localhost','127.0.0.1','::1'):
        return origin
    return 'http://192.168.0.30:5174'

class VisitorName(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=80)

class VisitorToken(BaseModel):
    model_config = ConfigDict(extra='forbid')
    visitorToken: str = Field(min_length=1, max_length=160)

class VisitState(VisitorToken):
    planetId: str | None = Field(default=None, min_length=1, max_length=80)
    page: int | None = Field(default=None, ge=0, le=1000000, strict=True)

@router.post('/api/orbit/visits')
def create_visit(body: VisitorName, request: Request, db: Session=Depends(db_session), user: UserRow=Depends(current_user)):
    if not user.id.startswith(('album-owner-','friends-')): raise HTTPException(403,'Visits are available for album and Friends universes.')
    if not user.planet_id: raise HTTPException(409,'Create your universe before inviting visitors.')
    value = OrbitVisitRow(id=secrets.token_urlsafe(24), owner_id=user.id, planet_id=user.planet_id, page=0, revision=0, expires_at=now()+timedelta(hours=24), updated_at=now())
    db.add(value); db.flush()
    person, token = add_participant(db,value.id,body.name)
    return {**snapshot(db,value),'visitorToken':token,'participantId':person.id,'shareUrl':public_origin(request)+'/?visit='+value.id}

@router.post('/api/orbit/visits/{visit_id}/join')
def join_visit(visit_id: str, body: VisitorName, request: Request, db: Session=Depends(db_session)):
    value=room(db,visit_id)
    owner=db.get(UserRow,value.owner_id)
    if not owner or owner.deleted_at is not None: raise HTTPException(404,'Visit unavailable.')
    person,token=add_participant(db,visit_id,body.name)
    session=create_session(db,owner.id)
    session.expires_at=aware(value.expires_at)
    db.add(OrbitReadOnlySessionRow(token=session.token,visit_id=visit_id)); db.flush()
    return {**snapshot(db,value),'visitorToken':token,'participantId':person.id,'shareUrl':public_origin(request)+'/?visit='+value.id,'session':{'userId':owner.id,'token':session.token,'readOnly':True},'cosmos':get_cosmos(db,owner)}

@router.get('/api/orbit/visits/{visit_id}')
def get_visit(visit_id: str, db: Session=Depends(db_session)):
    return snapshot(db,room(db,visit_id))

@router.post('/api/orbit/visits/{visit_id}/state')
def set_visit(visit_id: str, body: VisitState, db: Session=Depends(db_session)):
    value=room(db,visit_id); person=participant(db,visit_id,body.visitorToken)
    changes={}
    if body.planetId is not None:
        owner=db.get(UserRow,value.owner_id)
        if not owner or owner.deleted_at is not None: raise HTTPException(404,'Visit unavailable.')
        cosmos=get_cosmos(db,owner)
        planets=[cosmos.get('selfPlanet'),*cosmos.get('friendPlanets',[]),*cosmos.get('samplePlanets',[])]
        if body.planetId not in {p['id'] for p in planets if p}: raise HTTPException(400,'This planet is not part of the shared universe.')
        changes['planet_id']=body.planetId
        if body.planetId != value.planet_id: changes['page']=0
    if body.page is not None: changes['page']=body.page
    person.seen_at=now()
    if changes:
        changes.update(revision=OrbitVisitRow.revision+1,updated_at=now())
        db.execute(update(OrbitVisitRow).where(OrbitVisitRow.id==visit_id).values(**changes))
        db.flush(); db.refresh(value)
    return snapshot(db,value)

@router.post('/api/orbit/visits/{visit_id}/heartbeat')
def heartbeat(visit_id: str, body: VisitorToken, db: Session=Depends(db_session)):
    value=room(db,visit_id); person=participant(db,visit_id,body.visitorToken)
    person.seen_at=now(); db.flush()
    return snapshot(db,value)
