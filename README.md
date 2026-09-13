# Orbit · A universe of us

**Shared memories become places you can return to.**

[Explore the live universe](https://thecsguys.xyz/) · [Demo walkthrough](docs/DEMO.md) · [Architecture](docs/ARCHITECTURE.md) · [Evidence & verification](docs/EVIDENCE.md) · [Visual understanding & GPT Image 2](docs/VISUAL_INTELLIGENCE.md)

Orbit turns a collection of shared moments into an explorable universe. Choose a perspective, see the people around you as planets, travel to a relationship, and open its diary. The interaction moves from the scale of a whole social world to the intimacy of one photograph and one story.

Built for the GPT-6 Astra Hackathon in Singapore, with a focus on **Visual Understanding and GPT Image 2**. The team used GPT Image 2 to imagine the diary visuals and the overall visual experience. The repository also implements a photo-understanding backend that groups images into memory chapters and translates those chapters into planets. These two uses are described separately below, with links to the implementation and available evidence.

## The experience in one minute

1. Open **[thecsguys.xyz](https://thecsguys.xyz/)**. No account or API key is required for the prepared demo.
2. Enter as **Ross**, or any of Monica, Rachel, Chandler, Joey, and Phoebe.
3. Select another friend. Your chosen perspective is the sun; the other five friends form the surrounding universe.
4. Travel to that relationship and open its photo book.
5. Turn the pages, return to the universe, and visit someone else. Each relationship has its own story collection.

The published experience uses the familiar world of *Friends* to make the relationship model immediately understandable. It contains **six perspectives and all fifteen unique pairs**: six people produce `6 × 5 ÷ 2 = 15` relationships. Each pair has a distinct opening image, a distinct collection of three to eight photographs, and written captions. Pair lookup is symmetric: Ross–Monica and Monica–Ross point to the same shared story.

The demo's stories are curated. The visitor is exploring prepared material; selecting a friend does not trigger a new image analysis or image-generation request.

## Why Orbit exists

An album preserves photographs, but the interface rarely expresses why a particular group of moments matters. The same person can appear across years of unrelated folders. A meaningful memory may be surrounded by near-duplicates, screenshots, and administrative clutter. Chronological storage is useful; returning to a relationship calls for another way to navigate.

Orbit's product idea is to make that navigation spatial. A person or chapter becomes somewhere to go. The universe gives an overview, travel creates a transition, and the diary gives individual memories room to be read. The point of the 3D scene is the return to a specific story, rather than movement for its own sake.

The current implementation demonstrates this interaction with fictional characters and reference photos. The broader photo-album adapter explores how the same interface can be populated from images rather than manually authored relationship books.

## What is available today

| Capability | Current state | Inspect it |
| --- | --- | --- |
| Six-person universe, travel, relationship books | Available in the public static demo | [Live site](https://thecsguys.xyz/), [walkthrough](docs/DEMO.md) |
| Fifteen symmetric, distinct story collections | Curated content with executable checks | [Story definitions](src/demo/friendsStories.ts), [story check](scripts/verify-friends-stories.mjs) |
| Photo understanding into one to six chapters | Implemented backend adapter; offline contract tests are included | [Album adapter](backend/app/orbit_albums.py), [tests](backend/tests/orbit/test_albums.py) |
| Review before creating a chapter universe | Backend preview/confirm flow and frontend component exist; import UI is not mounted in the public entry | [AlbumImport](src/AlbumImport.tsx), [technical explanation](docs/VISUAL_INTELLIGENCE.md) |
| GPT Image 2 for diary and visual ideation | Team-reported design process; original generation exports and request records are not archived here | [Design account and evidence boundary](docs/VISUAL_INTELLIGENCE.md#gpt-image-2-and-the-diary-design) |
| Shared visits and synchronized book state | Backend source and offline tests; not an exposed public-demo workflow | [Visit adapter](backend/app/orbit_visits.py), [tests](backend/tests/orbit/test_visits.py) |
| Custom domain and encrypted access | GitHub Pages deployment at the live URL | [Deployment guide](docs/DEVELOPMENT.md#deployment) |

This table separates the hosted experience from source-level capabilities. GitHub Pages serves the frontend and public fixtures; it does not run the Python service.

## Visual intelligence: from photographs to a memory world

The photo-understanding adapter is in [`backend/app/orbit_albums.py`](backend/app/orbit_albums.py). It sends actual image bytes to the OpenAI Responses API as image inputs. The request asks for chapters based on visible places, shared activities, and occasions, with short names, grounded descriptions, topic keywords, and one supported planet archetype per chapter.

The important output is a **partition of the album**. Every input photograph must belong to exactly one chapter. The service checks for missing indexes, duplicate assignments, out-of-range indexes, empty descriptions, and unsupported archetypes before allowing the preview to proceed. Structured output constrains the shape; application validation enforces coverage.

After the owner confirms the preview, Orbit creates a central planet, chapter planets, relationships, and memory records through the existing graph and memory pipeline. Original photo references remain attached to those memories so that a rendered world can lead back to its source material. Confirmation is designed to be idempotent: retrying it should not create another copy of the universe.

```mermaid
flowchart LR
    A[Uploaded photographs] --> B[Image inputs to model]
    B --> C[Chapter descriptions and image indexes]
    C --> D[Validate complete partition]
    D --> E[Owner reviews preview]
    E --> F[Confirm and persist]
    F --> G[Chapter planets]
    G --> H[Memory diary with original photos]
```

This diagram describes the backend import path. The public Friends demo begins with saved fixtures and curated stories instead of running the first six steps during a visit.

The model prompt explicitly asks the model not to identify real people, infer private relationships, invent dates, or obey instructions embedded in images. These are requested behaviors, not a claim of perfect model compliance. The test suite uses mocked responses and verifies the surrounding software contract; it is not a measurement of a model's visual accuracy. See [Visual intelligence](docs/VISUAL_INTELLIGENCE.md) for the exact source, limits, and remaining evaluation work.

## GPT Image 2 and the visual direction

The team's account of the design process is that GPT Image 2 was used to visualize how the diary and the broader Orbit experience should feel. The design goal is a coherent progression: a wide universe, a deliberate journey, and a personal book in which the photographs remain the center of attention.

The implemented translation of that direction can be inspected in the [memory-book renderer](src/modules/memory-book/MemoryBook.tsx), [page animation](src/modules/memory-book/components/PageTurnAnimation.tsx), [book styling](src/modules/memory-book/MemoryBook.module.css), and [universe experience](src/modules/universe/UniverseExperience.tsx). These files are evidence of the resulting interface. They are not, by themselves, model-generation receipts.

The repository contains a mixture of source code, rendered geometry, model/video assets, and sourced Friends reference photographs. The photo provenance files identify the Friends stills as copyrighted reference material. They are retained with their original source records and are not relabeled as generated imagery. The [visual design document](docs/VISUAL_INTELLIGENCE.md) explains this distinction and what would complete the generation provenance trail.

## Engineering choices that matter

**A reliable public demonstration.** The static transport supplies six fictional fixtures, so exploring the prepared universe does not depend on a live API, a login service, or a paid model request. Unsupported API actions return a specific demo-only response. The code making that boundary explicit is [`publicDemoTransport.ts`](src/demo/publicDemoTransport.ts).

**A shared story from either perspective.** The curated pair resolver recognizes only supported friend IDs and returns the same story for either direction. Verification checks every pair, unique opening photos, unique collections, captions, asset existence, self-selection, and unknown IDs.

**Memory fidelity inside the diary.** The generic book converter preserves individual media items from multi-photo memories and de-duplicates repeated confirmed photo references and notes. Imported photographs do not acquire a fabricated capture date merely because the import happened today. These behaviors have their own [executable check](scripts/verify-photo-book.mjs).

**An existing foundation, adapted deliberately.** Orbit builds on [Distance](https://github.com/Yiyi-philosophy/distance), retaining its graph, planet rendering, scoring, and comet-travel foundation. Orbit-specific work includes the album and visit adapters, the prepared six-perspective experience, relationship-specific books, public fixtures, and deployment compatibility. Source history and the original MIT notice are preserved.

**Traceable media and reproducible checks.** Original provenance files remain in place. A separate [asset manifest](docs/evidence/assets.json) records current repository paths, byte sizes, and SHA-256 hashes. Hashes establish file identity, not copyright ownership or which model produced a file.

## Run the public demo locally

Use **Node.js 22.18 or newer** and npm. The committed lockfile is the installation baseline.

```sh
git clone https://github.com/13shreyansh/orbit-friends-universe.git
cd orbit-friends-universe
npm ci
npm run build
npm run preview
```

Open the local address printed by Vite, normally `http://127.0.0.1:5173`. Build-and-preview reproduces the deployment's compatibility copy for existing media URLs. A Python environment and OpenAI key are unnecessary for this path.

For the backend, test environment, API configuration, and development-server caveats, use [Development](docs/DEVELOPMENT.md) and the [backend guide](backend/README.md).

## Verify the work

```sh
npm run check:demo
npm run build
```

`check:demo` runs the pair-story checks, the photo-book checks, and the repository evidence checks. The repository check verifies fixture identities, local documentation links, and the asset manifest. It does not contact a model or infer success from prose.

Backend setup and checks:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e './backend[test,production]'
.venv/bin/python -m pytest -q backend/tests/orbit
```

Use Python 3.10 or newer; the recorded audit environment uses Python 3.12. The [evidence ledger](docs/EVIDENCE.md) records actual results, commands, scope, and limitations. Documentation and verification added on 13 September 2026 are a later repository audit, not a claim about what existed at an earlier submission cutoff.

## Navigate the repository

| Start here | Purpose |
| --- | --- |
| [Documentation index](docs/README.md) | A route through product, design, implementation, and proof |
| [Demo walkthrough](docs/DEMO.md) | A short, repeatable journey with expected results |
| [Architecture](docs/ARCHITECTURE.md) | Runtime boundaries, data flow, and key design decisions |
| [Visual intelligence](docs/VISUAL_INTELLIGENCE.md) | Image understanding, GPT Image 2 design role, provenance, and evaluation |
| [Repository map](docs/REPOSITORY_MAP.md) | Where the implementation, assets, tests, and inherited systems live |
| [Evidence ledger](docs/EVIDENCE.md) | Claims connected to files, checks, and recorded results |
| [Development](docs/DEVELOPMENT.md) | Setup, validation, hosting, and troubleshooting |
| [Limitations and next steps](docs/LIMITATIONS.md) | Current boundaries and concrete completion criteria |
| [Attribution](ATTRIBUTION.md) | Code lineage and separate media provenance |

## Credits

Adapted from **Distance** by Yiyi-philosophy, with the original [MIT license](LICENSE) retained. This deployment is the [13shreyansh fork](https://github.com/13shreyansh/orbit-friends-universe) of [Yash-PoPularPlusPlus/orbit-friends-universe](https://github.com/Yash-PoPularPlusPlus/orbit-friends-universe).

Astra in Codex assisted the adaptation, demo flow, story curation and corrections, implementation review, deployment, and verification. GPT Image 2's role in diary and visual ideation is recorded from the team's account. Friends photographs have separate source and rights records in [Attribution](ATTRIBUTION.md). The source-code license does not relicense third-party media.
