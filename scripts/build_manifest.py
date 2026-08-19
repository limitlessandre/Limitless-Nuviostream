#!/usr/bin/env python3
"""Build one deduplicated Nuvio plugin manifest from multiple upstream manifests.

No third-party Python packages are required.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]
SOURCES_FILE = ROOT / "sources.json"
OVERRIDES_FILE = ROOT / "overrides.json"
MANIFEST_FILE = ROOT / "manifest.json"
DUPLICATES_FILE = ROOT / "duplicates.json"
STATUS_FILE = ROOT / "build-status.json"
FILTER_REPORT_FILE = ROOT / "language-filter-report.json"

USER_AGENT = "Limitless-Nuviostream/1.0 (+GitHub Actions)"
TIMEOUT_SECONDS = 30

LANGUAGE_ALIASES = {
    "en": "en", "eng": "en", "english": "en",
    "ja": "ja", "jp": "ja", "jpn": "ja", "japanese": "ja",
    "ko": "ko", "kr": "ko", "kor": "ko", "korean": "ko",
    "zh": "zh", "cn": "zh", "chi": "zh", "zho": "zh", "chinese": "zh",
    "mandarin": "zh", "cmn": "zh", "zh-cn": "zh", "zh-tw": "zh",
    "zh-hans": "zh", "zh-hant": "zh",
}


def normalize_language(value: Any) -> str:
    text = str(value or "").strip().lower().replace("_", "-")
    if not text:
        return ""
    if text in LANGUAGE_ALIASES:
        return LANGUAGE_ALIASES[text]
    for prefix in ("en", "ja", "ko", "zh"):
        if text.startswith(prefix + "-"):
            return prefix
    return text


def provider_languages(provider: dict[str, Any]) -> tuple[list[str], set[str]]:
    value: Any = None
    for field in ("contentLanguage", "contentLanguages", "languages", "language"):
        if field in provider:
            value = provider.get(field)
            break
    if value is None:
        return [], set()
    if isinstance(value, str):
        raw = [value]
    elif isinstance(value, list):
        raw = [str(x) for x in value if x is not None and str(x).strip()]
    else:
        raw = [str(value)] if str(value).strip() else []
    normalized = {normalize_language(x) for x in raw}
    normalized.discard("")
    return raw, normalized


def language_filter_decision(provider: dict[str, Any], language_filter: dict[str, Any]) -> tuple[bool, str, list[str], set[str]]:
    raw, normalized = provider_languages(provider)
    if not language_filter.get("enabled", False):
        return True, "filter-disabled", raw, normalized
    allowed = {normalize_language(x) for x in language_filter.get("allowed", []) if normalize_language(x)}
    if not normalized:
        return bool(language_filter.get("keep_unknown", True)), "unknown-language-metadata", raw, normalized
    if normalized & allowed:
        return True, "allowed-language", raw, normalized
    return False, "no-allowed-language", raw, normalized


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def fetch_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        text = response.read().decode(charset, errors="replace")
    return json.loads(text)


def extract_scrapers(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        scrapers = payload.get("scrapers", [])
        return [x for x in scrapers if isinstance(x, dict)] if isinstance(scrapers, list) else []
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    return []


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def provider_key(provider: dict[str, Any]) -> str:
    return normalize_key(str(provider.get("id") or provider.get("name") or "").strip())


def version_tuple(value: Any) -> tuple[int, ...]:
    nums = [int(x) for x in re.findall(r"\d+", str(value or "0"))]
    return tuple(nums or [0])


def absolute_provider_url(manifest_url: str, filename: Any) -> str:
    value = str(filename or "").strip()
    if not value:
        return ""
    if value.startswith(("https://", "http://")):
        return value
    return urljoin(manifest_url, value)


def sanitize_provider(provider: dict[str, Any], manifest_url: str) -> dict[str, Any]:
    item = dict(provider)
    item["filename"] = absolute_provider_url(manifest_url, item.get("filename"))
    return item


def choose_candidate(key: str, candidates: list[dict[str, Any]], prefer_source: dict[str, str]) -> dict[str, Any]:
    requested = prefer_source.get(key) or prefer_source.get(str(candidates[0]["provider"].get("id", "")))
    if requested:
        requested_norm = requested.strip().lower()
        preferred = [c for c in candidates if str(c["source"].get("name", "")).strip().lower() == requested_norm]
        if preferred:
            candidates = preferred
    return max(candidates, key=lambda c: (version_tuple(c["provider"].get("version")), -int(c["source"].get("priority", 9999))))


def main() -> int:
    sources = load_json(SOURCES_FILE, [])
    overrides = load_json(OVERRIDES_FILE, {})
    prefer_source = {normalize_key(str(k)): str(v) for k, v in dict(overrides.get("prefer_source", {})).items()}
    keep_separate = {normalize_key(str(x)) for x in overrides.get("keep_separate", [])}
    disable = {normalize_key(str(x)) for x in overrides.get("disable", [])}
    exclude = {normalize_key(str(x)) for x in overrides.get("exclude", [])}
    language_filter = dict(overrides.get("language_filter", {}))

    candidates_by_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    source_status: list[dict[str, Any]] = []
    filtered_out: list[dict[str, Any]] = []
    unknown_language_metadata: list[dict[str, Any]] = []

    for source in sources:
        if not source.get("enabled", True):
            source_status.append({"name": source.get("name"), "status": "disabled"})
            continue
        url = str(source.get("url", "")).strip()
        name = str(source.get("name", url)).strip()
        if not url:
            source_status.append({"name": name, "status": "error", "error": "Missing URL"})
            continue
        try:
            payload = fetch_json(url)
            scrapers = extract_scrapers(payload)
            source_status.append({"name": name, "status": "ok", "providers": len(scrapers)})
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError, ValueError) as exc:
            print(f"WARNING: {name}: {exc}", file=sys.stderr)
            source_status.append({"name": name, "status": "error", "error": str(exc)})
            continue

        for provider in scrapers:
            cleaned = sanitize_provider(provider, url)
            key = provider_key(cleaned)
            if not key or key in exclude or not cleaned.get("filename"):
                continue
            keep_for_language, language_reason, raw_languages, normalized_languages = language_filter_decision(cleaned, language_filter)
            if language_reason == "unknown-language-metadata":
                unknown_language_metadata.append({"id": cleaned.get("id"), "name": cleaned.get("name"), "source": name, "filename": cleaned.get("filename")})
            if not keep_for_language:
                filtered_out.append({"id": cleaned.get("id"), "name": cleaned.get("name"), "source": name, "contentLanguage": raw_languages, "normalizedLanguages": sorted(normalized_languages), "reason": language_reason})
                continue
            if key in keep_separate:
                key = f"{key}::{normalize_key(name)}"
            candidates_by_key[key].append({"provider": cleaned, "source": {"name": name, "url": url, "priority": int(source.get("priority", 9999))}})

    winners: list[dict[str, Any]] = []
    duplicate_report: dict[str, Any] = {}
    for key, candidates in sorted(candidates_by_key.items()):
        winner = choose_candidate(key.split("::", 1)[0], candidates, prefer_source)
        chosen = dict(winner["provider"])
        if key.split("::", 1)[0] in disable:
            chosen["enabled"] = False
        winners.append(chosen)
        if len(candidates) > 1:
            duplicate_report[key] = {
                "chosen": {"id": winner["provider"].get("id"), "name": winner["provider"].get("name"), "version": winner["provider"].get("version"), "source": winner["source"]["name"], "filename": winner["provider"].get("filename")},
                "candidates": [
                    {"id": c["provider"].get("id"), "name": c["provider"].get("name"), "version": c["provider"].get("version"), "source": c["source"]["name"], "filename": c["provider"].get("filename")}
                    for c in sorted(candidates, key=lambda c: (version_tuple(c["provider"].get("version")), -int(c["source"].get("priority", 9999))), reverse=True)
                ],
            }

    winners.sort(key=lambda p: str(p.get("name") or p.get("id") or "").lower())
    manifest = {"name": "Limitless Nuviostream", "version": "1.0.0", "description": "Deduplicated Nuvio providers focused on English, Japanese, Korean, and Chinese content.", "scrapers": winners}
    filter_report = {
        "filter": {"enabled": bool(language_filter.get("enabled", False)), "allowed": list(language_filter.get("allowed", [])), "keep_unknown": bool(language_filter.get("keep_unknown", True))},
        "excluded_count": len(filtered_out),
        "excluded": sorted(filtered_out, key=lambda x: (str(x.get("name") or "").lower(), str(x.get("source") or "").lower())),
        "unknown_language_metadata_count": len(unknown_language_metadata),
        "unknown_language_metadata": sorted(unknown_language_metadata, key=lambda x: (str(x.get("name") or "").lower(), str(x.get("source") or "").lower())),
    }

    MANIFEST_FILE.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    DUPLICATES_FILE.write_text(json.dumps(duplicate_report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    FILTER_REPORT_FILE.write_text(json.dumps(filter_report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    STATUS_FILE.write_text(json.dumps({"source_status": source_status, "unique_providers": len(winners), "duplicate_groups": len(duplicate_report), "language_filtered_entries": len(filtered_out), "unknown_language_metadata_entries": len(unknown_language_metadata), "allowed_languages": list(language_filter.get("allowed", []))}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    ok_sources = sum(1 for x in source_status if x.get("status") == "ok")
    failed_sources = sum(1 for x in source_status if x.get("status") == "error")
    print(f"Built {len(winners)} unique providers from {ok_sources} source repositories.")
    print(f"Deduplicated {len(duplicate_report)} overlapping provider IDs.")
    print(f"Language filter removed {len(filtered_out)} provider entries that had no English/Japanese/Korean/Chinese metadata.")
    if unknown_language_metadata:
        print(f"Kept {len(unknown_language_metadata)} provider entries with missing language metadata for manual review.")
    if failed_sources:
        print(f"WARNING: {failed_sources} source repository/repositories failed; refusing to publish a partial manifest.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
