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
OUT = ROOT / "SmartOrganizedPlus"
EXTS = {".ttf", ".otf", ".woff", ".woff2", ".eot"}


def clean(value: str) -> str:
    value = re.sub(r"[\x00-\x1f<>:\"/\\|?*]", "_", value).strip(" .")
    return value or "Unknown"


def read_font(path: Path) -> tuple[str, str, str, str, str, str, str]:
    family = path.parent.name
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
        ("05-SemiBold", ("semibold", "demi",)),
        ("06-Bold", ("bold",)),
        ("07-ExtraBold", ("extrabold", "extra bold")),
        ("08-Black", ("black", "heavy", "ultra",)),
    ]
    weight = next((label for label, keys in weights if any(k in low for k in keys)), "09-Other")
    if any(x in low for x in ("italic", "oblique", "slant")):
        weight += "-Italic"

    fmt = {
        ".ttf": "01-TrueType", ".otf": "02-OpenType", ".woff": "03-WOFF",
        ".woff2": "04-WOFF2", ".eot": "05-EOT",
    }[path.suffix.lower()]
    return clean(script), clean(style), clean(weight), clean(family), ("01-Variable" if variable else "02-Static"), fmt, subfamily


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit("Organized folder not found.")
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    rows = []
    fonts = [p for p in SOURCE.rglob("*") if p.is_file() and p.suffix.lower() in EXTS]
    for src in sorted(fonts, key=lambda p: str(p).lower()):
        script, style, weight, family, variant, fmt, subfamily = read_font(src)
        folder = OUT / script / style / weight / family / variant / fmt
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
        rows.append({
            "script": script, "style": style, "weight": weight, "family": family,
            "subfamily": subfamily, "variant": variant, "format": fmt,
            "file": str(dest.relative_to(OUT)), "source": str(src.relative_to(ROOT)),
            "sha256": hashlib.sha256(src.read_bytes()).hexdigest(),
        })
    fields = list(rows[0])
    with (OUT / "INDEX.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields); writer.writeheader(); writer.writerows(rows)
    (OUT / "INDEX.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "README.txt").write_text(
        "SmartOrganizedPlus\n\n"
        "Hierarchy: script / style / weight / family / variable-or-static / format.\n"
        "Categories are inferred from font metadata, cmap coverage, and names.\n"
        "Original folders and SmartOrganized remain unchanged.\n", encoding="utf-8")
    print(f"fonts={len(rows)}")
    for key in ("script", "style", "weight", "variant", "format"):
        print(key, len({r[key] for r in rows}))


if __name__ == "__main__":
    main()
