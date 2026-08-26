# Scraper reference index

This file records external projects and repositories worth revisiting while building and importing Nuvio scrapers. It is broader than `sources-lock.json`: this is an engineering/reference index, not a declaration that code was copied from every project listed here.

## 123Anime-specific references

### yuzono/anime-extensions
- Repository: https://github.com/yuzono/anime-extensions
- 123Anime source: `src/en/onetwothreeanime/src/eu/kanade/tachiyomi/animeextension/en/onetwothreeanime/OneThreeTwoAnime.kt`
- Extractor: `src/en/onetwothreeanime/src/eu/kanade/tachiyomi/animeextension/en/onetwothreeanime/OneThreeTwoAnimeExtractor.kt`
- License context: Apache-2.0 extension project/source lineage.
- Useful ideas: source/search/load/extractor separation, user-selectable domains, shared source factories for mirrors, explicit episode-list then per-server extraction.

### mdtahseen7/123anime-api
- Repository: https://github.com/mdtahseen7/123anime-api
- Search implementation: `scrapeanime/Browse/Search/search.js`
- Routes: `routes/search.js`, `routes/episodeStream.js`, `routes/play.js`, `routes/watch.js`
- License: MIT (`LICENSE`).
- Useful ideas: modern `123anime.la` HTML selectors, `/search?keyword=` discovery, clean separation of search/details/episodes/playback, direct HLS resolution/caching.

## Nuvio-native matching/reference implementations

### NuvioMedia/NuvioTV
- Repository: https://github.com/NuvioMedia/NuvioTV
- File: `app/src/full/java/com/nuvio/tv/core/plugin/cloudstream/ExternalExtensionRunner.kt`
- Useful ideas: bridge TMDB metadata to text-search scrapers, search multiple title variants, rank candidates by normalized title similarity rather than exact equality, use year/type as evidence, load a candidate before extracting an episode, return partial results when source aggregation times out.
- License note: use as architecture/reference unless license compatibility has been checked for direct code reuse.

### yoruix/nuvio-providers
- Repository: https://github.com/yoruix/nuvio-providers
- Useful ideas: Nuvio provider packaging, multi-file source projects for complex providers, local Node tests before Nuvio runtime testing.

### phisher98/phisher-nuvio-providers
- Repository: https://github.com/phisher98/phisher-nuvio-providers
- Useful ideas: broad Nuvio provider examples and runtime compatibility patterns.

### 1Anime/nuvio-src
- Repository: https://github.com/1Anime/nuvio-src
- Useful ideas: anime-specific Nuvio source fallbacks and AniList-oriented identity handling.

## CloudStream / extractor architecture

### recloudstream/cloudstream
- Repository: https://github.com/recloudstream/cloudstream
- Extractor registry: `library/src/commonMain/kotlin/com/lagradost/cloudstream3/utils/ExtractorApi.kt`
- Useful ideas: register host-specific extractors independently from content providers; exact domain dispatch first, controlled fuzzy/mirror-domain fallback second.
- License note: use design ideas unless direct reuse is license-compatible.

### recloudstream/extensions
- Repository: https://github.com/recloudstream/extensions
- Useful ideas: provider/extractor separation and extension packaging.

## Aniwaves / alternate source-family references

### PD-Codes/MediaForge
- Repository: https://github.com/PD-Codes/MediaForge
- Aniwaves adapter: `src/mediaforge/models/aniwaves_ru/scraper.py`
- Extractor references: `src/mediaforge/extractors/provider/`
- License: GPL-3.0. Do not copy implementation code into a differently licensed provider without satisfying GPL requirements. Endpoint behavior and architecture can be independently reimplemented.
- Useful observed API shape for `aniwaves.ru`:
  - search: `/ajax/anime/search?keyword=...`
  - episode list: `/ajax/episode/list/{series_id}`
  - server list: `/ajax/server/list?servers={series_id}&eps={episode}`
  - source resolution: `/ajax/sources?id={link_id}&asi=0&autoPlay=1`

## Anime season/cour/episode identity references

### erengy/anime-relations
- Repository: https://github.com/erengy/anime-relations
- Data: `anime-relations.txt`
- Useful ideas/data: explicit episode-range relations between separate MAL entries. Particularly valuable for split cours and provider records such as Mushoku Tensei Part 2 and Oshi no Ko 2nd Season.
- Treat as an episode-identity source, not a playback scraper.

### anibridge/anibridge-mappings
- Repository: https://github.com/anibridge/anibridge-mappings
- Useful ideas/data: episode-level mapping graph across AniDB, AniList, MAL, TMDB, TVDB and IMDb; combines several upstream mapping sources and manual corrections.

### shinkro/community-mapping
- Repository: https://github.com/shinkro/community-mapping
- Useful ideas/data: explicit anime/TVDB season ranges, episode mappings and skip lists.

### Anime-Lists/anime-lists
- Repository: https://github.com/Anime-Lists/anime-lists
- Useful ideas/data: cross-database anime IDs and season relationships.

### manami-project/anime-offline-database
- Repository: https://github.com/manami-project/anime-offline-database
- Useful ideas/data: normalized anime metadata and cross-site references useful for alias expansion.

## Older architecture references

### aniyomiorg/aniyomi-extensions
- Repository: https://github.com/aniyomiorg/aniyomi-extensions
- Status: archived, but useful for historical extension architecture and multisrc patterns.

### Kohi-den/extensions-source
- Repository: https://github.com/Kohi-den/extensions-source
- Status: archived, but useful for older AniYomi multisrc/theme implementations.

## 123Anime-family domains currently known

These are source candidates, not assumed to be protocol-identical:

### Legacy/123Anime-style candidates
- https://123anime.ru
- https://123anime.la
- https://123anime.cc
- https://123anime.info
- https://123animehub.cc
- https://w1.123animes.ru

### Related alternate engines discovered while researching the family
- https://aniwaves.ru
- https://guts.to

`aniwaves.ru` is confirmed to use a different AJAX protocol from legacy 123Anime. `guts.to` is also treated as a separate adapter until its exact playback API is verified. The aggregator must never send one engine's AJAX calls blindly to every domain.
