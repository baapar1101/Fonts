from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
from collections import Counter
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "Organized"
OUT = ROOT / "SmartOrganized"
EXTS = {".ttf", ".otf", ".woff", ".woff2", ".eot"}


def clean(value: str) -> str:
    value = re.sub(r"[\x00-\x1f<>:\"/\\|?*]", "_", value).strip(" .")
    return value or "Unknown"


def metadata(path: Path) -> tuple[str, str, str, str]:
    family = path.parent.name
    subfamily = "Regular"
    scripts = set()
    try:
        font = TTFont(str(path), lazy=True)
        names = font["name"].names
        for wanted, target in ((16, "family"), (1, "family"), (17, "subfamily"), (2, "subfamily")):
            for record in names:
                if record.nameID != wanted:
                    continue
                try:
                    text = record.toUnicode().strip()
                except Exception:
                    text = ""
                if text:
                    if target == "family" and family == path.parent.name:
                        family = text
                    elif target == "subfamily" and subfamily == "Regular":
                        subfamily = text
                    break
        cmap = set()
        for table in font["cmap"].tables:
            cmap.update(table.cmap.keys())
        arabic = sum(1 for c in cmap if 0x600 <= c <= 0x8FF or 0xFB50 <= c <= 0xFDFF)
        latin = sum(1 for c in cmap if 0x41 <= c <= 0x24F)
        persian = sum(1 for c in cmap if c in {0x067E, 0x0686, 0x0698, 0x06AF, 0x06CC, 0x06F0})
        if arabic >= 10 and latin >= 10:
            script = "03-Mixed"
        elif arabic >= 10:
            script = "01-Persian-Arabic" if persian else "02-Arabic"
        elif latin >= 10:
            script = "04-Latin"
        else:
            script = "05-Other"
        is_variable = "fvar" in font
        font.close()
    except Exception:
        script = "05-Other"
        is_variable = "variable" in path.name.lower() or "vf" in path.stem.lower()
    fmt = {
        ".ttf": "01-TrueType",
        ".otf": "02-OpenType",
        ".woff": "03-WOFF",
        ".woff2": "04-WOFF2",
        ".eot": "05-EOT",
    }[path.suffix.lower()]
    variant = "01-Variable" if is_variable else "02-Static"
    return clean(script), clean(family), fmt, variant


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit("Organized folder not found; run organize_fonts.py first.")
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    rows = []
    used = Counter()
    fonts = [p for p in SOURCE.rglob("*") if p.is_file() and p.suffix.lower() in EXTS]
    for src in sorted(fonts, key=lambda p: str(p).lower()):
        script, family, fmt, variant = metadata(src)
        folder = OUT / script / family / variant / fmt
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / src.name
        base, ext = dest.stem, dest.suffix
        version = 1
        while dest.exists():
            version += 1
            dest = folder / f"{base} [v{version}]{ext}"
        try:
            dest.hardlink_to(src)
        except OSError:
            shutil.copy2(src, dest)
        rows.append({
            "script": script, "family": family, "variant": variant, "format": fmt,
            "file": str(dest.relative_to(OUT)), "source": str(src.relative_to(ROOT)),
            "sha256": hashlib.sha256(src.read_bytes()).hexdigest(),
        })
    with (OUT / "INDEX.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
        writer.writeheader(); writer.writerows(rows)
    (OUT / "INDEX.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "README.txt").write_text(
        "SmartOrganized font library\n\n"
        "Folder layout: script / family / variable-or-static / format.\n"
        "Files are hardlinks to Organized when supported; originals remain unchanged.\n"
        "INDEX.csv and INDEX.json contain searchable metadata.\n", encoding="utf-8")
    print(f"fonts={len(rows)}")
    print(f"scripts={len({r['script'] for r in rows})}")
    print(f"families={len({r['family'] for r in rows})}")


if __name__ == "__main__":
    main()
