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
# SmartOrganizedPlus is the deduplicated, categorized catalog built by
# organize_all_fonts.py from every raw source folder. It is the single
# source of truth for the site — do not add the old raw folders back here,
# they would just re-list the same fonts SmartOrganizedPlus already has.
SCAN_DIRS = ["SmartOrganizedPlus"]
EXTS = {".ttf", ".otf", ".woff", ".woff2"}
DOWNLOADS_DIR = os.path.join(ROOT, "_downloads")

STYLE_LABELS = {
    "01-Sans-Modern": "Sans",
    "02-Serif": "Serif",
    "03-Handwriting": "Handwriting",
    "04-Monospace": "Monospace",
    "05-Display-Decorative": "Display",
    "06-General": "General",
}

# Source packs: the original folders fonts were imported from. Provenance
# comes from SmartOrganizedPlus/INDEX.json, which records every raw folder a
# font appears in (not just the de-duplicated canonical pick).
SOURCE_COLLECTIONS = [
    ("iranfont",   "Iran Font",     "ایران فونت",        "Iranfont"),
    ("pack-fonts", "Fonts",         "مجموعه Fonts",      "Fonts"),
    ("pack-farsi", "Farsi",         "مجموعه فارسی",      "Farsi"),
    ("pack-english", "English",     "مجموعه انگلیسی",    "English"),
    ("pack-mim",   "NEW",           "مجموعه NEW",        "NEW"),
    ("pack-500",   "500 Collection", "مجموعه ۵۰۰",       "500.Font.Collection"),
    ("pack-384",   "384 Farsi",     "۳۸۴ فونت فارسی",    "384.Font.Farsi"),
    ("pack-mixed", "Mixed",         "ترکیبی",            "+Mixed Fonts"),
    ("pack-unsorted", "Unsorted",   "دسته‌بندی‌نشده",     "+Unsorted"),
    ("pack-arabic", "Arabic",       "مجموعه عربی",       "Arabic"),
    ("pack-incoming", "New Imports", "واردات جدید",      "_Incoming"),
    ("pack-downloads", "Downloads",  "دانلودها",          "downloads"),
]

# Named collections shown as chips on the site. Each entry is
# (id, English label, Persian label, predicate over the lowercased family name).
# A family can belong to several collections; order here is display order.
_MODERN_WEB = (
    "vazir", "sahel", "shabnam", "samim", "yekan", "estedad", "dana", "peyda",
    "anjoman", "gandom", "parastoo", "tanha", "nahid", "behdad", "mikhak",
    "morabba", "rezvan", "ganjname", "qomashi", "sarbaz", "shahab",
)
_CALLIGRAPHY = (
    "nastaliq", "nastaleeq", "naskh", "thuluth", "sols", "diwani", "kufi",
    "koufi", "reqa", "ruqa", "tahrir", "shekaste", "khodkar", "moalla",
)
_LATIN_POPULAR = (
    "roboto", "open sans", "lato", "montserrat", "poppins", "raleway",
    "oswald", "nunito", "bebas", "playfair", "merriweather", "din",
)

# Name-pattern collections: publisher/series prefixes ("B Nazanin", "Mj_...")
# and thematic groupings, all inferred from the family name.
NAME_COLLECTIONS = [
    ("b-series",  "B Series",      "فونت‌های B",       "series", lambda n: bool(re.match(r"^b[\s_-]", n)) or n.startswith("btahoma")),
    ("a-series",  "A Series",      "فونت‌های A",       "series", lambda n: bool(re.match(r"^a[\s_-]", n))),
    ("mj",        "Mj",            "مجموعه Mj",        "series", lambda n: n.startswith("mj_")),
    ("mrt",       "MRT",           "مجموعه MRT",       "series", lambda n: "mrt_" in n),
    ("w-series",  "W Series",      "مجموعه W",         "series", lambda n: n.startswith("w_")),
    ("ipt",       "IPT",           "مجموعه IPT",       "series", lambda n: n.startswith("ipt ")),
    ("series-2",  "2 Series",      "سری ۲",            "series", lambda n: bool(re.match(r"^2\s", n))),
    ("iran-sans", "IRAN Sans",     "خانواده ایران‌سنس", "series", lambda n: n.startswith("iran")),
    ("far",       "Far",           "مجموعه Far",       "series", lambda n: n.startswith("far.")),
    ("max",       "Max",           "مجموعه Max",       "series", lambda n: n.startswith("max-")),
    ("f-series",  "F Series",      "مجموعه F",         "series", lambda n: n.startswith("f_")),
    ("modern-web", "Modern Web",   "وب‌فونت مدرن",     "theme",  lambda n: any(k in n for k in _MODERN_WEB)),
    ("calligraphy", "Calligraphy", "خوشنویسی",         "theme",  lambda n: any(k in n for k in _CALLIGRAPHY)),
    ("latin-popular", "Latin",     "لاتین محبوب",      "theme",  lambda n: any(k in n for k in _LATIN_POPULAR)),
]

GROUP_LABELS = {
    "source": ("Collections", "مجموعه‌ها"),
    "series": ("Series", "سری‌ها"),
    "theme":  ("Themes", "موضوعی"),
}


