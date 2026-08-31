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
OUT = ROOT / "Organized"
FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2", ".eot"}
SKIP_PARTS = {"Organized", "_duplicates"}


def safe_name(value: str) -> str:
    value = re.sub(r"[\x00-\x1f<>:\"/\\|?*]", "_", value).strip(" .")
    return value or "Unknown"


def internal_family(path: Path) -> str | None:
    if path.suffix.lower() not in {".ttf", ".otf"}:
        return None
    try:
        font = TTFont(str(path), lazy=True, fontNumber=0)
        names = font["name"].names
        for name_id in (16, 1):
            for record in names:
                if record.nameID == name_id:
                    try:
                        text = record.toUnicode().strip()
                    except Exception:
                        text = record.string.decode(record.getEncoding(), "ignore").strip()
                    if text:
                        font.close()
                        return text
        font.close()
    except Exception:
        return None
    return None


def canonical_key(path: Path) -> tuple:
    # Prefer real font files over macOS metadata and web-only copies.
    return (
        path.name.startswith("._"),
        path.suffix.lower() not in {".ttf", ".otf"},
        len(path.parts),
        len(str(path)),
        str(path).lower(),
    )


def main() -> None:
    files = [
        p
        for p in ROOT.rglob("*")
        if p.is_file()
        and p.suffix.lower() in FONT_EXTS
        and not any(part in SKIP_PARTS for part in p.parts)
        and not p.name.startswith("._")
    ]

    by_hash: dict[str, list[Path]] = defaultdict(list)
    for path in files:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        by_hash[digest].append(path)

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    manifest = []
    used_destinations: dict[Path, int] = {}
    duplicate_groups = 0
    duplicate_files = 0

    for digest, paths in sorted(by_hash.items()):
        paths.sort(key=canonical_key)
        source = paths[0]
        if len(paths) > 1:
            duplicate_groups += 1
            duplicate_files += len(paths) - 1

        family = internal_family(source)
        if not family:
            # Existing collection folders are a useful fallback for web fonts.
            family = source.parent.name
        family_dir = OUT / safe_name(family)
        family_dir.mkdir(parents=True, exist_ok=True)

        destination = family_dir / source.name
        stem, suffix = destination.stem, destination.suffix
        version = 1
        while destination.exists():
            version += 1
            destination = family_dir / f"{stem} [v{version}]{suffix}"

        # Hardlinks avoid another ~1.4 GB copy while remaining independently usable.
        try:
            destination.hardlink_to(source)
        except OSError:
            shutil.copy2(source, destination)

        manifest.append(
            {
                "family": family,
                "file": str(destination.relative_to(OUT)),
                "source": str(source.relative_to(ROOT)),
                "sha256": digest,
                "duplicate_count": len(paths) - 1,
                "duplicates": [str(p.relative_to(ROOT)) for p in paths[1:]],
            }
        )

    with (OUT / "MANIFEST.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["family", "file", "source", "sha256", "duplicate_count"]
        )
        writer.writeheader()
        for row in manifest:
            writer.writerow({k: row[k] for k in writer.fieldnames})

    (OUT / "MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "README.txt").write_text(
        "Organized font library\n"
        "======================\n"
        "Each binary-identical font is included only once.\n"
        "Different formats, styles, and actual versions are retained.\n"
        "MANIFEST.csv/json record the source path and any exact duplicates.\n"
        "Original folders were not deleted or modified.\n",
        encoding="utf-8",
    )

    print(f"source_files={len(files)}")
    print(f"unique_files={len(manifest)}")
    print(f"exact_duplicate_groups={duplicate_groups}")
    print(f"exact_duplicate_files_omitted={duplicate_files}")
    print(f"families={len({row['family'] for row in manifest})}")


if __name__ == "__main__":
    main()
