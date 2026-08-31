# Limitless Nexus

**Limitless Nexus** is the active custom-provider development branch for Limitless Nuviostream. This is where providers are researched, compared with maintained upstream implementations, adapted for Nuvio, and tested before they are promoted to `Limitless-Master-Nexus`.

The branch exists because the earlier all-in-one provider experiment became too difficult to reason about. Nexus restarted from a clean base and adopted a provider-by-provider approach so identity matching, extraction, playback, language labeling, and fallback behavior can be understood independently instead of being buried inside a giant manifest.

## Install

Nuvio development manifest:

```text
https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/manifest.json
```

[Open the Limitless Nexus manifest](https://raw.githubusercontent.com/limitlessandre/Limitless-Nuviostream/refs/heads/Limitless-nexus/manifest.json)

A branch-local copy is also maintained at `custom/manifest.json`.

## Purpose and design

Nexus is intended to become a compact, well-rounded provider repository rather than a catalogue of every scraper that can be found. The working target is around **twenty providers or fewer**, with roughly five useful choices or fallbacks across the major content areas when crossover providers are counted.

The intended coverage includes anime, Western animation, movies, live-action television, Asian drama, and eventually dedicated donghua coverage. A provider earns a place by adding useful independent coverage, not by inflating the provider count.

The branch favors providers with clean naming conventions, explicit season and episode structures, reliable TMDB/IMDb/MAL/AniList identity paths, and stream metadata that can be labeled without guessing. Minimal title transformation is preferred because every special-case search rewrite becomes another maintenance point later.

Nexus does not rely on Real-Debrid, TorBox, P2P, or similar debrid/torrent services. The project is focused on direct provider scraping and playback paths that work inside Nuvio itself.

## Current providers

| Provider | Version | State | Notes |
|---|---:|---|---|
| Re:ANIME | 1.5.0 | Complete | Direct anime media with MAL/AniList identity mapping, dual-audio handling, and embedded subtitle preservation. |
| WCO | 2.4.8 | Complete | Anime/animation provider with three proven frontend fallbacks, movie and special support, corrected language labels, and real mirror handling. |
| AnikotoTV | 1.0.6 | Casual test / next development target | Known-working provider inherited from the earlier lab. It is being used normally before its deeper Nexus cleanup begins. |

Repository version: **2.0.28**

## Re:ANIME

Re:ANIME was the first provider completed after the clean Nexus restart. It uses TMDB/IMDb metadata with MAL and AniList identity mapping and Re:ANIME's structured Flix data.

The provider preserves meaningful distinctions between streams instead of treating every source label as a separate file. If SUB and DUB entries resolve to the same MKV, the result is treated as shared media and labeled according to the tracks it actually contains. Genuinely separate SUB-only and DUB-only files remain separate. Direct FlixCloud media is used without forcing a proxy when the source already provides a usable file.

This provider established an important Nexus rule: **site labels are clues, not proof of the media tracks inside the file**.

## WCO

WCO was the second provider completed and received a much broader round of source testing because the WCO family exposes several related frontends with uneven behavior.

The proven production order is:

```text
wcostream.tv → wcoflix.tv → wcoforever.net
```

These three frontends were validated across normal anime episodes, Western animation, movies, Season 0 specials, and fallback cases. `wco.tv`, `wcoanimedub.tv`, and `wcoanimesub.tv` were investigated but did not provide enough reliable value to justify adding them to the production chain.

The current WCO provider includes:

- normal episode matching with season protection;
- movies and Season 0/special discovery;
- Episode 0 and fractional-special fallbacks;
- corrected Dub, Sub, and original-audio classification;
- explicit-only mirror numbering so different CDN hosts are not falsely presented as separate mirrors;
- direct-series-page fallback for titles that normal WCO search does not surface correctly;
- deliberate non-matching of full-season bundle entries when Nuvio requests an individual episode.

The full-season behavior matters for shows such as *Red vs. Blue*, where older seasons may exist on WCO only as `Season X Full` or multi-part compilations even though Nuvio metadata still exposes individual episodes. Because Nuvio does not currently provide a clean provider-supplied start-offset mechanism, Nexus leaves those compilation files alone rather than attaching the same full-season video to every episode.

### WCO Premium research

Authenticated premium access was tested separately and answered a useful architectural question. A valid browser session reaches the premium episode and player, but the actual media request is generated dynamically as a tokenized `getvid?evid=...` URL and also relies on authenticated request context such as Cookie, Referer, and byte-range behavior.

That experiment showed that premium playback is coupled to WCO's browser-side player rather than being a simple authenticated static stream. Premium support is therefore intentionally excluded from the production provider. The diagnostic files are retained in Git history for reference, but the temporary Domain Test provider is no longer exposed in the manifest.

## AnikotoTV

AnikotoTV is the third provider currently present in Nexus. The starting implementation comes from the earlier provider laboratory and already works well enough for normal viewing, which makes it useful to test casually before modifying it.

Its existing implementation combines TMDB information with MAL/AniList mapping and additional episode-number fallbacks, then resolves anime streams through the provider's current player path. The next dedicated provider-development cycle will evaluate which parts should be simplified, which identity fallbacks are actually useful, and whether the current subtitle/audio labeling accurately reflects the returned media.

Until that work begins, AnikotoTV should be treated as a known-working baseline rather than a finished Nexus rewrite.

## Provider strategy

The project roadmap favors a small core with independent fallbacks. Anime specialists are balanced with crossover providers that can strengthen animation, drama, movies, and television without multiplying maintenance work. Candidate names discussed during planning include sources such as AnimePahe, AnimeKai, HiAnime/AniNeko-style alternatives, KissKH and other drama sources, plus broader movie/TV providers where their naming and extraction paths fit Nuvio well.

The exact final list is intentionally flexible. Reliability and maintainability matter more than reaching a quota, and five genuinely independent options are more useful than five mirrors of the same underlying infrastructure.

Identity resolution and media extraction are treated as separate layers. If a provider finds the correct title and episode but playback fails, the working matching layer should be preserved while extraction is investigated. Likewise, a playable stream is not considered correctly implemented until its audio, subtitle, quality, and mirror labels reflect what the media actually provides.

## Branch family

- **`Limitless-Master-Nexus`**: stable promotion branch for providers that have passed Nexus development and are ready for broader use.
- **`Limitless-nexus`**: this branch, where active provider development and targeted experiments happen.
- **`Limitless-Provider-Lab`**: preserved legacy/provider laboratory with the larger historical provider set, older ports, and experiments useful for research and comparison.

Temporary diagnostic providers belong here or in the lab, not in Master. Once a provider reaches a stable state, the relevant production code is promoted forward while the investigative debris stays behind in history where it can still be useful later.
