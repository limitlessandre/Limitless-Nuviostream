# Limitless Anime Baseline

`Limitless-Nuviotest` is the clean anime-first rebuild of Limitless Nuviostream.

## Design

This branch is a frozen, self-contained baseline rather than a live upstream aggregator.

- Provider JavaScript lives in this repository under `providers/`.
- The initial imports are pinned to exact upstream commits in `sources-lock.json`.
- After the first bootstrap, the workflow performs validation only and never fetches upstream changes again.
- Duplicate implementations of the same anime source are intentionally collapsed.
- Multiple player/extractor routes may be tried internally, but identical final streams are collapsed before they reach Nuvio.
- Updates are manual so we can test a provider before changing our baseline.

## Stream naming standard

Limitless uses compact, behavior-based stream tags:

- `[DUB]` = dubbed audio with no selectable subtitle track.
- `[HARDSUB]` = subtitles are burned into the video.
- `[SOFTSUB]` = selectable subtitle track(s).
- `[DUB+SUBS]` = dubbed audio plus selectable subtitle track(s).
- `[HARDSUB+SUBS]` = burned-in subtitles plus additional selectable subtitle track(s).

A generic `SUB` label is not promoted to one of these tags unless the provider actually proves whether the subtitles are hardcoded or selectable.

## Included anime providers

123Anime, AllAnime (disabled by default), All-Wish, AniDB, AniNeko, AnikotoTV, AnimeKai, AnimePahe, AnimeZeY, Animetsu, AniZone, HiAnime, KissKH Anime, Kurage, TokyoInsider, VidnestAnime, and WCoflix.

123Anime is the first intentional AniYomi-to-Nuvio Limitless port. AnimeKai, All-Wish, AllAnime, and WCoflix are also maintained locally; AllAnime is parked disabled because MKissa rotates its client crypto frequently.

The first baseline prioritizes English and Japanese anime, while retaining useful Asian-language coverage. Providers focused primarily on unrelated language catalogs are excluded from this test set.

## Nuvio install URL

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/Limitless-Nuviotest/manifest.json
```

## Files

- `manifest.json`: Nuvio install manifest with local provider paths.
- `providers/`: frozen provider JavaScript.
- `sources-lock.json`: provenance for the initial snapshot.
- `.anime-baseline-frozen`: prevents any later automatic upstream import.
- `.github/workflows/update-manifest.yml`: validation-only workflow for the frozen baseline.
