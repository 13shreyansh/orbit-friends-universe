# Repository map

The source layout is preserved so existing imports, asset paths, tests, and Git history remain usable. Documentation is grouped under `docs/`; attribution and contribution guidance live at the root.

```text
README.md                     Product overview and starting points
ATTRIBUTION.md                Code lineage and media provenance
CONTRIBUTING.md               Verification and evidence conventions
docs/
  DEMO.md                     Reproducible public journey
  ARCHITECTURE.md             Runtime and data-flow explanation
  VISUAL_INTELLIGENCE.md      Model adapter and visual design account
  DEVELOPMENT.md              Installation, checks, deployment
  EVIDENCE.md                 Claims and dated verification
  LIMITATIONS.md             Boundaries and next steps
  evidence/                  Current manifests and audit artifacts
  reference/                 Preserved historical documentation
src/
  main.tsx                   Public transport installation and React entry
  FriendsDemo.tsx            Six-person entry experience
  AlbumImport.tsx            Unmounted album-import component
  VisitTogether.tsx          Unmounted shared-visit component
  demo/                      Static API transport and curated pair stories
  product/                   Product phases, API client, and state
  modules/universe/          Universe interaction and scene coordination
  modules/memory-book/       Diary rendering and memory-to-page conversion
  modules/planet/            Planet presentation and authored-world library
  components/cosmos/         Scene components, vehicles, and effects
  services/                  Client service adapters
  types/                     Shared frontend data contracts
backend/
  app/orbit_albums.py        Image grouping and album confirmation
  app/orbit_visits.py        Shared visit endpoints
  app/orbit_visit_models.py  Visit persistence models
  app/main.py                Service composition and router registration
  app/api/                   HTTP routes and dependencies
  app/application/           Use cases and serialization
  app/domain/                Scoring, layout, and deterministic policies
  app/ports/                 Infrastructure contracts
  app/infrastructure/        External-service adapters
  tests/orbit/               Orbit album, limits, and shared-visit tests
  tests/                     Inherited backend tests
  migrations/                Existing migration history
public/
  demo-data/                 Six synthetic Friends fixtures
  friends/                   Reference photos, album index, provenance
  friends-pairs/             Additional pair-specific photos and provenance
  models/                    Two checked-in GLB assets
  media/                     Universe background video
scripts/                     Development, verification, and inherited tools
.github/workflows/           GitHub Pages build and deployment
```

## Reading order for implementation review

Read `main.tsx` and `demo/publicDemoTransport.ts` before tracing API calls: they explain why the hosted frontend does not call the backend. Then follow `FriendsDemo`, `ProductApp`, `UniverseExperience`, and the memory book. For the import prototype, begin directly with `orbit_albums.py` and `tests/orbit/test_albums.py`.

The inherited persona, workers, simulation, graph, ingestion, and memory-analysis systems support a broader application. Their presence should not be read as an assertion that they are all configured in the public deployment. Some package scripts reference end-to-end tests or configuration absent from this snapshot. The supported audit commands are listed in [Development](DEVELOPMENT.md).

The authored-world library contains paths beyond the two GLBs checked into `public/models`. Do not assume every dormant scene option is packaged merely because its name appears in source.

`prepare-public-fixtures-reference.py` is retained as historical export code. Its original root-path calculation is not suitable for direct execution from this layout; the committed public fixtures are the demo baseline. A future fixture-regeneration change should correct and test that script in isolation before replacing the existing JSON files.
