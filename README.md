# Limitless Anime Baseline

`Limitless-Nuviotest` is the clean anime-first rebuild of Limitless Nuviostream.

## Design

This branch is a frozen, self-contained baseline rather than a live upstream aggregator.

- Provider JavaScript lives in this repository under `providers/`.
- The initial imports are pinned to exact upstream commits in `sources-lock.json`.
- After the first bootstrap, the workflow performs validation only and never fetches upstream changes again.
- Duplicate implementations of the same anime source are intentionally collapsed.
- Updates are manual so we can test a provider before changing our baseline.

## Included anime providers

AllAnime, All-Wish, AniDB, AniNeko, AnikotoTV, AnimeKai, AnimePahe, AnimeZeY, Animetsu, AniZone, HiAnime, KissKH Anime, Kurage, TokyoInsider, VidnestAnime, and WCoflix.

AnimeKai and WCoflix are the Limitless-maintained builds carried forward from the previous custom branch.

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
- `.github/workflows/update-manifest.yml`: first-run bootstrap, then validation-only.
