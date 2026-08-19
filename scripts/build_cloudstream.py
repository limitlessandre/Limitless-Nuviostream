#!/usr/bin/env python3
"""Build a filtered CloudStream repository for NuvioTV.

The builder reads CloudStream's repository database, follows each repo.json and
plugins.json, keeps only desired languages, removes duplicates, and preserves
upstream .cs3 URLs. No provider binaries are copied into this repository.

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
CONFIG_FILE = ROOT / "cloudstream-config.json"
REPO_FILE = ROOT / "cloudstream-repo.json"
PLUGINS_FILE = ROOT / "cloudstream-plugins.json"
DUPLICATES_FILE = ROOT / "cloudstream-duplicates.json"
STATUS_FILE = ROOT / "cloudstream-build-status.json"
LANGUAGE_REPORT_FILE = ROOT / "cloudstream-language-filter-report.json"
CACHE_FILE = ROOT / "cloudstream-source-cache.json"

USER_AGENT = "Limitless-Nuviostream/1.0 (+GitHub Actions)"
TIMEOUT_SECONDS = 30
MAX_RESPONSE_BYTES = 15 * 1024 * 1024

LANGUAGE_ALIASES = {
    "en": "en", "eng": "en", "english": "en",
    "ja": "ja", "jp": "ja", "jpn": "ja", "japanese": "ja",
    "ko": "ko", "kr": "ko", "kor": "ko", "korean": "ko",
    "zh": "zh", "cn": "zh", "chi": "zh", "zho": "zh", "chinese": "zh",
    "mandarin": "zh", "cmn": "zh", "zh-cn": "zh", "zh-tw": "zh",
    "zh-hans": "zh", "zh-hant": "zh",
    "all": "multi", "any": "multi", "multi": "multi", "multilingual": "multi",
    "mul": "multi", "*": "multi",
}


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def fetch_text(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
        declared = response.headers.get("Content-Length")
        if declared and int(declared) > MAX_RESPONSE_BYTES:
            raise ValueError(f"Response too large: {declared} bytes")
        data = response.read(MAX_RESPONSE_BYTES + 1)
        if len(data) > MAX_RESPONSE_BYTES:
            raise ValueError(f"Response exceeded {MAX_RESPONSE_BYTES} bytes")
        charset = response.headers.get_content_charset() or "utf-8"
    return data.decode(charset, errors="replace")


def fetch_json(url: str) -> Any:
    return json.loads(fetch_text(url))


def normalize_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


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


def plugin_languages(plugin: dict[str, Any]) -> tuple[list[str], set[str]]:
    value: Any = None
    for field in ("language", "languages", "contentLanguage", "contentLanguages"):
        if field in plugin:
            value = plugin.get(field)
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


def version_number(value: Any) -> int:
    if isinstance(value, int):
        return value
    nums = re.findall(r"\d+", str(value or "0"))
    if not nums:
        return 0
    # CloudStream versions are normally integers. If a dotted value appears,
    # preserve ordering by packing the first few numeric components.
    packed = 0
    for part in nums[:4]:
        packed = packed * 1000 + min(int(part), 999)
    return packed


def resolve_url(base_url: str, value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return urljoin(base_url, text)


def repo_database_entries(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        raise ValueError("Repository database must be a JSON array")
    entries: list[dict[str, Any]] = []
    for index, item in enumerate(payload):
        if isinstance(item, str):
            url = item.strip()
            verified = False
        elif isinstance(item, dict):
            url = str(item.get("url") or "").strip()
            verified = bool(item.get("verified", False))
        else:
            continue
        if url.startswith(("http://", "https://")):
            entries.append({"url": url, "verified": verified, "index": index})
    return entries


def normalize_plugin(plugin: dict[str, Any], plugin_list_url: str) -> dict[str, Any]:
    item = dict(plugin)
    item["url"] = resolve_url(plugin_list_url, item.get("url"))
    repository_url = item.get("repositoryUrl")
    if repository_url:
        item["repositoryUrl"] = resolve_url(plugin_list_url, repository_url)
    return item


def parse_repo(repo_url: str) -> tuple[str, str | None, list[dict[str, Any]]]:
    payload = fetch_json(repo_url)

    if isinstance(payload, list):
        plugins = [normalize_plugin(x, repo_url) for x in payload if isinstance(x, dict)]
        return infer_repo_name(repo_url), None, plugins

    if not isinstance(payload, dict):
        raise ValueError("Unsupported repository JSON shape")

    name = str(payload.get("name") or infer_repo_name(repo_url))
    description = payload.get("description")

    plugin_lists = payload.get("pluginLists")
    if isinstance(plugin_lists, list) and plugin_lists:
        plugins: list[dict[str, Any]] = []
        for list_value in plugin_lists:
            list_url = resolve_url(repo_url, list_value)
            list_payload = fetch_json(list_url)
            if not isinstance(list_payload, list):
                raise ValueError(f"Plugin list is not an array: {list_url}")
            plugins.extend(
                normalize_plugin(x, list_url) for x in list_payload if isinstance(x, dict)
            )
        return name, str(description) if description is not None else None, plugins

    direct_plugins = payload.get("plugins")
    if isinstance(direct_plugins, list):
        plugins = [normalize_plugin(x, repo_url) for x in direct_plugins if isinstance(x, dict)]
        return name, str(description) if description is not None else None, plugins

    raise ValueError("No pluginLists or plugins array found")


def infer_repo_name(url: str) -> str:
    tail = url.rstrip("/").split("/")[-1]
    return tail.removesuffix(".json") or "CloudStream Repository"


def candidate_score(candidate: dict[str, Any]) -> tuple[int, int, int]:
    plugin = candidate["plugin"]
    return (
        version_number(plugin.get("version")),
        1 if candidate.get("verified") else 0,
        -int(candidate.get("source_index", 999999)),
    )


def candidate_summary(candidate: dict[str, Any]) -> dict[str, Any]:
    plugin = candidate["plugin"]
    return {
        "internalName": plugin.get("internalName"),
        "name": plugin.get("name"),
        "version": plugin.get("version"),
        "language": plugin.get("language"),
        "source": candidate.get("source_name"),
        "sourceRepo": candidate.get("source_repo"),
        "verifiedRepo": bool(candidate.get("verified")),
        "url": plugin.get("url"),
    }


def dedupe_candidates(candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    # First pass: CloudStream's internalName is the closest thing to a provider ID.
    by_internal: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        plugin = candidate["plugin"]
        key = normalize_key(plugin.get("internalName") or plugin.get("name"))
        if key:
            by_internal[key].append(candidate)

    first_winners: list[dict[str, Any]] = []
    report: dict[str, Any] = {}
    for key, group in sorted(by_internal.items()):
        winner = max(group, key=candidate_score)
        first_winners.append(winner)
        if len(group) > 1:
            report[f"internal:{key}"] = {
                "chosen": candidate_summary(winner),
                "candidates": [candidate_summary(x) for x in sorted(group, key=candidate_score, reverse=True)],
            }

    # Second pass: some repositories publish the same provider under a different
    # internalName. Collapse exact normalized display-name aliases as well.
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in first_winners:
        plugin = candidate["plugin"]
        key = normalize_key(plugin.get("name") or plugin.get("internalName"))
        if key:
            by_name[key].append(candidate)

    final_winners: list[dict[str, Any]] = []
    for key, group in sorted(by_name.items()):
        winner = max(group, key=candidate_score)
        final_winners.append(winner)
        if len(group) > 1:
            report[f"name:{key}"] = {
                "chosen": candidate_summary(winner),
                "candidates": [candidate_summary(x) for x in sorted(group, key=candidate_score, reverse=True)],
            }

    return final_winners, report


def main() -> int:
    config = load_json(CONFIG_FILE, {})
    database_url = str(config.get("repo_database_url") or "").strip()
    generated_plugins_url = str(config.get("generated_plugins_url") or "").strip()
    allowed = {normalize_language(x) for x in config.get("allowed_languages", [])}
    allowed.discard("")
    keep_unknown = bool(config.get("keep_unknown_language", True))
    keep_multilingual = bool(config.get("keep_multilingual", True))
    include_inactive = bool(config.get("include_inactive", False))
    excluded_names = {normalize_key(x) for x in config.get("exclude_internal_names", [])}
    excluded_repos = {str(x).strip().rstrip("/").lower() for x in config.get("exclude_repo_urls", [])}

    if not database_url or not generated_plugins_url:
        print("ERROR: cloudstream-config.json is missing required URLs", file=sys.stderr)
        return 2

    try:
        database_payload = fetch_json(database_url)
        repo_entries = repo_database_entries(database_payload)
    except Exception as exc:
        print(f"ERROR: failed to load CloudStream repository database: {exc}", file=sys.stderr)
        return 2

    old_cache = load_json(CACHE_FILE, {})
    if not isinstance(old_cache, dict):
        old_cache = {}
    new_cache: dict[str, Any] = {}

    source_status: list[dict[str, Any]] = []
    all_candidates: list[dict[str, Any]] = []
    raw_plugin_entries = 0
    filtered_languages: list[dict[str, Any]] = []
    unknown_languages: list[dict[str, Any]] = []
    inactive_filtered = 0
    meta_filtered = 0

    for entry in repo_entries:
        repo_url = entry["url"]
        if repo_url.rstrip("/").lower() in excluded_repos:
            source_status.append({"url": repo_url, "status": "excluded-meta-repository"})
            continue

        repo_name = infer_repo_name(repo_url)
        description: str | None = None
        plugins: list[dict[str, Any]] | None = None
        try:
            repo_name, description, plugins = parse_repo(repo_url)
            new_cache[repo_url] = {
                "name": repo_name,
                "description": description,
                "plugins": plugins,
            }
            source_status.append({
                "name": repo_name,
                "url": repo_url,
                "status": "ok",
                "plugins": len(plugins),
                "verified": bool(entry.get("verified")),
            })
        except Exception as exc:
            cached = old_cache.get(repo_url)
            if isinstance(cached, dict) and isinstance(cached.get("plugins"), list):
                repo_name = str(cached.get("name") or repo_name)
                description = cached.get("description")
                plugins = [x for x in cached.get("plugins", []) if isinstance(x, dict)]
                new_cache[repo_url] = cached
                source_status.append({
                    "name": repo_name,
                    "url": repo_url,
                    "status": "cached",
                    "plugins": len(plugins),
                    "verified": bool(entry.get("verified")),
                    "error": str(exc),
                })
            else:
                source_status.append({
                    "name": repo_name,
                    "url": repo_url,
                    "status": "error",
                    "verified": bool(entry.get("verified")),
                    "error": str(exc),
                })
                continue

        assert plugins is not None
        raw_plugin_entries += len(plugins)
        for plugin in plugins:
            internal_name = normalize_key(plugin.get("internalName") or plugin.get("name"))
            if not internal_name or internal_name in excluded_names:
                meta_filtered += 1
                continue

            url = str(plugin.get("url") or "").strip()
            if not url.startswith(("http://", "https://")):
                continue

            status = plugin.get("status", 1)
            try:
                active = int(status) == 1
            except (TypeError, ValueError):
                active = True
            if not include_inactive and not active:
                inactive_filtered += 1
                continue

            raw_languages, normalized_languages = plugin_languages(plugin)
            if not normalized_languages:
                unknown_entry = {
                    "internalName": plugin.get("internalName"),
                    "name": plugin.get("name"),
                    "source": repo_name,
                    "sourceRepo": repo_url,
                    "url": url,
                }
                unknown_languages.append(unknown_entry)
                if not keep_unknown:
                    filtered_languages.append({**unknown_entry, "reason": "unknown-language"})
                    continue
            else:
                permitted = bool(normalized_languages & allowed)
                if keep_multilingual and "multi" in normalized_languages:
                    permitted = True
                if not permitted:
                    filtered_languages.append({
                        "internalName": plugin.get("internalName"),
                        "name": plugin.get("name"),
                        "source": repo_name,
                        "sourceRepo": repo_url,
                        "language": raw_languages,
                        "normalizedLanguages": sorted(normalized_languages),
                        "url": url,
                        "reason": "no-allowed-language",
                    })
                    continue

            all_candidates.append({
                "plugin": plugin,
                "source_name": repo_name,
                "source_repo": repo_url,
                "verified": bool(entry.get("verified")),
                "source_index": int(entry.get("index", 999999)),
            })

    winners, duplicate_report = dedupe_candidates(all_candidates)
    plugins = [dict(x["plugin"]) for x in winners]
    plugins.sort(key=lambda x: str(x.get("name") or x.get("internalName") or "").lower())

    if not plugins:
        print("ERROR: CloudStream build produced zero plugins; refusing to publish", file=sys.stderr)
        return 2

    repo_manifest = {
        "name": "Limitless CloudStream",
        "description": "Deduplicated CloudStream extensions focused on English, Japanese, Korean, and Chinese content for NuvioTV.",
        "manifestVersion": 1,
        "pluginLists": [generated_plugins_url],
    }

    language_report = {
        "allowed": sorted(allowed),
        "keep_unknown_language": keep_unknown,
        "keep_multilingual": keep_multilingual,
        "excluded_count": len(filtered_languages),
        "excluded": sorted(filtered_languages, key=lambda x: (str(x.get("name") or "").lower(), str(x.get("source") or "").lower())),
        "unknown_language_metadata_count": len(unknown_languages),
        "unknown_language_metadata": sorted(unknown_languages, key=lambda x: (str(x.get("name") or "").lower(), str(x.get("source") or "").lower())),
    }

    loaded = sum(1 for x in source_status if x.get("status") == "ok")
    cached = sum(1 for x in source_status if x.get("status") == "cached")
    failed = sum(1 for x in source_status if x.get("status") == "error")
    excluded_repo_count = sum(1 for x in source_status if x.get("status") == "excluded-meta-repository")

    status_report = {
        "repository_database_url": database_url,
        "repository_database_entries": len(repo_entries),
        "repositories_loaded": loaded,
        "repositories_using_cache": cached,
        "repositories_failed_without_cache": failed,
        "repositories_excluded_as_meta": excluded_repo_count,
        "raw_plugin_entries": raw_plugin_entries,
        "eligible_plugin_entries_before_dedupe": len(all_candidates),
        "unique_plugins": len(plugins),
        "duplicate_groups": len(duplicate_report),
        "language_filtered_entries": len(filtered_languages),
        "unknown_language_metadata_entries": len(unknown_languages),
        "inactive_filtered_entries": inactive_filtered,
        "meta_plugin_entries_filtered": meta_filtered,
        "allowed_languages": sorted(allowed),
        "source_status": source_status,
    }

    write_json(REPO_FILE, repo_manifest)
    write_json(PLUGINS_FILE, plugins)
    write_json(DUPLICATES_FILE, duplicate_report)
    write_json(LANGUAGE_REPORT_FILE, language_report)
    write_json(STATUS_FILE, status_report)
    write_json(CACHE_FILE, new_cache)

    print(f"CloudStream: scanned {len(repo_entries)} repository database entries.")
    print(f"CloudStream: loaded {loaded} repos, used cache for {cached}, failed without cache {failed}.")
    print(f"CloudStream: collected {raw_plugin_entries} raw plugin entries.")
    print(f"CloudStream: kept {len(plugins)} unique plugins after filtering and deduplication.")
    print(f"CloudStream: filtered {len(filtered_languages)} entries by language, {inactive_filtered} inactive, {meta_filtered} meta/installer entries.")
    print(f"CloudStream: deduplicated {len(duplicate_report)} overlapping groups.")

    # Repository-level failures are reported but do not destroy the build. On later
    # runs, the committed source cache preserves the last known good plugin metadata
    # for temporarily unavailable repositories.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
