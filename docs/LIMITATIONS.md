# Limitations and next steps

Orbit's public demo demonstrates a coherent relationship-to-diary experience. The repository also contains a broader backend prototype. The following boundaries make the next engineering steps explicit.

## Public experience

The hosted site serves prepared fictional fixtures. There is no exposed live album import, model request, real sign-in, or synchronized shared-visit workflow in its entry path. The corresponding components and adapters do not make those capabilities available until they are integrated and deployed.

Completion criterion: introduce an explicit public-demo versus backend mode, mount the intended flow, and verify a fresh upload through preview, confirmation, navigation, and original-photo display against the actual deployed service.

## Visual understanding

Tests verify response contracts using fakes. There is no archived real-model transcript or measured visual grouping accuracy. The adapter's prompt restrictions are not a guarantee against incorrect descriptions or private inferences. JSON parsing and schema-shaped error handling need further hardening.

Completion criterion: retain consented input albums and raw responses, evaluate chapter coherence and unsupported claims, record model/configuration and dates, and test graceful failure for malformed responses and service outages.

## GPT Image 2 evidence

The team reports image-generation use for visual ideation and assets. The original generation exports and per-file mappings are absent. Existing reference photographs have their own source provenance and must not be relabeled.

Completion criterion: archive original concepts, prompts, tool/model records, and the corresponding shipped artifact or design decision. Keep later reproductions separate from original work.

## Privacy, media, and access

The backend writes uploaded originals to server storage and exposes upload paths as static files. Preview creates an owner/session after grouping. A public service needs explicit retention/deletion behavior, storage access controls, abuse/rate limits, and a reviewed account flow. Demo photo signatures are format checks, not exhaustive content validation. Private Google Photos and authenticated Drive import are unsupported.

Completion criterion: test authorized retrieval and deletion, isolate owner data, document retention, and replace reference media with cleared or participant-owned material for broader use.

## Packaging and maintenance

The build duplicates public assets to preserve legacy URLs. Some inherited commands and authored-world paths reference artifacts outside this snapshot. Python dependencies are not fully locked. No cross-device performance or accessibility audit is recorded.

Completion criterion: centralize asset URLs, validate supported scene options, separate maintained scripts from historical tooling, pin a reproducible backend environment, and measure loading/rendering on a stated device matrix.

Dependency advisories and full-suite results from the current audit are recorded in [Evidence](EVIDENCE.md). Passing targeted checks is not a claim that every inherited subsystem is production-ready.
