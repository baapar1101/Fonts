"""
Scans the local font collection and builds fonts.json, a catalog consumed by
the static site (index.html/app.js). Also writes per-family zip archives
into _downloads/ so a family with multiple files can be downloaded in one go.

Run from this directory:
    python build_index.py
"""
import json
import os
import re
import sys
import zipfile
from collections import defaultdict

from fontTools.ttLib import TTFont
from fontTools.ttLib.ttFont import TTLibError

ROOT = os.path.dirname(os.path.abspath(__file__))
SCAN_DIRS = ["Arabic", "English", "Fonts", "+Mixed Fonts", "+Unsorted"]
EXTS = {".ttf", ".otf", ".woff", ".woff2"}
DOWNLOADS_DIR = os.path.join(ROOT, "_downloads")

# OS/2 ulUnicodeRange1 bit 13 = Arabic block (U+0600-06FF)
ARABIC_BIT = 13
# bit 0 = Basic Latin
LATIN_BIT = 0

NAME_IDS_FAMILY = [16, 1]   # prefer typographic family, fallback to legacy family
NAME_IDS_SUB = [17, 2]
NAME_IDS_FULL = [4]


def best_name(name_table, ids):
    if name_table is None:
        return None
    for nid in ids:
        # Prefer Windows platform (3,1,0x409 English-US), then any Windows record,
        # then Mac (1,0), then anything.
        rec = name_table.getName(nid, 3, 1, 0x409)
        if rec is None:
            recs = name_table.names
            candidates = [r for r in recs if r.nameID == nid]
            if candidates:
                # prefer platformID 3 (Windows) records first
                candidates.sort(key=lambda r: 0 if r.platformID == 3 else 1)
                rec = candidates[0]
        if rec is not None:
            try:
                val = rec.toUnicode()
            except Exception:
                continue
            if val and val.strip():
                return val.strip()
    return None


def has_bit(ranges, bit):
    word = bit // 32
    if word >= len(ranges):
        return False
    return bool(ranges[word] & (1 << (bit % 32)))


def classify_languages(font, family_name, folder_hint):
    langs = set()
    try:
        os2 = font["OS/2"]
        ranges = [
            getattr(os2, "ulUnicodeRange1", 0),
            getattr(os2, "ulUnicodeRange2", 0),
            getattr(os2, "ulUnicodeRange3", 0),
            getattr(os2, "ulUnicodeRange4", 0),
        ]
        if has_bit(ranges, ARABIC_BIT):
            langs.add("fa")
        if has_bit(ranges, LATIN_BIT):
            langs.add("en")
    except Exception:
        pass

    # cmap fallback / cross-check: look for actual Arabic-range code points
    if "fa" not in langs:
        try:
            cmap = font.getBestCmap() or {}
            if any(0x0600 <= cp <= 0x06FF for cp in cmap.keys()):
                langs.add("fa")
        except Exception:
            pass
    if "en" not in langs:
        try:
            cmap = font.getBestCmap() or {}
            if any(0x0041 <= cp <= 0x007A for cp in cmap.keys()):
                langs.add("en")
        except Exception:
            pass

    if not langs:
        if folder_hint == "Arabic":
            langs.add("fa")
        else:
            langs.add("en")

    return sorted(langs)


def guess_weight(font, subfamily):
    try:
        os2 = font["OS/2"]
        w = int(os2.usWeightClass)
        if 100 <= w <= 900:
            return w
    except Exception:
        pass
    s = (subfamily or "").lower()
    table = [
        ("thin", 100), ("hairline", 100),
        ("extralight", 200), ("ultralight", 200),
        ("light", 300),
        ("regular", 400), ("normal", 400), ("book", 400),
        ("medium", 500),
        ("semibold", 600), ("demibold", 600),
        ("bold", 700),
        ("extrabold", 800), ("ultrabold", 800),
        ("black", 900), ("heavy", 900),
    ]
    for key, val in table:
        if key in s:
            return val
    return 400


def guess_italic(font, subfamily):
    s = (subfamily or "").lower()
    if "italic" in s or "oblique" in s:
        return True
    try:
        os2 = font["OS/2"]
        if int(os2.fsSelection) & 0x01:
            return True
    except Exception:
        pass
    try:
        head = font["head"]
        if int(head.macStyle) & 0x02:
            return True
    except Exception:
        pass
    return False


def clean_family(name, filename_stem):
    if not name:
        return filename_stem
    name = re.sub(r"\s+", " ", name).strip()
    return name