def load_source_folder_map():
    """Map each organized font file -> the raw folders it came from.

    Reads SmartOrganizedPlus/INDEX.json, written by organize_all_fonts.py.
    Returns {} when provenance is unavailable, in which case source-pack
    collections are simply skipped rather than silently wrong.
    """
    index_path = os.path.join(ROOT, SCAN_DIRS[0], "INDEX.json")
    if not os.path.isfile(index_path):
        return {}
    with open(index_path, encoding="utf-8") as f:
        rows = json.load(f)
    mapping = {}
    for r in rows:
        folders = r.get("source_folders")
        if not folders:
            # Older INDEX.json without multi-folder provenance.
            src = r.get("source", "").replace("\\", "/")
            folders = [src.split("/")[0]] if src else []
        key = f"{SCAN_DIRS[0]}/" + r["file"].replace("\\", "/")
        mapping[key] = folders
    return mapping


def collections_for(family, source_folders=()):
    low = family.strip().lower()
    found = [cid for cid, _e, _f, _g, match in NAME_COLLECTIONS if match(low)]
    folders = set(source_folders)
    found += [cid for cid, _e, _f, folder in SOURCE_COLLECTIONS if folder in folders]
    return found


def collections_meta(families):
    """Collection chips with live counts, dropping any that matched nothing."""
    order = (
        [(cid, en, fa, "source") for cid, en, fa, _folder in SOURCE_COLLECTIONS]
        + [(cid, en, fa, grp) for cid, en, fa, grp, _m in NAME_COLLECTIONS]
    )
    counts = {cid: 0 for cid, _e, _f, _g in order}
    for fam in families:
        for cid in fam.get("collections", []):
            counts[cid] = counts.get(cid, 0) + 1
    return [
        {"id": cid, "label": en, "labelFa": fa, "group": grp,
         "groupLabel": GROUP_LABELS[grp][0], "groupLabelFa": GROUP_LABELS[grp][1],
         "count": counts[cid]}
        for cid, en, fa, grp in order
        if counts.get(cid)
    ]

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


def classify_languages(font, family_name, script_hint):
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
        # Fall back to the script bucket organize_all_fonts.py already sorted
        # this file into (01-Persian-Arabic / 02-Arabic / 03-Mixed / 04-Latin).
        if script_hint in ("01-Persian-Arabic", "02-Arabic"):
            langs.add("fa")
        elif script_hint == "03-Mixed":
            langs.add("fa")
            langs.add("en")
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

                # SmartOrganizedPlus layout: script/style/weight/family/variant/format/file
                rel_parts = os.path.relpath(full, base).replace("\\", "/").split("/")
                script_hint = rel_parts[0] if len(rel_parts) > 0 else ""
                style_hint = rel_parts[1] if len(rel_parts) > 1 else ""

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

                    langs = classify_languages(font, family, script_hint)
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
                    "styles": set(),
                })
                fam["langs"].update(langs)
                if style_hint in STYLE_LABELS:
                    fam["styles"].add(STYLE_LABELS[style_hint])

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

    source_map = load_source_folder_map()

    # Build output structure + per-family zips. Wipe stale zips first so
    # renamed/removed families don't leave orphaned archives behind.
    if os.path.isdir(DOWNLOADS_DIR):
        for fn in os.listdir(DOWNLOADS_DIR):
            if fn.endswith(".zip"):
                os.remove(os.path.join(DOWNLOADS_DIR, fn))
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

        fam_folders = set()
        for f in all_files:
            fam_folders.update(source_map.get(f["path"], ()))

        out.append({
            "slug": slug,
            "family": fam["family"],
            "langs": sorted(fam["langs"]),
            "styles": sorted(fam["styles"]),
            "collections": collections_for(fam["family"], fam_folders),
            "variants": variants_out,
            "zip": zip_rel,
        })

    with open(os.path.join(ROOT, "fonts.json"), "w", encoding="utf-8") as f:
        json.dump({"families": out, "collections": collections_meta(out)},
                  f, ensure_ascii=False, indent=0)

    print(f"Scanned files: {total}")
    print(f"Families indexed: {len(out)}")
    print(f"Skipped/failed: {len(skipped)}")
    if skipped:
        with open(os.path.join(ROOT, "build_index_skipped.log"), "w", encoding="utf-8") as f:
            for rel, err in skipped:
                f.write(f"{rel}\t{err}\n")
        print("See build_index_skipped.log for details")


def retag_collections():
    """Re-apply COLLECTIONS to an existing fonts.json.

    Skips the font scan and the zip rebuild entirely, so collection rules can
    be tweaked and re-applied in a second instead of a full re-index.
    """
    path = os.path.join(ROOT, "fonts.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    families = data["families"]
    for fam in families:
        fam["collections"] = collections_for(fam["family"])
    data["collections"] = collections_meta(families)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=0)
    print(f"Retagged {len(families)} families")
    for c in data["collections"]:
        print(f"  {c['id']:<15} {c['count']:>5}  {c['label']}")


if __name__ == "__main__":
    if "--collections-only" in sys.argv:
        sys.exit(retag_collections())
    sys.exit(main())
