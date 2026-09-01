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
import re
import shutil
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

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    rows = []
    used_paths: set[str] = set()
    for i, (digest, paths) in enumerate(sorted(by_hash.items()), 1):
        paths.sort(key=canonical_key)
        src = paths[0]
        script, style, weight, family, variant, fmt, subfamily = read_font(src)
        folder = OUT / script / style / weight / family / variant / fmt
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
        rows.append({
            "script": script, "style": style, "weight": weight, "family": family,
            "subfamily": subfamily, "variant": variant, "format": fmt,
            "file": str(dest.relative_to(OUT)), "source": str(src.relative_to(ROOT)),
            "duplicate_count": len(paths) - 1,
            "sha256": digest,
        })
        if i % 2000 == 0:
            print(f"organized {i}/{len(by_hash)}")

    fields = list(rows[0])
    with (OUT / "INDEX.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    (OUT / "INDEX.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "README.txt").write_text(
        "SmartOrganizedPlus\n\n"
        "Hierarchy: script / style / weight / family / variable-or-static / format.\n"
        "Categories are inferred from font metadata, cmap coverage, and names.\n"
        "Built from every raw source folder (see RAW_SOURCES in organize_all_fonts.py),\n"
        "de-duplicated by exact file content (sha256). Original folders are untouched.\n\n"
        "To add new fonts: drop files into _Incoming, then re-run\n"
        "    python organize_all_fonts.py\n"
        "    python build_index.py\n",
        encoding="utf-8")

    print(f"fonts={len(rows)}")
    for key in ("script", "style", "weight", "variant", "format", "family"):
        print(key, len({r[key] for r in rows}))


if __name__ == "__main__":
    main()
