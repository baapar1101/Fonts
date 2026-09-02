"""
Consolidated font organizer.

Scans every raw/source folder in this collection (including the newest
imports: Iranfont, NEW, 384.Font.Farsi, 500.Font.Collection, Farsi,
downloads, and _Incoming), removes exact byte-for-byte duplicates, then
rebuilds SmartOrganizedPlus using a script / style / weight / family /
variant / format hierarchy inferred from each font's own metadata.

Drop newly downloaded fonts into "_Incoming" at any time, then re-run this
script followed by build_index.py to fold them into the site.

Run from this directory:
    python organize_all_fonts.py
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
import time
from collections import defaultdict
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "SmartOrganizedPlus"
FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2", ".eot"}

# Every folder that may hold raw/imported font files. Generated output
# folders (Organized, SmartOrganized, SmartOrganizedPlus, _downloads) are
# deliberately excluded so re-runs never re-ingest their own output.
RAW_SOURCES = [
    "Arabic", "English", "Fonts", "+Mixed Fonts", "+Unsorted",
    "384.Font.Farsi", "500.Font.Collection", "Farsi", "Iranfont", "NEW",
    "downloads", "_Incoming",
]

NON_FAMILY_DIR_NAMES = {
    "ttf", "otf", "woff", "woff2", "eot", "fonts", "font", "static",
    "regular", "files", "src", "web", "webfont", "webfonts", "desktop",
    "for windows", "for mac", "truetype", "opentype",
}


def clean(value: str) -> str:
    value = re.sub(r"[\x00-\x1f<>:\"/\\|?*]", "_", value).strip(" .")
    return value or "Unknown"


RAW_SOURCE_NAMES = {name.lower() for name in RAW_SOURCES}


def fallback_family(path: Path) -> str:
    for parent in path.parents:
        if parent == ROOT:
            break
        name_lower = parent.name.lower()
        if name_lower in NON_FAMILY_DIR_NAMES:
            continue
        if name_lower in RAW_SOURCE_NAMES:
            # File sits loose at the top of a raw dump with no per-family
            # folder of its own — the collection name is not a font family.
            break
        return parent.name
    return path.stem


def read_font(path: Path) -> tuple[str, str, str, str, str, str, str]:
    family = fallback_family(path)
    subfamily = path.stem
    script = "05-Other"
    variable = False
    try:
        font = TTFont(str(path), lazy=True)
        names = font["name"].names
        vals = {}
        for rec in names:
            if rec.nameID in (1, 2, 16, 17) and rec.nameID not in vals:
                try:
                    vals[rec.nameID] = rec.toUnicode().strip()
                except Exception:
                    pass
        family = vals.get(16) or vals.get(1) or family
        subfamily = vals.get(17) or vals.get(2) or subfamily
        cmap = set()
        for table in font["cmap"].tables:
            cmap.update(table.cmap.keys())
        arabic = sum(1 for c in cmap if 0x600 <= c <= 0x8FF or 0xFB50 <= c <= 0xFDFF)
        latin = sum(1 for c in cmap if 0x41 <= c <= 0x24F)
        persian = sum(1 for c in cmap if c in {0x067E, 0x0686, 0x0698, 0x06AF, 0x06CC})
        if arabic >= 10 and latin >= 10:
            script = "03-Mixed"
        elif arabic >= 10:
            script = "01-Persian-Arabic" if persian else "02-Arabic"
        elif latin >= 10:
            script = "04-Latin"
        variable = "fvar" in font
        font.close()
    except Exception:
        low = f"{family} {subfamily}".lower()
        if any(x in low for x in ("arab", "pers", "iran", "farsi")):
            script = "01-Persian-Arabic"
        elif re.search(r"[a-z]", low):
            script = "04-Latin"
        variable = "variable" in path.name.lower() or "vf" in path.stem.lower()

    low = f"{family} {subfamily}".lower()
    if any(x in low for x in ("mono", "monospace", "code", "terminal")):
        style = "04-Monospace"
    elif any(x in low for x in ("script", "hand", "callig", "shah", "nast", "shekaste", "tahrir")):
        style = "03-Handwriting"
    elif any(x in low for x in ("serif", "times", "roman", "baskerville", "garamond")):
        style = "02-Serif"
    elif any(x in low for x in ("display", "poster", "headline", "decor", "ornament", "stencil", "graffiti")):
        style = "05-Display-Decorative"
    elif any(x in low for x in ("sans", "grotesk", "gothic", "modern", "naskh", "kufi")):
        style = "01-Sans-Modern"
    else:
        style = "06-General"

    weights = [
        ("01-Thin", ("thin", "hairline", "ultralight", "extra light")),
        ("02-Light", ("light",)),
        ("03-Regular", ("regular", "book", "normal", "مــتوسط")),
        ("04-Medium", ("medium",)),
        ("05-SemiBold", ("semibold", "demi")),
        ("06-Bold", ("bold",)),
        ("07-ExtraBold", ("extrabold", "extra bold")),
        ("08-Black", ("black", "heavy", "ultra")),
    ]
    weight = next((label for label, keys in weights if any(k in low for k in keys)), "09-Other")
    if any(x in low for x in ("italic", "oblique", "slant")):
        weight += "-Italic"

    fmt = {
        ".ttf": "01-TrueType", ".otf": "02-OpenType", ".woff": "03-WOFF",
        ".woff2": "04-WOFF2", ".eot": "05-EOT",
    }[path.suffix.lower()]
    return clean(script), clean(style), clean(weight), clean(family), ("01-Variable" if variable else "02-Static"), fmt, subfamily


def robust_rmtree(target: Path, passes: int = 4) -> None:
    """Delete a tree, tolerating Windows' transient locks.

    Indexers and AV scanners routinely hold a brief handle on a font file
    right after it is written, which makes a plain rmtree raise WinError 5
    partway through and leave the tree half-deleted. Retry a few times,
    clearing the read-only bit, before giving up.
    """
    import stat
    import time

    def on_error(func, path, exc_info):
        try:
            os.chmod(path, stat.S_IWRITE)
            func(path)
        except Exception:
            pass  # a later pass (or the final check) deals with it

    for attempt in range(passes):
        if not target.exists():
            return
        shutil.rmtree(target, onexc=lambda f, p, e: on_error(f, p, e))
        if not target.exists():
            return
        time.sleep(1.5 * (attempt + 1))

    if target.exists():
        leftovers = [p for p in target.rglob("*") if p.is_file()]
        raise SystemExit(
            f"Could not fully remove {target.name} ({len(leftovers)} file(s) locked).\n"
            "Close anything browsing that folder (Explorer, a preview server, an\n"
            "editor) and re-run. First locked file:\n"
            f"  {leftovers[0] if leftovers else target}"
        )


def canonical_key(path: Path) -> tuple:
    # Prefer real font files over macOS metadata, and shorter/shallower paths.
    return (
        path.name.startswith("._"),
        path.suffix.lower() not in {".ttf", ".otf"},
        len(path.parts),
        len(str(path)),
        str(path).lower(),
    )


def main() -> None:
    files: list[Path] = []
    for src_name in RAW_SOURCES:
        base = ROOT / src_name
        if not base.is_dir():
            continue
        for p in base.rglob("*"):
            if p.is_file() and p.suffix.lower() in FONT_EXTS and not p.name.startswith("._"):
                files.append(p)

    print(f"raw_files_found={len(files)}")

    by_hash: dict[str, list[Path]] = defaultdict(list)
    for i, path in enumerate(files, 1):
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            continue
        by_hash[digest].append(path)
        if i % 2000 == 0:
            print(f"hashed {i}/{len(files)}")

    exact_dupe_files = sum(len(v) - 1 for v in by_hash.values() if len(v) > 1)
    print(f"unique_by_hash={len(by_hash)} exact_duplicates_skipped={exact_dupe_files}")

    # Build into a staging folder and swap it in at the end. Deleting the live
    # tree up front is the fragile step on Windows: an indexer or AV scanner
    # holds brief handles on freshly written font files, which aborts the
    # delete halfway and leaves the library in a half-built state. Renaming a
    # directory succeeds where deleting its contents does not.
    stage = ROOT / "SmartOrganizedPlus.new"
    robust_rmtree(stage)
    stage.mkdir()

    rows = []
    used_paths: set[str] = set()
    for i, (digest, paths) in enumerate(sorted(by_hash.items()), 1):
        paths.sort(key=canonical_key)
        src = paths[0]
        script, style, weight, family, variant, fmt, subfamily = read_font(src)
        folder = stage / script / style / weight / family / variant / fmt
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / src.name
        n = 1
        while str(dest) in used_paths or dest.exists():
            n += 1
            dest = folder / f"{src.stem} [v{n}]{src.suffix}"
        used_paths.add(str(dest))
        try:
            dest.hardlink_to(src)
        except OSError:
            shutil.copy2(src, dest)
        # Every raw folder this exact file appears in, not just the canonical
        # pick — a font living in both Iranfont and Fonts belongs to both, and
        # attributing it to only one would undercount the source collections.
        source_folders = sorted({p.relative_to(ROOT).parts[0] for p in paths})
        rows.append({
            "script": script, "style": style, "weight": weight, "family": family,
            "subfamily": subfamily, "variant": variant, "format": fmt,
            "file": str(dest.relative_to(stage)), "source": str(src.relative_to(ROOT)),
            "source_folders": source_folders,
            "duplicate_count": len(paths) - 1,
            "sha256": digest,
        })
        if i % 2000 == 0:
            print(f"organized {i}/{len(by_hash)}")

    fields = list(rows[0])
    with (stage / "INDEX.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        # CSV wants a scalar; JSON keeps the real list.
        writer.writerows([{**r, "source_folders": " | ".join(r["source_folders"])} for r in rows])
    (stage / "INDEX.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    (stage / "README.txt").write_text(
        "SmartOrganizedPlus\n\n"
        "Hierarchy: script / style / weight / family / variable-or-static / format.\n"
        "Categories are inferred from font metadata, cmap coverage, and names.\n"
        "Built from every raw source folder (see RAW_SOURCES in organize_all_fonts.py),\n"
        "de-duplicated by exact file content (sha256). Original folders are untouched.\n\n"
        "To add new fonts: drop files into _Incoming, then re-run\n"
        "    python organize_all_fonts.py\n"
        "    python build_index.py\n",
        encoding="utf-8")

    # Swap staging into place. Renaming a directory succeeds even when a
    # scanner holds a handle on a file inside it, which is what makes this
    # safer than deleting the live tree first.
    retired = None
    if OUT.exists():
        retired = ROOT / f"SmartOrganizedPlus.old-{int(time.time())}"
        os.replace(OUT, retired)
    os.replace(stage, OUT)

    if retired is not None:
        try:
            robust_rmtree(retired, passes=2)
        except SystemExit:
            print(f"NOTE: previous tree left at {retired.name} (files still locked).")
            print("      It is safe to delete by hand once nothing is scanning it.")

    print(f"fonts={len(rows)}")
    for key in ("script", "style", "weight", "variant", "format", "family"):
        print(key, len({r[key] for r in rows}))


if __name__ == "__main__":
    main()
