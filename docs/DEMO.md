# Explore Orbit

[Open the public demo](https://thecsguys.xyz/). The prepared experience uses public fictional fixtures and does not ask for a real account, upload, or API key.

## A repeatable journey

1. On the opening screen, choose **Ross**. The introduction identifies the experience as a prepared Friends universe.
2. Inspect the universe and select **Monica** from the visible friend controls. The chosen friend becomes the travel destination.
3. Follow the displayed travel action and wait for arrival. The scene shifts from the overview toward the selected relationship.
4. Open the photo book. Read the title and captions, then turn at least two pages.
5. Return to the universe and choose **Rachel**. Check that the relationship story and opening photograph differ.
6. To compare perspectives, return to the entry screen by reloading and choose another friend. Selecting the reverse pair resolves to the same underlying shared story.

Exact control labels depend on the current scene and language. Follow visible controls; the checks below establish content invariants independently of camera timing.

## What to look for

The sun establishes the current point of view. Planets provide a map of the five other people. Travel creates a transition between overview and story. The diary combines reference photographs and authored captions specific to the chosen pair.

There are fifteen unordered pairs, rather than thirty independent stories. Symmetry matters because a shared relationship should remain recognizable when either person is the starting point. The story verifier checks the full pair space, not only the Ross demonstration route.

The curated demo is intentionally repeatable. It does not analyze the opening photograph, infer the fictional characters' relationships, or generate a new diary on demand. The separate [album backend](VISUAL_INTELLIGENCE.md) is where image inputs become proposed memory chapters.

## Reading the evidence correctly

A working journey demonstrates rendering, navigation, story lookup, and media loading for the tested route. Source-level checks cover all fifteen collections. Neither a working page nor a mocked backend test demonstrates model accuracy, generation quality, multi-user production readiness, or performance across all devices.

If rendering is slow, let the scene and media load and use a browser with WebGL support. No cross-device performance benchmark is published. If an image is missing in a local development session, use the production build-and-preview instructions: the build creates the legacy media URL compatibility directory.

See the dated [evidence ledger](EVIDENCE.md) for which checks were actually executed.
