# Visual understanding and GPT Image 2

Orbit connects visual material to an interface for revisiting memories. The repository supports two distinct accounts: an implemented image-understanding adapter and a team-reported GPT Image 2 design process for the diary and overall experience.

## What the photo-understanding adapter does

[`backend/app/orbit_albums.py`](../backend/app/orbit_albums.py) accepts an album, sends image bytes to the OpenAI Responses API, and requests chapter assignments. Each image is represented as an `input_image` with a base64 data URL and `detail: low`, preceded by its zero-based index and filename. This path provides actual image content, not just a filename, to the model.

The model name comes from `OPENAI_MODEL`; the source fallback is the literal string `gpt-6-astra`. A configured name is not proof of a successful request or of account access to that model. No paid live-model call was made during the documentation audit.

The prompt asks for two to six meaningful chapters, allowing one when all images depict the same occasion. Grouping should use visible place, shared activity, or occasion. Names, descriptions, and two to four topic keywords should be in English. Supported visual archetypes are `terran`, `oceanic`, `verdant`, `volcanic`, and `crystalline`.

The prompt also instructs the model to avoid real-person identification, inferred private relationships, invented dates, and instructions contained within images. Recognizable fictional settings such as Central Perk may be named for the fan demonstration. These instructions define intent; visual and privacy error rates have not been measured.

## The output contract

The strict JSON schema requires an object with a `groups` array. Each group includes `name`, `description`, `indexes`, `archetype`, and `keywords`, and excludes additional properties.

An illustrative response shape follows. It is an authored example, not saved model output:

```json
{
  "groups": [
    {
      "name": "Coffee together",
      "description": "A small group sits around a table with cups.",
      "indexes": [0, 1],
      "archetype": "terran",
      "keywords": ["coffee", "gathering"]
    }
  ]
}
```

The application validates the result again. It trims and bounds text, checks supported archetypes and integer indexes, and checks that the sorted assigned indexes equal the complete input range. This last invariant simultaneously rejects missing photos, duplicates, and out-of-range references. Tests exercise reordered valid groups as well as invalid partitions.

The local keyword check is weaker than the request schema: it requires nonempty keywords and caps the list at four, while the schema requests at least two. Malformed JSON and unexpected response shapes also warrant more defensive error handling. These are concrete hardening opportunities rather than completed guarantees.

## Preview, confirmation, and persistence

`POST /api/orbit/albums/preview` accepts multipart input and builds a proposed album. It validates supported file signatures and count/size limits, runs grouping, stores the originals, and returns a preview and owner session. The UI source [`AlbumImport.tsx`](../src/AlbumImport.tsx) displays groups and thumbnails before confirmation, but is not mounted in the published entry.

`POST /api/orbit/albums/{id}/confirm` requires the matching owner's session. It converts the proposal into profile, nebula, chapter-planet, relationship, and memory records through the inherited application layer. Confirming a ready album returns it again instead of duplicating the records. Offline tests assert record counts remain stable and uploaded bytes survive through memory media URLs.

The adapter supports one to 36 JPEG, PNG, or WebP files, a maximum of 8,000,000 bytes per photo, and 32,000,000 bytes total. Its optional Drive path reads publicly accessible folder links, not private Google Photos albums or authenticated Drive libraries. Server-side file validation checks signatures; it is not comprehensive image-content sanitization.

## GPT Image 2 and the diary design

**Team account, recorded 13 September 2026:** GPT Image 2 was used to generate visual ideas/assets and imagine the diary visuals and overall Orbit experience. This account explains the role of image generation in the design process. Original prompts, generation exports, response metadata, and a per-file mapping from generated outputs to shipped assets were not supplied to this repository audit.

The visual idea is a progression from distance to intimacy. The universe provides orientation. Travel focuses attention on one relationship. The diary slows the interaction down into readable pages, photographs, and captions. The generated visual exploration informed the team's imagined direction; the runnable experience is implemented with scene rendering, React components, styles, and media assets.

| Design intention | Implemented counterpart | What can be inspected |
| --- | --- | --- |
| A relationship feels like a place worth returning to | Universe, destination selection, travel | [UniverseExperience](../src/modules/universe/UniverseExperience.tsx) |
| A diary provides a focused space for shared moments | Book shell, page layout, controls | [MemoryBook](../src/modules/memory-book/MemoryBook.tsx), [styles](../src/modules/memory-book/MemoryBook.module.css) |
| Turning a page gives the story a deliberate pace | Dedicated page-turn animation | [PageTurnAnimation](../src/modules/memory-book/components/PageTurnAnimation.tsx) |
| Photographs remain recognizable evidence of a memory | Media rendering and original file references | [MemoryMedia](../src/modules/memory-book/components/MemoryMedia.tsx), [photo provenance](../public/friends/provenance.json) |
| Collections remain specific to a relationship | Curated pair stories and distinct lead images | [friendsStories](../src/demo/friendsStories.ts) |

This mapping describes intent and implementation. It is not a side-by-side comparison with archived GPT Image 2 outputs because those originals are not present. No new concept image has been substituted for a historical generation artifact.

### Asset provenance boundaries

The Friends stills have explicit source-page and image-URL records identifying them as copyrighted reference photographs. They are not evidence that GPT Image 2 generated every repository asset. The GLB files, background video, procedural planets, book styles, and photographs are different kinds of artifacts; a file's presence does not establish its generation method.

A complete generation trail would pair an original output with its prompt, model/tool identification, date, usage context, and the exact shipped file or implementation decision it influenced. Any later reproduction should be dated as a new run. The current [manifest](evidence/assets.json) provides stable hashes for file identity without inventing that missing history.

## How the available tests support the track

The album tests replace the model's HTTP client with deterministic responses. They establish that the adapter constructs and processes its contract, rejects invalid group coverage, protects confirmation ownership, preserves photos, and respects the 36-photo boundary. They do not establish whether a model correctly understands a real image.

The story and book checks establish complete demo coverage and media-handling behavior. The browser walkthrough establishes a visible working route. Together, they make the implementation inspectable while leaving model-quality claims appropriately unmeasured.

A useful future visual evaluation would use consented or licensed albums, retain the raw response, and ask reviewers to assess chapter coherence, caption grounding, unsupported inferences, and photo coverage. Report both successful and failed albums, and separate a model's proposal from any human corrections. For image generation, preserve the concept-to-implementation comparison and assess consistency, diary readability, and photograph fidelity. No accuracy percentage, user-study result, or generation benchmark is claimed here.
