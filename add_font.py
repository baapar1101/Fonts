"""
Incrementally add one batch of fonts to the live library.

Used by the admin panel: a full organize + reindex takes minutes, while a
new upload only touches a handful of families. This files the new files into
SmartOrganizedPlus using the same taxonomy, then merges just the affected
families into fonts.json and refreshes their zip bundles.

Classification and metadata logic is imported from the existing scripts
rather than duplicated, so an upload is categorised exactly like a font that
arrived through the full pipeline.

Usage:  python add_font.py "<folder of new fonts>" [--source LABEL] [--keep-existing]

  --source LABEL   Record LABEL as the raw source folder for everything in
                   this batch, so the fonts join the matching source
                   collection (see SOURCE_COLLECTIONS in build_index.py) and
                   the provenance survives in SmartOrganizedPlus/INDEX.json.
  --keep-existing  Never displace a file already listed in the catalog: when
                   a family/variant/format slot is taken, the imported file
                   is filed on disk but the existing entry stays. Use it for
                   bulk imports; a re-upload of a corrected file should not.

Prints a JSON report on stdout; progress goes to stderr.
"""
from __future__ import annotations

import csv
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
INDEX_JSON = FINAL / "INDEX.json"
INDEX_CSV = FINAL / "INDEX.csv"
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


def append_index_rows(rows: list[dict]) -> None:
    """Record the batch in SmartOrganizedPlus/INDEX.{json,csv}.

    build_index.py reads INDEX.json to work out which raw folder each font
    came from, which is what drives the source collections. Without this the
    provenance would live only in fonts.json and a later full re-index would
    quietly drop it.
    """
    if not rows or not INDEX_JSON.is_file():
        return
    existing = json.loads(INDEX_JSON.read_text(encoding="utf-8"))
    known = {r.get("file", "").replace("\\", "/") for r in existing}
    fresh = [r for r in rows if r["file"].replace("\\", "/") not in known]
    if not fresh:
        return
    existing.extend(fresh)
    INDEX_JSON.write_text(json.dumps(existing, ensure_ascii=False, indent=2),
                          encoding="utf-8")
    # The CSV is the same table with the folder list flattened to a scalar.
    fields = list(existing[0])
    with INDEX_CSV.open("a", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writerows([{**r, "source_folders": " | ".join(r["source_folders"])}
                          for r in fresh])


def main() -> int:
    argv = sys.argv[1:]
    args: list[str] = []
    source_label = ""
    keep_existing = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--source" and i + 1 < len(argv):
            source_label = argv[i + 1]
            i += 2
        elif a.startswith("--source="):
            source_label = a.split("=", 1)[1]
            i += 1
        elif a == "--keep-existing":
            keep_existing = True
            i += 1
        else:
            args.append(a)
            i += 1

    if not args:
        print(json.dumps({"ok": False, "error": "usage: add_font.py <folder> "
                                                "[--source LABEL] [--keep-existing]"}))
        return 2
    incoming = Path(args[0])
    if not incoming.is_dir():
        print(json.dumps({"ok": False, "error": "folder not found"}))
        return 2

    candidates = [p for p in sorted(incoming.rglob("*"))
                  if p.is_file() and p.suffix.lower() in ORG.FONT_EXTS
                  and not p.name.startswith("._")]
    if not candidates:
        print(json.dumps({"ok": False, "error": "no font files in upload"}))
        return 1

    print(f"hashing the existing library…", file=sys.stderr, flush=True)
    seen = existing_hashes()
    placed: list[Path] = []
    index_rows: list[dict] = []
    duplicates = 0

    for i, src in enumerate(candidates, 1):
        if i % 250 == 0:
            print(f"filed {i}/{len(candidates)}", file=sys.stderr, flush=True)
        try:
            h = hashlib.sha256(src.read_bytes()).hexdigest()
        except OSError:
            continue
        if h in seen:
            duplicates += 1
            continue
        seen.add(h)

        script, style, weight, family, variant, fmt, sub = ORG.read_font(src)
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
        try:
            source_rel = str(src.resolve().relative_to(ROOT))
        except ValueError:
            source_rel = str(src)   # staged outside the project tree
        index_rows.append({
            "script": script, "style": style, "weight": weight, "family": family,
            "subfamily": sub, "variant": variant, "format": fmt,
            "file": str(dest.relative_to(FINAL)), "source": source_rel,
            "source_folders": [source_label] if source_label else
                              [Path(source_rel).parts[0]] if source_rel else [],
            "duplicate_count": 0,
            "sha256": h,
        })

    # Merge the newly placed files into the catalog.
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    families = data["families"]
    by_key = {f["family"].lower(): f for f in families}
    touched: dict[str, dict] = {}
    shadowed: list[str] = []

    print(f"indexing {len(placed)} new files…", file=sys.stderr, flush=True)
    for i, dest in enumerate(placed, 1):
        if i % 250 == 0:
            print(f"indexed {i}/{len(placed)}", file=sys.stderr, flush=True)
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
        # Union rather than overwrite: recomputing from the name alone would
        # strip the source-pack tags a family already carries.
        fam["collections"] = sorted(
            set(fam.get("collections", []))
            | set(BI.collections_for(fam["family"],
                                     [source_label] if source_label else ()))
        )

        variant = next((v for v in fam["variants"]
                        if v["weight"] == e["weight"] and v["italic"] == e["italic"]
                        and v["subfamily"].strip().lower() == e["subfamily"].strip().lower()), None)
        if variant is None:
            variant = {"weight": e["weight"], "italic": e["italic"],
                       "subfamily": e["subfamily"], "fullName": e["fullName"], "files": []}
            fam["variants"].append(variant)
        held = next((f for f in variant["files"] if f["format"] == e["format"]), None)
        if held is not None and keep_existing and held["path"] != e["path"]:
            # Slot already filled by a font the library had first. The import
            # stays on disk, but the catalog keeps pointing at the older file.
            shadowed.append(e["path"])
            continue
        variant["files"] = [f for f in variant["files"] if f["format"] != e["format"]]
        variant["files"].append({"format": e["format"], "path": e["path"], "size": e["size"]})
        touched[key] = fam

    print(f"zipping {len(touched)} families…", file=sys.stderr, flush=True)
    for i, fam in enumerate(touched.values(), 1):
        if i % 250 == 0:
            print(f"zipped {i}/{len(touched)}", file=sys.stderr, flush=True)
        fam["variants"].sort(key=lambda v: (v["weight"], v["italic"], v["subfamily"].lower()))
        rebuild_zip(fam)

    families.sort(key=lambda f: f["family"].lower())
    data["families"] = families
    data["collections"] = BI.collections_meta(families)
    CATALOG.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")
    append_index_rows(index_rows)

    report = {
        "ok": True,
        "added": len(placed),
        "duplicates": duplicates,
        "shadowed": len(shadowed),
        "families": sorted({f["family"] for f in touched.values()}),
        "totalFamilies": len(families),
    }
    if len(report["families"]) > 200:
        # A bulk import lists thousands of names; the count is the useful part.
        report["families"] = report["families"][:200] + ["…"]
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
