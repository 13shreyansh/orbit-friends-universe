"""Friends fan-demo data, passed through Distance's unmodified graph services.

Dates are the fictional episode era; the production scoring clock is unchanged.
This is curated demo context, not identities inferred from the photographs.
"""
from datetime import date
from pathlib import Path
import json
from sqlalchemy import select
from app.db import Database, UserRow, MemoryRow, PlanetRow, NebulaRow
from app.security import hash_password
from app.schemas.profile import ProfileIntake
from app.schemas.memory import MemoryObject
from app.schemas.relationship import RelationshipRequest
from app.application.profile import upsert_intake, default_visual
from app.application.relationship import upsert_relationship
from app.application.memory_revision import persist_confirmed_memory
from app.application.universe import get_cosmos
from app.application.nebula import create_nebula, join_nebula
from app.application.serialization import dumps, loads

PEOPLE = [
    ('monica', 'Monica Geller', 'Chef. The host who made a purple apartment feel like home.', 'Cooking', 'terran'),
    ('rachel', 'Rachel Green', 'Fashion, fresh starts, and the people who became family.', 'Fashion', 'verdant'),
    ('chandler', 'Chandler Bing', 'A joke for every occasion. A home with Monica.', 'Comedy', 'crystalline'),
    ('joey', 'Joey Tribbiani', 'Actor, loyal friend, and a seat saved at Central Perk.', 'Acting', 'volcanic'),
    ('phoebe', 'Phoebe Buffay', 'Songs, strange stories, and a wonderfully different way of seeing life.', 'Music', 'oceanic'),
    ('ross', 'Ross Geller', 'Paleontology, family, and a lifetime of shared stories.', 'Paleontology', 'terran'),
]
MOMENTS = [
    ('coffee', 'The one with the photographs', 'Central Perk', '2004-03-01', 'central-perk-photo-sharing.jpg', ['monica','rachel','chandler','joey','phoebe','ross'], 'We gather on the orange couch at Central Perk, passing photographs around and remembering our years together.'),
    ('home', 'The place we called home', "Monica’s apartment", '2004-05-06', 'apartment-group-hug.jpg', ['monica','rachel','chandler','joey','phoebe','ross'], 'We stand together in Monica’s purple apartment, holding each other before the next chapter begins.'),
    ('thanksgiving', 'One more Thanksgiving', "Monica’s apartment", '2001-11-22', 'thanksgiving-table.jpg', ['monica','rachel','chandler','joey','phoebe','ross'], 'We share Thanksgiving dinner around the table. Monica cooks, everyone talks, and the apartment fills with laughter.'),
    ('holiday', 'The holiday armadillo', "Monica’s apartment", '2000-12-14', 'holiday-armadillo.jpg', ['monica','chandler','ross'], 'Ross arrives dressed as the holiday armadillo, Chandler is Santa, and a family tradition becomes an unforgettable story.'),
    ('wedding', 'The one where they say yes', 'New York', '2001-05-17', 'monica-chandler-wedding-landscape.jpg', ['monica','chandler','rachel','joey','phoebe','ross'], 'Monica and Chandler get married, surrounded by the friends who have become their family.'),
    ('snow', 'A wedding in the snow', 'New York', '2004-02-12', 'phoebe-mike-wedding.jpg', ['phoebe','monica','rachel','chandler','joey','ross'], 'Phoebe and Mike marry outdoors in the falling snow, with friends bringing warmth to the winter night.'),
    ('fountain', 'The beginning of everything', 'The fountain', '1994-09-22', 'fountain-opening.jpg', ['monica','rachel','chandler','joey','phoebe','ross'], 'Six friends dance around a fountain with umbrellas. A playful beginning to a decade of shared memories.'),
    ('football', 'The one with the football', 'The park', '1996-11-21', 'thanksgiving-football.jpg', ['monica','rachel','chandler','joey','phoebe','ross'], 'A Thanksgiving football game brings out Monica and Ross’s sibling rivalry while all six friends play together.'),
    ('barbados', 'The one in Barbados', 'Barbados', '2003-05-15', 'barbados-hotel-arrival.jpg', ['monica','rachel','chandler','joey','phoebe','ross'], 'A trip to Barbados becomes a collection of hotel arrivals, conversations and fiercely competitive ping-pong.'),
]

COLLECTIONS = {
    'coffee':['central-perk-coffee.jpg','central-perk-laughter.jpg','central-perk-thirty.jpg','central-perk-girls.jpg','christmas-living-room.png'],
    'home':['apartment-poker.jpg','apartment-trivia.jpg','apartment-shopping-game.jpg','apartment-blackout.jpg','apartment-trivia-celebration.jpg'],
    'thanksgiving':['thanksgiving-kitchen-prep.jpg','thanksgiving-will-dinner.jpg','thanksgiving-trifle.jpg'],
    'holiday':[],
    'wedding':['wedding-monica-chandler-dancefloor.jpg','wedding-bridesmaids.jpg','wedding-monica-chandler-kiss.jpg'],
    'snow':['wedding-phoebe-aisle.jpg','wedding-phoebe-mike-ceremony.jpg'],
    'fountain':['fountain-cast-standing.jpg'],
    'football':['thanksgiving-football-scramble.jpg'],
    'barbados':['barbados-pingpong.jpg','barbados-laptop.jpg'],
}

