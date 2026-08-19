#!/usr/bin/env python3
"""Compare the generated CloudStream feed with the native Nuvio feed.

This does not claim that a CloudStream extension can be automatically ported.
It only identifies extensions that appear to add coverage not already represented
by a native Limitless provider, then groups them by likely usefulness.
"""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
NATIVE_FILE = ROOT / "manifest.json"
CLOUD_FILE = ROOT / "cloudstream-plugins.json"
JSON_REPORT = ROOT / "cloudstream-port-candidates.json"
MD_REPORT = ROOT / "cloudstream-port-candidates.md"

GENERIC_SUFFIXES = (
    "provider", "plugin", "extension", "source", "streams", "stream",
)
# Only strip TV when it is clearly a trailing branding suffix. This lets
# AnikotoTV match Anikoto without turning every title containing 'tv' into noise.
OPTIONAL_BRAND_SUFFIXES = ("tv",)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def compact(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def base_forms(value: str) -> set[str]:
    value = compact(value)
    if not value:
        return set()
    forms = {value}
    changed = True
    while changed:
        changed = False
        for suffix in GENERIC_SUFFIXES:
            for form in tuple(forms):
                if form.endswith(suffix) and len(form) > len(suffix) + 2:
                    shorter = form[: -len(suffix)]
                    if shorter and shorter not in forms:
                        forms.add(shorter)
                        changed = True
    for suffix in OPTIONAL_BRAND_SUFFIXES:
        for form in tuple(forms):
            if form.endswith(suffix) and len(form) > len(suffix) + 4:
                forms.add(form[: -len(suffix)])
    return forms


def native_index(scrapers: list[dict[str, Any]]) -> tuple[dict[str, list[dict[str, Any]]], list[tuple[str, dict[str, Any]]]]:
    by_form: dict[str, list[dict[str, Any]]] = {}
    all_forms: list[tuple[str, dict[str, Any]]] = []
    for scraper in scrapers:
        forms = set()
        forms |= base_forms(str(scraper.get("id", "")))
        forms |= base_forms(str(scraper.get("name", "")))
        for form in forms:
            by_form.setdefault(form, []).append(scraper)
            all_forms.append((form, scraper))
    return by_form, all_forms


def best_overlap(plugin: dict[str, Any], by_form: dict[str, list[dict[str, Any]]], all_forms: list[tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    cloud_forms = set()
    cloud_forms |= base_forms(str(plugin.get("internalName", "")))
    cloud_forms |= base_forms(str(plugin.get("name", "")))

    exact_matches: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for form in cloud_forms:
        for match in by_form.get(form, []):
            key = str(match.get("id", ""))
            if key not in seen_ids:
                exact_matches.append(match)
                seen_ids.add(key)

    if exact_matches:
        return {
            "status": "exact-or-alias",
            "score": 1.0,
            "native_matches": [
                {"id": m.get("id"), "name": m.get("name"), "filename": m.get("filename")}
                for m in exact_matches
            ],
        }

    best_score = 0.0
    best_native: dict[str, Any] | None = None
    best_pair: tuple[str, str] | None = None
    for cloud_form in cloud_forms:
        if len(cloud_form) < 4:
            continue
        for native_form, native in all_forms:
            if len(native_form) < 4:
                continue
            score = SequenceMatcher(None, cloud_form, native_form).ratio()
            if score > best_score:
                best_score = score
                best_native = native
                best_pair = (cloud_form, native_form)

    if best_native is not None and best_score >= 0.84:
        return {
            "status": "likely-overlap",
            "score": round(best_score, 3),
            "compared_forms": list(best_pair or ()),
            "native_matches": [{
                "id": best_native.get("id"),
                "name": best_native.get("name"),
                "filename": best_native.get("filename"),
            }],
        }

    return {"status": "no-obvious-overlap", "score": round(best_score, 3), "native_matches": []}


def classify(plugin: dict[str, Any]) -> tuple[str, int, list[str]]:
    types = {str(x).lower() for x in (plugin.get("tvTypes") or [])}
    text = " ".join([
        str(plugin.get("name", "")),
        str(plugin.get("internalName", "")),
        str(plugin.get("description", "")),
    ]).lower()

    reasons: list[str] = []
    score = 0

    if "asiandrama" in types or any(term in text for term in ("asian drama", "k-drama", "kdrama", "korean drama")):
        score += 6
        reasons.append("Asian drama / K-drama coverage")
    if types & {"anime", "animemovie", "ova"} or "anime" in text:
        score += 4
        reasons.append("Anime coverage")
    if types & {"movie", "tvseries"}:
        score += 2
        reasons.append("Movies / Western TV coverage")
    if "cartoon" in types:
        score += 1
        reasons.append("Cartoon coverage")
    if types == {"others"} or (types and types <= {"others"}):
        score -= 4
        reasons.append("Only declares Others")
    if any(term in text for term in ("iptv", "youtube", "twitch", "dailymotion", "sports", "football", "review", "sync")):
        score -= 3
        reasons.append("Likely utility/live/special-purpose extension")

    if score >= 6:
        category = "high-priority"
    elif score >= 3:
        category = "medium-priority"
    elif score >= 1:
        category = "low-priority"
    else:
        category = "utility-or-review"
    return category, score, reasons


def main() -> None:
    native_manifest = load_json(NATIVE_FILE)
    cloud_plugins = load_json(CLOUD_FILE)
    native_scrapers = native_manifest.get("scrapers", [])
    by_form, all_forms = native_index(native_scrapers)

    rows: list[dict[str, Any]] = []
    for plugin in cloud_plugins:
        overlap = best_overlap(plugin, by_form, all_forms)
        category, priority_score, reasons = classify(plugin)
        rows.append({
            "internalName": plugin.get("internalName"),
            "name": plugin.get("name"),
            "description": plugin.get("description"),
            "language": plugin.get("language"),
            "tvTypes": plugin.get("tvTypes") or [],
            "version": plugin.get("version"),
            "url": plugin.get("url"),
            "repositoryUrl": plugin.get("repositoryUrl"),
            "overlap": overlap,
            "priority": category,
            "priority_score": priority_score,
            "reasons": reasons,
        })

    rows.sort(key=lambda r: (
        0 if r["overlap"]["status"] == "no-obvious-overlap" else 1,
        -r["priority_score"],
        str(r.get("name") or "").lower(),
    ))

    unique = [r for r in rows if r["overlap"]["status"] == "no-obvious-overlap"]
    likely = [r for r in rows if r["overlap"]["status"] == "likely-overlap"]
    exact = [r for r in rows if r["overlap"]["status"] == "exact-or-alias"]

    report = {
        "native_provider_count": len(native_scrapers),
        "cloudstream_provider_count": len(cloud_plugins),
        "no_obvious_native_overlap_count": len(unique),
        "likely_overlap_count": len(likely),
        "exact_or_alias_overlap_count": len(exact),
        "method_note": "Name/ID comparison only. A unique result is a port candidate, not proof that the extension can be automatically converted or will work in Nuvio JS.",
        "candidates": rows,
    }
    JSON_REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    lines = [
        "# CloudStream → Nuvio port candidate audit",
        "",
        f"Native Limitless providers: **{len(native_scrapers)}**  ",
        f"Filtered CloudStream providers: **{len(cloud_plugins)}**  ",
        f"No obvious native overlap: **{len(unique)}**  ",
        f"Likely overlap requiring review: **{len(likely)}**  ",
        f"Exact/alias overlap: **{len(exact)}**",
        "",
        "> This is a coverage audit, not an automatic-conversion guarantee. Portability must be checked against each extension's Kotlin source and its CloudStream API dependencies.",
        "",
    ]

    for heading, subset in (
        ("High-priority unique candidates", [r for r in unique if r["priority"] == "high-priority"]),
        ("Medium-priority unique candidates", [r for r in unique if r["priority"] == "medium-priority"]),
        ("Low-priority unique candidates", [r for r in unique if r["priority"] == "low-priority"]),
        ("Utility / manual-review unique candidates", [r for r in unique if r["priority"] == "utility-or-review"]),
        ("Likely native overlaps to review", likely),
        ("Exact or alias overlaps", exact),
    ):
        lines += [f"## {heading}", ""]
        if not subset:
            lines += ["None.", ""]
            continue
        for row in subset:
            types = ", ".join(row["tvTypes"]) or "unspecified"
            lang = row.get("language") or "unknown"
            desc = (row.get("description") or "").strip().replace("\n", " ")
            if len(desc) > 160:
                desc = desc[:157] + "..."
            line = f"- **{row.get('name') or row.get('internalName')}** (`{row.get('internalName')}`) — {lang}; {types}"
            if desc:
                line += f" — {desc}"
            if row["overlap"]["native_matches"]:
                names = ", ".join(str(m.get("name")) for m in row["overlap"]["native_matches"])
                line += f" — native match: {names}"
            lines.append(line)
        lines.append("")

    MD_REPORT.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    print(f"Native providers: {len(native_scrapers)}")
    print(f"CloudStream providers: {len(cloud_plugins)}")
    print(f"No obvious overlap: {len(unique)}")
    print(f"Likely overlap: {len(likely)}")
    print(f"Exact/alias overlap: {len(exact)}")


if __name__ == "__main__":
    main()
