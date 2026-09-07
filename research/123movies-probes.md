# Parked 123Movies probes

These providers were moved out of `Limitless-nexus` after live Nuvio probing and are retained here for later research.

## 123MoviesIN

- Lab loader: `providers/123moviesin-lab.js`
- Archived Nexus implementation: commit `60da16cb74131f74b44402ec8e500e61ff730b94`, path `custom/providers/123moviesin-nexus.js`
- Result: Nuvio could reach the TMDB-native `/film/<tmdb>/` and `/show/<tmdb>/` catalog routes.
- The apparent player candidates were lazy-loaded image URLs such as `i1.wp.com`; no distinct playback source was confirmed.
- Status: parked catalog/guide probe.

## 123MoviesFree

- Lab loader: `providers/123moviesfree-lab.js`
- Archived Nexus implementation: commit `9732169eb85c795a3563998dd04fcdb234a5a36a`, path `custom/providers/123moviesfree-placeholder.js`
- Result: Nuvio failed to fetch all tested `123moviesfree.net` roots, including the current `ww8` frontend and several ww# fallbacks.
- Status: parked until a viable native-network or relay strategy is worth revisiting.

The loaders pin the archived probe code by commit SHA so later experiments can resume without reintroducing these providers into the main Nexus manifest.
