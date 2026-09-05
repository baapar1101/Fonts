"""
Safety gate before deleting any source folder.

Hashes every font in the raw/source folders and every font in
SmartOrganizedPlus, then reports anything that exists outside the final
folder but not inside it. Deleting a source folder is only safe when this
reports zero missing files.

Run:  python verify_coverage.py
"""
from __future__ import annotations

import hashlib
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FINAL = ROOT / "SmartOrganizedPlus"
FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2", ".eot"}

# Everything that is not the final folder, not site code, not generated output.
SKIP_TOP = {
    "SmartOrganizedPlus", "_downloads", "ui", ".git", "__pycache__",
    "Logo Type PSD Projects", "SVG Fonts",
}


def digest(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def collect(base: Path) -> dict[str, list[Path]]:
    out: dict[str, list[Path]] = defaultdict(list)
    for p in base.rglob("*"):
        if p.is_file() and p.suffix.lower() in FONT_EXTS and not p.name.startswith("._"):
            d = digest(p)
            if d:
                out[d].append(p)
    return out


def main() -> int:
    if not FINAL.is_dir():
        print("SmartOrganizedPlus is missing — refusing to report anything as safe.")
        return 2

    print("Hashing final folder…")
    final = collect(FINAL)
    print(f"  final: {sum(len(v) for v in final.values())} files, {len(final)} unique")

    sources = [
        e for e in sorted(ROOT.iterdir())
        if e.is_dir() and e.name not in SKIP_TOP and not e.name.startswith(".")
    ]

    grand_missing: list[Path] = []
    print("\nChecking sources against the final folder:")
    for src in sources:
        got = collect(src)
        missing = [paths[0] for h, paths in got.items() if h not in final]
        total = sum(len(v) for v in got.values())
        if total == 0:
            print(f"  {src.name:<26} no font files")
            continue
        mark = "OK" if not missing else f"MISSING {len(missing)}"
        print(f"  {src.name:<26} {total:>6} files, {len(got):>5} unique   {mark}")
        grand_missing.extend(missing)

    print()
    if grand_missing:
        print(f"NOT SAFE TO DELETE — {len(grand_missing)} unique font(s) exist only outside the final folder:")
        for p in grand_missing[:25]:
            print("   ", p.relative_to(ROOT))
        if len(grand_missing) > 25:
            print(f"    … and {len(grand_missing) - 25} more")
        return 1

    print("SAFE: every font in every source folder is present in SmartOrganizedPlus.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