def seed_friends():
    photo_root=Path(__file__).resolve().parents[2]/'public'/'friends'
    manifest=json.loads((photo_root/'album.json').read_text())
    captions={photo['file']:photo['caption'] for photo in manifest['photos']}
    database = Database()
    database.create_schema()
    with database.session() as db:
        users = {}
        for index, (key, name, bio, interest, archetype) in enumerate(PEOPLE):
            user = db.get(UserRow, 'friends-' + key)
            if not user:
                user = UserRow(id='friends-' + key, email=key+'@friends.local', password_hash=hash_password('friends-demo-only'), display_name=name, bio=bio, tags_json='[]')
                db.add(user)
                db.flush()
                profile = ProfileIntake.model_validate({
                    'display_name': name, 'bio': bio,
                    'residences': [{'place': {'name':'New York City','country_code':'US'}, 'period':{'start_date':'1994-01-01','is_current':True}}],
                    'interests':[{'name': interest}, {'name':'Central Perk'}, {'name':'Friends and family'}],
                    'skills':[{'name':interest,'proficiency':4}],
                    'projects':[{'title':'A life together in New York','description':bio,'collaborator_count':5}],
                })
                upsert_intake(db, user, profile, create_planet=True)
                planet = db.get(PlanetRow, user.planet_id)
                identity = loads(planet.identity_json,{})
                identity.update(name=name.split()[0], motto=bio)
                planet.identity_json=dumps(identity)
                visual=default_visual(seed=6100+index*311,archetype=archetype)
                visual['radius']=loads(planet.visual_json,{})['radius']
                planet.visual_json=dumps(visual)
            users[key]=user
        for key, owner in users.items():
            for other, target in users.items():
                if key == other: continue
                relation = 'family' if {key,other}=={'monica','ross'} else 'partner' if {key,other}=={'monica','chandler'} else 'friend'
                upsert_relationship(db,owner,RelationshipRequest(target_user_id=target.id,relation_type=relation,identity_label=relation.title(),description=f'{owner.display_name} and {target.display_name} share life in New York, meals at Monica’s apartment and afternoons at Central Perk.',started_at='1994-09-22'))
        for slug,title,place,day,filename,participants,narrative in MOMENTS:
            for key in participants:
                owner=users[key]
                memory_id=f'friends-{key}-{slug}'
                existing=db.get(MemoryRow,memory_id)
                url='/friends/'+filename
                photo_files=[filename,*COLLECTIONS.get(slug,[])]
                media=[{'type':'image','url':'/friends/'+photo,'mime_type':'image/png' if photo.endswith('.png') else 'image/jpeg','name':captions.get(photo,title),'size':(photo_root/photo).stat().st_size} for photo in photo_files]
                if existing:
                    previous=MemoryObject.model_validate(loads(existing.memory_json,{}))
                    if [item.model_dump() for item in previous.media] != media:
                        previous=MemoryObject.model_validate({**previous.model_dump(),'media':media})
                        persist_confirmed_memory(db,owner,previous,relationship_id=None,reason='friends_photo_collection',record_behavior=False)
                    continue
                memory=MemoryObject.model_validate({
                    'id':memory_id,'source_type':'text','raw_text':narrative,'media_url':url,
                    'media':media,
                    'people':[{'id':users[p].id,'name':users[p].display_name,'is_existing':True,'relation_type':'friend','identity_label':'Friend'} for p in participants if p!=key],
                    'event_time':day,'location':place,'event_type':'shared_activity','summary':title,
                    'facts':[narrative],'emotions':[{'name':'warmth','intensity':80}],
                    'relationship_signals':{'interaction_frequency':75,'emotional_intimacy':80,'initiative_balance':75,'relationship_change':'closer'},
                    'keywords':[place,'Friends',slug],'narrative':narrative,'confidence':1,
                    'analysis_provider':'curated-friends-demo',
                    'semantic_evidence':{'schema_version':'semantic-evidence.v1','interaction_type':'shared_activity','participation':'direct','direction':'mutual','evidence_spans':[narrative],'confidence':1},
                })
                persist_confirmed_memory(db,owner,memory,relationship_id=None,reason='friends_demo',record_behavior=True)
        existing=db.scalar(select(NebulaRow).where(NebulaRow.slug=='central-perk'))
        nebula_id=existing.id if existing else create_nebula(db,users['monica'],{'name':'Central Perk','slug':'central-perk','description':'Six friends. Ten years. A universe of shared memories.'})['id']
        for user in users.values():
            join_nebula(db,user,nebula_id)
            get_cosmos(db,user)
        print(f'Friends ready: {len(users)} people, {len(MOMENTS)} moments, Central Perk nebula {nebula_id}')

if __name__ == '__main__':
    seed_friends()
