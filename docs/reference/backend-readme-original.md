<!-- Historical upstream documentation; relative links and deployment descriptions are preserved as originally received, not current Orbit setup instructions. -->

# Social Cosmos FastAPI backend

当前前后端、记忆、行为、评分与每小时模拟的真实闭环文档：
[`docs/backend-runtime-closed-loop.zh-CN.md`](../docs/backend-runtime-closed-loop.zh-CN.md)。

完整中文技术、算法、数据模型和 API 文档见
[`docs/backend-implementation-guide.md`](../docs/backend-implementation-guide.md)。

Local development uses SQLite and creates its schema automatically:

```powershell
npm run dev:api
npm run check:api
```

The backend remains one FastAPI service, but its code is split by dependency
direction:

```text
api/routes -> application -> domain / ports
main.py -> infrastructure adapters
workers -> application
```

`main.py` is the composition root, `app/api` owns HTTP adaptation,
`app/application` owns use cases, and `app/domain` owns deterministic policies
and algorithms. `app/services.py` is a compatibility facade only. Application
modules are guarded by tests from importing FastAPI.

Production uses PostgreSQL as the source of truth. Apply Alembic migrations
before starting the API; PostgreSQL schema creation is intentionally not done
by application startup:

```powershell
$env:SOCIAL_COSMOS_DATABASE_URL = "postgresql+psycopg://social_cosmos:password@localhost:5432/social_cosmos"
npm run db:upgrade
npm run db:check
```

Set `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and optionally
`NEO4J_DATABASE` to enable Neo4j projection. Profile writes commit to
PostgreSQL together with a graph outbox entry before projection is attempted.
Failed projection entries remain retryable and are visible from `/api/health`.
Run a one-shot retry with `npm run outbox:drain`. In production, run the
worker continuously next to the API so recovered Neo4j projections do not
depend on an API restart or a later profile write:

```powershell
Set-Location backend
python -m app.outbox_worker --database-url $env:SOCIAL_COSMOS_DATABASE_URL
```

The teammate-owned memory Agent is embedded inside FastAPI through
`create_app(memory_agent=...)`; it is never run by the frontend. FastAPI loads
the user's stored memory context, validates Agent output as `MemoryObject`, and
then recomputes `mass.v2`, objective `profile-affinity.v1`, verified `semantic-evidence.v1`, `relationship.v4`,
distance, and layout from profile facts, behavior, and all relevant memories.
`LocalMemoryAgent` is only a deterministic development fallback. The current
relationship algorithm is documented in
[`docs/objective-affinity-and-distance.zh-CN.md`](../docs/objective-affinity-and-distance.zh-CN.md).

The universe uses hourly simulation ticks. Meaningful self actions and actions
from other users targeting the current user are stored in
`user_behavior_events` and decay over time. Run one tick or the continuous
worker with:

```powershell
npm run simulation:tick
npm run simulation:worker
```

Life signals are persisted in `activity_posts`. `POST /api/activity-media`
accepts optional image/audio media and `POST /api/activities` stores the post,
generates or validates its planet ecosystem effect, records an
`activity_published` behavior event, and returns the recomputed Cosmos. The
current migration chain is linear from `20260723_0001` through
`20260724_0012`; the final revision adds the Nebula community graph after the
Agent, affinity, activity, conversation, job-audit, and metrics revisions.

Media storage is replaceable through `app.ports.media_storage.MediaStorage`:

```python
app = create_app(media_storage=MyObjectStorage())
```

The default `LocalMediaStorage` writes to `backend/data/uploads`. A cloud
adapter can replace it without changing activity routes or frontend contracts.
