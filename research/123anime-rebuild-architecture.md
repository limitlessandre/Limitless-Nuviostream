# 123Anime aggregator rebuild architecture

## Goal

Replace the old single-base/exact-title resolver with a source aggregator that can survive:

- incomplete or drifting mirror catalogs,
- different site engines under related branding,
- alternative English/Romaji/Japanese titles,
- explicit Season 2/Season 3 provider records,
- split cours such as Mushoku Tensei Part 1 / Part 2,
- continuous episode numbering such as Oshi no Ko on some sources,
- separate SUB and DUB records,
- a partial outage on any one source.

The existing `providers/123anime.js` 1.1.7 remains untouched while this rebuild is developed in parallel. Its exact snapshot is preserved under `backups/123anime/`.

## Core rule: source health is not title availability

A homepage responding successfully must never make one domain the global winner. Each source is queried independently for the requested title. A source only contributes when it can prove a plausible title/episode path.

## Source registry

Every domain gets an adapter profile rather than being assumed protocol-compatible.

### `legacy123`
Candidates:
- `123anime.ru`
- `123anime.la`
- `123anime.cc`
- `123anime.info`
- `123animehub.cc`
- `w1.123animes.ru`

Shared concepts:
- HTML search/filter cards
- `/ajax/film/sv?id={slug}` episode/server sheet
- `/ajax/episode/info?epr={slug}/{episode}/{server}` playback metadata
- EchoVideo/JW/Legacy/SBv2 extraction

Search routes may differ by domain. A route producing unrelated cards is not considered success; candidate quality is evaluated before deciding whether a fallback search route is needed.

### `aniwaves`
Candidate:
- `aniwaves.ru`

Confirmed different protocol:
- `/ajax/anime/search?keyword=...`
- `/ajax/episode/list/{series_id}`
- `/ajax/server/list?servers={series_id}&eps={episode}`
- `/ajax/sources?id={link_id}&asi=0&autoPlay=1`

This adapter must remain separate from `legacy123` even though the site was discovered through the same mirror/source family research.

### `guts`
Candidate:
- `guts.to`

The site is cataloged in the source registry immediately, but extraction stays adapter-isolated until its exact episode/server API is verified. Do not guess that it accepts either `legacy123` or `aniwaves` AJAX calls.

## Identity pipeline

### 1. Metadata context
Resolve TMDB metadata and, where available:
- IMDb ID
- MAL episode mapping
- Jikan aliases
- AniList aliases
- Kitsu aliases
- release year

### 2. Query generation
Generate a small prioritized query set rather than dozens of permutations:
1. episode-specific mapped anime title,
2. TMDB localized/English title,
3. TMDB original title,
4. strongest Romaji/English alias,
5. explicit requested-season variant when needed.

### 3. Aggregate first, rank second
Search every active adapter independently and combine all cards. Never return the first non-empty search response.

### 4. Structured title comparison
Do not reduce identity to `normalizedA === normalizedB`.

Use:
- exact normalized title score,
- token/containment score with a length-ratio guard,
- edit-distance similarity,
- alias agreement,
- year agreement when known,
- media type agreement when known,
- explicit season/part/cour markers as structured evidence.

Season/part markers must not be blindly stripped before identity selection. They are critical for distinguishing Oshi no Ko S1 from S2 and Mushoku Tensei Part 1 from Part 2.

### 5. Hard contradiction rules
Examples:
- Requested S2+ and candidate is provably the plain S1/base record: reject unless episode mapping explicitly requires a continuous base record.
- Candidate explicitly says a different numbered season: reject.
- Candidate year differs substantially when both years are reliable: penalize/reject.
- Specials/movies must not beat a TV candidate solely because their title contains the same root.

## Episode mapping pipeline

Identity and episode numbering are separate decisions.

Priority:
1. episode-specific MAL mapping from Nuvio S/E,
2. explicit anime relation/range mapping when available,
3. provider record's actual episode list,
4. position-based translation for continuous-number records,
5. cour stitching only when two records are confidently identified as consecutive parts of the same requested Nuvio season.

For example:
- Mushoku Tensei Nuvio S1E12 can map to Part 2 provider-local E1.
- Oshi no Ko Nuvio S2E1 can map either to an explicit Season 2 provider-local E1 or, on a continuous-number source, the first item in that season record (such as #12).

## Extraction pipeline

After a candidate passes identity and episode checks:
1. load its provider episode sheet,
2. prove the requested episode exists or can be translated,
3. fetch all reasonable servers/language variants,
4. resolve playable links,
5. normalize output fields,
6. de-duplicate only identical playback URLs/headers/subtitle sets.

Do not de-duplicate away distinct SUB/DUB or selectable-subtitle variants.

## Partial failure behavior

Use bounded parallel work. One domain timing out must not cancel the other domains. Return any valid streams collected before the overall provider timeout.

## Output labels during rebuild

Include source identity while testing, for example:
- `123Anime NEXT | hub | 1080p [DUB]`
- `123Anime NEXT | la | 720p [HARDSUB]`
- `123Anime NEXT | aniwaves | 1080p [SOFTSUB]`

This gives us runtime diagnostics even when Nuvio does not expose console logs.

## Three-title acceptance matrix

No rebuild is considered complete until all three pass:

### The Saga of Tanya the Evil
Regression control for ordinary season records.

### Oshi no Ko
Tests explicit later-season identity and continuous numbering behavior.

### Mushoku Tensei: Jobless Reincarnation
Tests title aliases and one Nuvio season spanning separate Part/Cour provider records.

Minimum checkpoints should include:
- Tanya S1E1 and S2E1
- Oshi S1E1 and S2E1
- Jobless S1E1, S1E11, S1E12 and S2E1
