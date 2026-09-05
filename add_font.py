"""
Incrementally add one batch of fonts to the live library.

Used by the admin panel: a full organize + reindex takes minutes, while a
new upload only touches a handful of families. This files the new files into
SmartOrganizedPlus using the same taxonomy, then merges just the affected
families into fonts.json and refreshes their zip bundles.

Classification and metadata logic is imported from the existing scripts
rather than duplicated, so an upload is categorised exactly like a font that
arrived through the full pipeline.

Usage:  python add_font.py "<folder of new fonts>"
Prints a JSON report on stdout.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path

from fontTools.ttLib import TTFont

import build_index as BI
import organize_all_fonts as ORG

ROOT = Path(__file__).resolve().parent
FINAL = ROOT / "SmartOrganizedPlus"
CATALOG = ROOT / "fonts.json"
DOWNLOADS = ROOT / "_downloads"
INDEXABLE = {".ttf", ".otf", ".woff", ".woff2"}   # what the site can render


def existing_hashes() -> set[str]:
    """Content hashes already in the library, so re-uploads are not duplicated."""
    out = set()
    for p in FINAL.rglob("*"):
        if p.is_file() and p.suffix.lower() in ORG.FONT_EXTS:
            try:
                out.add(hashlib.sha256(p.read_bytes()).hexdigest())
            except OSError:
                pass
    return out


def file_entry(path: Path) -> dict | None:
    """Read one font the way build_index.py does."""
    try:
        font = TTFont(str(path), fontNumber=0, lazy=True, checkChecksums=0)
    except Exception:
        return None
    try:
        name_table = font["name"] if "name" in font else None
        family = BI.best_name(name_table, BI.NAME_IDS_FAMILY)
        subfamily = BI.best_name(name_table, BI.NAME_IDS_SUB) or "Regular"
        full_name = BI.best_name(name_table, BI.NAME_IDS_FULL)
        family = BI.clean_family(family, path.stem)
        rel_parts = path.relative_to(FINAL).parts
        script_hint = rel_parts[0] if rel_parts else ""
        style_hint = rel_parts[1] if len(rel_parts) > 1 else ""
        return {
            "family": family,
            "subfamily": subfamily,
            "fullName": full_name or f"{family} {subfamily}",
            "langs": BI.classify_languages(font, family, script_hint),
            "weight": BI.guess_weight(font, subfamily),
            "italic": BI.guess_italic(font, subfamily),
            "style": BI.STYLE_LABELS.get(style_hint),
            "format": path.suffix.lower().lstrip("."),
            "path": str(path.relative_to(ROOT)).replace("\\", "/"),
            "size": path.stat().st_size,
        }
    except Exception:
        return None
    finally:
        try:
            font.close()
        except Exception:
            pass


def rebuild_zip(fam: dict) -> None:
    all_files = [f for v in fam["variants"] for f in v["files"]]
    if len(all_files) < 2:
        fam["zip"] = None
        return
    DOWNLOADS.mkdir(exist_ok=True)
    zip_path = DOWNLOADS / f"{fam['slug']}.zip"
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            used = set()
            for f in all_files:
                arc = os.path.basename(f["path"])
                if arc in used:
                    arc = f"{f['format']}_{arc}"
                used.add(arc)
                zf.write(ROOT / f["path"], arc)
        fam["zip"] = f"_downloads/{zip_path.name}"
    except Exception:
        fam["zip"] = None


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: add_font.py <folder>"}))
        return 2
    incoming = Path(sys.argv[1])
    if not incoming.is_dir():
        print(json.dumps({"ok": False, "error": "folder not found"}))
        return 2

    candidates = [p for p in sorted(incoming.rglob("*"))
                  if p.is_file() and p.suffix.lower() in ORG.FONT_EXTS
                  and not p.name.startswith("._")]
    if not candidates:
        print(json.dumps({"ok": False, "error": "no font files in upload"}))
        return 1

    seen = existing_hashes()
    placed: list[Path] = []
    duplicates = 0

    for src in candidates:
        try:
            h = hashlib.sha256(src.read_bytes()).hexdigest()
        except OSError:
            continue
        if h in seen:
            duplicates += 1
            continue
        seen.add(h)

        script, style, weight, family, variant, fmt, _sub = ORG.read_font(src)
        folder = FINAL / script / style / weight / family / variant / fmt
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / src.name
        n = 1
        while dest.exists():
            n += 1
            dest = folder / f"{src.stem} [v{n}]{src.suffix}"
        try:
            dest.hardlink_to(src)
        except OSError:
            shutil.copy2(src, dest)
        placed.append(dest)

    # Merge the newly placed files into the catalog.
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    families = data["families"]
    by_key = {f["family"].lower(): f for f in families}
    touched: dict[str, dict] = {}

    for dest in placed:
        if dest.suffix.lower() not in INDEXABLE:
            continue  # e.g. .eot is archived but never listed on the site
        e = file_entry(dest)
        if not e:
            continue
        key = e["family"].lower()
        fam = by_key.get(key)
        if fam is None:
            fam = {
                "slug": BI.slugify(e["family"]), "family": e["family"],
                "langs": [], "styles": [], "collections": [],
                "variants": [], "zip": None,
            }
            by_key[key] = fam
            families.append(fam)

        fam["langs"] = sorted(set(fam["langs"]) | set(e["langs"]))
        if e["style"]:
            fam["styles"] = sorted(set(fam["styles"]) | {e["style"]})
        fam["collections"] = BI.collections_for(fam["family"])

        variant = next((v for v in fam["variants"]
                        if v["weight"] == e["weight"] and v["italic"] == e["italic"]
                        and v["subfamily"].strip().lower() == e["subfamily"].strip().lower()), None)
        if variant is None:
            variant = {"weight": e["weight"], "italic": e["italic"],
                       "subfamily": e["subfamily"], "fullName": e["fullName"], "files": []}
            fam["variants"].append(variant)
        variant["files"] = [f for f in variant["files"] if f["format"] != e["format"]]
        variant["files"].append({"format": e["format"], "path": e["path"], "size": e["size"]})
        touched[key] = fam

    for fam in touched.values():
        fam["variants"].sort(key=lambda v: (v["weight"], v["italic"], v["subfamily"].lower()))
        rebuild_zip(fam)

    families.sort(key=lambda f: f["family"].lower())
    data["families"] = families
    data["collections"] = BI.collections_meta(families)
    CATALOG.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "added": len(placed),
        "duplicates": duplicates,
        "families": sorted({f["family"] for f in touched.values()}),
        "totalFamilies": len(families),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
