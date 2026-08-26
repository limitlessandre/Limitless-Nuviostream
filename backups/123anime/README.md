# 123Anime temporary backup

This directory preserves the last partially working 123Anime Nuvio build before the clean aggregator rebuild.

- Provider version: `1.1.7`
- Repository baseline: `0.1.28`
- Source branch: `Limitless-Nuviotest`
- Source commit: `6f27f4eb06363c2ba42df1b9ed4293be30dddf45`
- Provider blob: `d0b4b8456a23e9f2f2336cb57a59f7e7885390e0`
- Known behavior at backup time:
  - Tanya worked.
  - Oshi no Ko season identity was still incorrect.
  - Mushoku Tensei / Jobless Reincarnation was not resolving.

The matching provider snapshot is `123anime-1.1.7.js`. Do not list this backup in `manifest.json`; it exists only as a recovery point while the new resolver is built and tested.
