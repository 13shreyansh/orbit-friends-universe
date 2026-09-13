# Development and deployment

## Reproduce the public site

Use Node.js 22.18+ and npm. Native TypeScript loading is used by the pair-story verifier. Install from `package-lock.json`:

```sh
npm ci
npm run check:demo
npm run build
npm run preview
```

Open the address printed by Vite. A production preview is the closest local reproduction because the build preserves the original `/orbit-friends-universe/` media prefix as well as root paths. The fixture-based experience needs no backend, API key, database, or real account.

`npm run dev:web` starts the frontend development server, but the production-only compatibility copy is not created by that command. Existing hardcoded legacy media URLs can therefore behave differently in development. Use build-and-preview to verify the public experience until URL construction is centralized.

## Backend setup

Python 3.10+ is required. Use a repository-local virtual environment; activate it or invoke its Python explicitly:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e './backend[test,production]'
.venv/bin/python -m pytest -q backend/tests/orbit
```

On Windows, use `.venv\Scripts\python.exe` in place of `.venv/bin/python`. The `production` extra supplies dependencies used by parts of the inherited full test suite, including Alembic; installing it does not provision external services.

For an isolated local API:

```sh
SOCIAL_COSMOS_DATABASE_URL=sqlite:////tmp/orbit-local.db \
  .venv/bin/python -m uvicorn app.main:app --app-dir backend \
  --host 127.0.0.1 --port 8787
```

SQLite schema creation is performed by the application. Keep the API on localhost while testing. The public transport remains installed in the current frontend, so starting this API does **not** switch the hosted demo or frontend into real import mode.

For a fresh fixture-like local backend, the existing seed command is:

```sh
SOCIAL_COSMOS_DATABASE_URL=sqlite:////tmp/orbit-local.db \
  PYTHONPATH=backend .venv/bin/python -m app.seed_friends
```

Only seed a disposable database. This step is unnecessary for the public static demo and for tests, which create their own temporary databases.

## Configuration boundaries

| Variable | Purpose |
| --- | --- |
| `SOCIAL_COSMOS_DATABASE_URL` | Server database URL; use a disposable SQLite file for local experiments |
| `OPENAI_API_KEY` | Server-side key for live album understanding; keep out of Git and frontend assets |
| `OPENAI_MODEL` | Model configured for album understanding; confirm access before making a live request |
| `ORBIT_PUBLIC_ORIGIN` | Explicit origin for generated shared-visit links |
| `VITE_API_PROXY_TARGET` | Local Vite proxy destination; does not disable the fixture transport |
| `PYTHON_COMMAND` | Python executable used by Node wrapper scripts such as `check:api` |

The source default model string is not an access guarantee. The test suite injects fake responses and local contract services. Run live image analysis only with an intentionally configured key and photos approved for that service. Original uploaded bytes are saved under backend data uploads; private-album retention and access controls need further work before public exposure.

## Checks

| Command | Coverage |
| --- | --- |
| `npm run check:demo` | Fifteen pairs, photo-book invariants, fixtures, local doc links, media hashes |
| `npm run build` | TypeScript compilation and production bundling |
| `.venv/bin/python -m pytest -q backend/tests/orbit` | Album contract, ownership, upload limits, shared visits with mocks |
| `.venv/bin/python -m pytest -q backend/tests` | Broader inherited backend suite; consult recorded audit results |
| `npm audit` | Current npm advisory report; a passing build is not a clean security audit |

The package includes inherited persona, drill, and Playwright commands. Some reference files absent from this checkout; they are not presented as verified Orbit workflows. Do not substitute an unrelated passing command for an unexecuted test suite.

## Deployment

The [Pages workflow](../.github/workflows/pages.yml) runs on pushes to `main` and manual dispatch. It installs with `npm ci`, verifies the demo, builds with TypeScript and Vite, uploads `dist`, and deploys it through GitHub Pages. The custom-domain setting points to **thecsguys.xyz** and HTTPS is enforced in Pages settings.

A domain-root build uses Vite base `/`. Existing references under `/orbit-friends-universe/` are preserved by the `preserve-demo-asset-paths` build plugin. Removing that copy requires first migrating and checking every media reference, including photos, models, and video.

After publishing, verify the Actions result, the HTTPS document response, representative media responses, and the browser journey. A successful Git commit alone is not deployment evidence. Changing backend code does not deploy a backend through this workflow.

## Preserving reproducibility

The npm lockfile is committed. Python dependencies currently use version ranges; the audit records the environment used, but there is no fully pinned Python lockfile. Asset hashes can be checked without generating or modifying any images. Update the manifest only after reviewing a deliberate asset change and retaining its provenance.

Historical backend operational notes are preserved in [the original README](reference/backend-readme-original.md). Use the present guide for Orbit scope; historical links and service descriptions may not apply to this checkout.