def slugify(text):
    text = re.sub(r"[^a-zA-Z0-9؀-ۿ]+", "-", text).strip("-")
    return text.lower() or "font"


def main():
    families = {}  # key -> {family, langs:set, variants: {styleKey: {...}}, formats:set}
    skipped = []
    seen_files = set()
    total = 0

    for top in SCAN_DIRS:
        base = os.path.join(ROOT, top)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirnames, filenames in os.walk(base):
            for fn in filenames:
                ext = os.path.splitext(fn)[1].lower()
                if ext not in EXTS:
                    continue
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, ROOT).replace("\\", "/")
                if rel in seen_files:
                    continue
                seen_files.add(rel)
                total += 1

                try:
                    font = TTFont(full, fontNumber=0, lazy=True, checkChecksums=0)
                except Exception as e:
                    skipped.append((rel, str(e)))
                    continue

                try:
                    name_table = font["name"] if "name" in font else None
                    family = best_name(name_table, NAME_IDS_FAMILY)
                    subfamily = best_name(name_table, NAME_IDS_SUB) or "Regular"
                    full_name = best_name(name_table, NAME_IDS_FULL)
                    stem = os.path.splitext(fn)[0]
                    family = clean_family(family, stem)

                    langs = classify_languages(font, family, top)
                    weight = guess_weight(font, subfamily)
                    italic = guess_italic(font, subfamily)
                except Exception as e:
                    skipped.append((rel, f"metadata error: {e}"))
                    continue
                finally:
                    try:
                        font.close()
                    except Exception:
                        pass

                fkey = family.lower()
                fam = families.setdefault(fkey, {
                    "family": family,
                    "langs": set(),
                    "variants": {},
                    "folders": set(),
                })
                fam["langs"].update(langs)
                fam["folders"].add(top)

                style_key = (weight, italic)
                variant = fam["variants"].setdefault(style_key, {
                    "weight": weight,
                    "italic": italic,
                    "subfamily": subfamily,
                    "files": {},
                    "fullName": full_name or f"{family} {subfamily}",
                })
                fmt = ext.lstrip(".")
                # If duplicate format for same variant, keep the larger/more complete file
                if fmt not in variant["files"] or os.path.getsize(full) > variant["files"][fmt]["size"]:
                    variant["files"][fmt] = {"path": rel, "size": os.path.getsize(full)}

    # Build output structure + per-family zips
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
    out = []
    for fkey, fam in sorted(families.items(), key=lambda kv: kv[1]["family"].lower()):
        slug = slugify(fam["family"])
        variants_out = []
        all_files = []
        for (weight, italic), v in sorted(fam["variants"].items(), key=lambda kv: (kv[0][0], kv[0][1])):
            files_list = [{"format": fmt, "path": info["path"], "size": info["size"]} for fmt, info in v["files"].items()]
            variants_out.append({
                "weight": v["weight"],
                "italic": v["italic"],
                "subfamily": v["subfamily"],
                "fullName": v["fullName"],
                "files": files_list,
            })
            all_files.extend(files_list)

        zip_rel = None
        if len(all_files) > 1:
            zip_name = f"{slug}.zip"
            zip_path = os.path.join(DOWNLOADS_DIR, zip_name)
            try:
                with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                    used_names = set()
                    for f in all_files:
                        arcname = os.path.basename(f["path"])
                        if arcname in used_names:
                            arcname = f"{f['format']}_{arcname}"
                        used_names.add(arcname)
                        zf.write(os.path.join(ROOT, f["path"]), arcname)
                zip_rel = f"_downloads/{zip_name}"
            except Exception as e:
                skipped.append((slug, f"zip error: {e}"))

        out.append({
            "slug": slug,
            "family": fam["family"],
            "langs": sorted(fam["langs"]),
            "variants": variants_out,
            "zip": zip_rel,
            "folders": sorted(fam["folders"]),
        })

    with open(os.path.join(ROOT, "fonts.json"), "w", encoding="utf-8") as f:
        json.dump({"families": out}, f, ensure_ascii=False, indent=0)

    print(f"Scanned files: {total}")
    print(f"Families indexed: {len(out)}")
    print(f"Skipped/failed: {len(skipped)}")
    if skipped:
        with open(os.path.join(ROOT, "build_index_skipped.log"), "w", encoding="utf-8") as f:
            for rel, err in skipped:
                f.write(f"{rel}\t{err}\n")
        print("See build_index_skipped.log for details")


if __name__ == "__main__":
    sys.exit(main())
