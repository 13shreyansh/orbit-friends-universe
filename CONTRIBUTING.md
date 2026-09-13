# Contributing to Orbit

Keep the prepared demo reproducible and make changes traceable to behavior.

1. Use a focused branch and preserve the original license and media provenance.
2. Install from the npm lockfile; run `npm run check:demo` and `npm run build` for frontend or documentation changes.
3. Run the Orbit backend tests for album, visit, authentication, or persistence changes. Broaden testing when a shared inherited module changes.
4. Describe the observable before/after behavior and record the tests actually run.
5. Update the documentation when a capability moves from source-only to an exposed user workflow.

Do not commit credentials, `.env` files, local databases, private photo uploads, or generated build output. The static Friends fixtures intentionally contain synthetic demo sessions; do not export real user sessions into that format.

When adding media, retain its source and rights record. If it is generated, keep the original output, prompt, model/tool identity, generation date, and a mapping to its use. Label later reproductions with their actual date. Update the asset manifest only after reviewing the file changes.

When adding evidence, distinguish a source inspection, a mocked test, a live-model run, a browser observation, and a production deployment. Keep raw evidence intact and add interpretation alongside it. Do not present illustrative JSON, generated test data, or a newly created concept image as historical proof.
