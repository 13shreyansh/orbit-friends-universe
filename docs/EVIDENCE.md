# Evidence and verification

This ledger connects Orbit's claims to inspectable artifacts. The documentation audit was performed on **13 September 2026** against deployment baseline [`91be2ed813a269f2248a0cae3a3e03e0be665d62`](https://github.com/13shreyansh/orbit-friends-universe/commit/91be2ed813a269f2248a0cae3a3e03e0be665d62). The audit adds documentation, repairs verification scripts, and updates vulnerable npm dependencies. It does not backdate these additions into the original hackathon submission.

## Claim-to-evidence map

| Claim | Evidence | What the evidence establishes |
| --- | --- | --- |
| Six supported demo perspectives | [Public fixtures](../public/demo-data), [transport](../src/demo/publicDemoTransport.ts) | Explicit fictional identities and fixture responses |
| Fifteen distinct, symmetric pair stories | [Definitions](../src/demo/friendsStories.ts), [executable verifier](../scripts/verify-friends-stories.mjs) | Complete pair coverage, unique leads/collections, captions, existing assets |
| Confirmed photos survive book conversion | [Converter](../src/modules/memory-book/convertMemoryToPages.ts), [book verifier](../scripts/verify-photo-book.mjs) | Repeated confirmed media is de-duplicated; multi-photo collections are retained |
| Imported photos avoid invented capture dates | Same converter and book verifier | Import dates are suppressed for the tested imported-media cases |
| Real image bytes are sent by the album adapter | [group_photos implementation](../backend/app/orbit_albums.py) | Source constructs image inputs for the Responses API; not a receipt of a live request |
| Chapter coverage is validated | [Album tests](../backend/tests/orbit/test_albums.py) | Mocked valid and invalid partitions exercise application validation |
| Album confirmation preserves ownership and is idempotent | Same album tests | Missing/forged/other-owner sessions rejected; repeated confirmation preserves record counts |
| 36-photo import boundary | [Limit tests](../backend/tests/orbit/test_album_limits.py) | 36 photos confirm to memory records; 37 are rejected before the fake model is called |
| Shared-visit backend behavior | [Visit tests](../backend/tests/orbit/test_visits.py) | Shared state, distinct guest tokens, restrictions, expiry, cross-room rejection |
| GPT Image 2 informed diary and visual ideation | [Recorded team account](VISUAL_INTELLIGENCE.md#gpt-image-2-and-the-diary-design) | Attributed design-process statement; original generation records are not included |
| Reference photographs retain their source records | [Attribution](../ATTRIBUTION.md), [asset manifest](evidence/assets.json) | Current file identity and preserved provenance; not rights clearance |
| Website was deployed at the baseline | [Successful deployment run](https://github.com/13shreyansh/orbit-friends-universe/actions/runs/34746475887) | GitHub Pages deployment of baseline commit |

## Recorded checks

| Check | Audit result | Artifact |
| --- | --- | --- |
| Pair stories | Pass: all 15, both directions, three to eight photos, unique collections and first photos | [Frontend verification output](evidence/frontend-verification.txt) |
| Photo-book conversion | Pass: 31 indexed album assets, repeated-media/notes handling, six-photo collection, unknown imported dates | Same frontend output |
| Repository evidence | Pass: six fictional fixtures, 47 media hashes, current local documentation links | Same frontend output |
| TypeScript and production build | Pass; Vite reports a bundle-size warning | Same frontend output |
| Orbit backend suite | **27 passed**, two dependency deprecation warnings | [Orbit test output](evidence/backend-orbit-audit.txt) |
| Full inherited backend suite | **134 passed, 4 failed**, eight warnings | [Full audit output](evidence/backend-full-audit.txt) |
| npm dependency advisories before maintenance | Three: two moderate and one high | [Initial audit JSON](evidence/npm-audit-before.json) |
| npm dependency advisories after compatible patch updates | Zero reported at audit time | [Final audit JSON](evidence/npm-audit-after.json) |

Exact environment information is in [environment.txt](evidence/environment.txt). Python package versions are recorded because the backend requirements currently use ranges. The full and Orbit test logs preserve their output with local filesystem prefixes normalized to `<repository>` and `<home>`.

The book asset count of 31 refers to `public/friends/album.json`, not every image in the repository. The manifest's 47 files include all current public images plus two GLB models and one video. The checks cover different scopes deliberately.

## Four full-suite failures

One migration check detects four model tables absent from the inherited Alembic migration chain: `orbit_albums`, `orbit_visits`, `orbit_readonly_sessions`, and `orbit_visit_participants`, with associated indexes. SQLite application startup creates these tables, which is why the isolated Orbit API tests pass. This is a real migration gap for a deployment that relies on Alembic; it has not been concealed by changing the test or excluding it from the reported full-suite result.

Three persona-pipeline tests require the inherited `test/persona/generated/hk-5` fixture set, which is not included in this repository snapshot. The missing files include profiles, relationships, and scenarios. No replacement model output or historical persona data was invented to satisfy those tests.

These failures do not execute in the static GitHub Pages runtime. They remain relevant to anyone building a broader backend deployment and are listed in [Limitations](LIMITATIONS.md).

## Browser and deployment observations

During the audit, the live HTTPS site displayed the six-person entry screen. Entering as Ross loaded the universe with the five other friends. Selecting Monica displayed “Ross & Monica,” the “Siblings, rivalry and home” relationship, and a four-photograph preview. The continuation of this route is recorded in the [browser observation](evidence/browser-observation.md).

Browser observations are manual checks of a specific route and time. They are not a comprehensive browser matrix or a claim that every optional inherited interface was tested. The deployment workflow's current results can be inspected in [GitHub Actions](https://github.com/13shreyansh/orbit-friends-universe/actions).

## Evidence that is not present

There is no archived original GPT Image 2 request/output trail, real-model album-analysis transcript, model-quality benchmark, user study, cross-device performance measurement, or independent rights clearance for the reference imagery. The team account and source implementation are useful evidence of different kinds; neither is represented as one of these missing artifacts.

A future addition should preserve the original file or response, identify its model/tool and date, and explain how it relates to the running product. Demonstration examples and later reproductions must remain labeled as such.
