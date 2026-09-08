# Scarlet Peach Metadata Schema v2

Scarlet Peach schema v2 is the normalized adult-animation metadata contract used by the catalog, stream providers, and future derived catalogs.

## Design rules

1. **Stable identity first.** Prefer `mal:` or `anilist:` IDs. Use `sp:<source>:<source-id-or-slug>` only when no safe canonical match exists.
2. **Never merge ambiguous titles.** Provider imports merge automatically only on an explicit `canonicalId` or one unique exact normalized title/alias match, with year agreement when both sides have a year.
3. **Canonical data and provider claims stay separate.** A title can be globally `mixed` while individual provider mappings remain `censored` or `uncensored`.
4. **Raw source imports may differ.** Published snapshots are always normalized to `schemaVersion: 2`.
5. **Unknown is valid data.** Do not invent languages, censorship, qualities, dates, or tags.

## Published title record

```json
{
  "id": "mal:44044",
  "type": "series",
  "adult": true,
  "sourceConfidence": "MAL",
  "sourceMetadata": {},
  "contentRating": {
    "adult": true,
    "classification": "Rx - Hentai",
    "source": "MyAnimeList"
  },
  "title": "Canonical title",
  "titles": {
    "english": null,
    "romaji": "Canonical title",
    "japanese": null,
    "aliases": []
  },
  "description": null,
  "poster": null,
  "background": null,
  "artwork": {
    "poster": null,
    "background": null
  },
  "year": null,
  "releaseDate": null,
  "updatedAt": null,
  "studio": null,
  "genres": ["Hentai"],
  "tags": ["hentai"],
  "censorStatus": "unknown",
  "languageVersions": [],
  "episodes": [],
  "providerMappings": [],
  "availability": {
    "providers": [],
    "audioLanguages": [],
    "subtitleLanguages": [],
    "qualities": [],
    "censorStatuses": []
  },
  "provenance": {
    "canonicalSource": "MAL",
    "sources": [],
    "lastMergedAt": null
  }
}
```

## Censorship

Allowed values:

- `censored`
- `uncensored`
- `mixed`
- `unknown`

Provider-specific censorship belongs on the provider mapping. The title-level value is an aggregate/canonical classification and may be `mixed` when providers disagree.

## Language versions

```json
{
  "audio": "ja",
  "subtitles": ["en"],
  "dub": false,
  "source": "hanime",
  "verifiedAt": "2026-09-08T00:00:00.000Z"
}
```

Use normalized language codes where possible, such as `ja`, `en`, `es`, `pt`, `fr`, `de`, `it`, `ko`, and `zh`.

## Provider mapping

```json
{
  "provider": "hanime",
  "providerId": null,
  "seriesId": null,
  "slug": "jimihen-jimiko-o-kae-chau-jun-isei-kouyuu-season-1",
  "url": "https://hanime.tv/videos/hentai/...",
  "title": "Provider title",
  "censorStatus": "censored",
  "audioLanguages": ["ja"],
  "subtitleLanguages": ["en"],
  "tags": ["Glasses", "BDSM"],
  "qualities": [360, 480, 720],
  "lastVerifiedAt": "2026-09-08T00:00:00.000Z",
  "metadata": {}
}
```

`metadata` is for useful provider-specific fields that are not yet part of the normalized core. Do not bury normalized fields such as censorship or language inside `metadata`.

## Episode record

```json
{
  "number": 1,
  "title": "Episode 1",
  "releaseDate": null,
  "runtimeSeconds": null,
  "thumbnail": null,
  "overview": null,
  "censorStatus": "unknown",
  "audioLanguages": [],
  "subtitleLanguages": [],
  "providerMappings": []
}
```

Episode provider mappings can carry exact per-episode slugs/IDs when a provider does not have one stable series identifier.

## Generic provider import format

Provider-specific harvesters should emit an intermediate JSON document and let `scripts/merge-provider-import.js` normalize/merge it.

```json
{
  "provider": "hanime",
  "generatedAt": "2026-09-08T00:00:00.000Z",
  "records": [
    {
      "canonicalId": "mal:44044",
      "title": "Jimihen!! Jimiko o Kae Chau Jun Isei Kouyuu Season 1",
      "aliases": [],
      "year": 2021,
      "studio": "Studio Hokiboshi",
      "genres": ["Hentai"],
      "tags": ["Glasses"],
      "censorStatus": "censored",
      "audioLanguages": ["ja"],
      "subtitleLanguages": ["en"],
      "qualities": [360, 480, 720],
      "slug": "jimihen-jimiko-o-kae-chau-jun-isei-kouyuu-season-1",
      "url": "https://hanime.tv/videos/hentai/...",
      "episodes": []
    }
  ]
}
```

Run:

```bash
npm run merge:provider -- data/imports/hanime.json
npm run build:snapshot
```

If a provider record cannot be matched safely, the merger creates an `sp:<provider>:<slug>` record. This preserves coverage without corrupting canonical identity.

## Reusable HTTP endpoints

The deployed catalog exposes:

- `/manifest.json` — Nuvio/Stremio-compatible addon manifest
- `/health` — schema version, generation time, and title count
- `/schema.json` — machine-readable schema descriptor
- `/dataset.json` — complete normalized schema v2 dataset
- `/data/current.json` — alias of `/dataset.json`
- `/meta/series/<id>.json` — detailed normalized metadata mapped into Stremio meta plus Scarlet Peach extension fields
