# Licenses

## Google Fonts import

Every family under `SmartOrganizedPlus` that carries the **Google Fonts**
collection (`pack-google` in `fonts.json`) comes from the Google Fonts
library — <https://github.com/google/fonts> — specifically its `ofl/`,
`apache/` and `ufl/` trees. Those are the fonts that are free to use, embed,
modify and redistribute, including commercially.

`google-fonts.csv` is the manifest: one row per imported family, with the
licence it ships under, the upstream directory it came from, its designer and
its copyright notice.

| Licence | Families | Full text |
| --- | --- | --- |
| SIL Open Font License 1.1 | 2003 | [`OFL-1.1.txt`](OFL-1.1.txt) |
| Apache License 2.0 | 44 | [`Apache-2.0.txt`](Apache-2.0.txt) |
| Ubuntu Font Licence 1.0 | 5 | [`UFL-1.0.txt`](UFL-1.0.txt) |

Upstream ships an identical copy of the licence text in every family folder,
differing only in the copyright line above it. That line is kept per family in
the manifest, so nothing is lost by storing each licence once here.

### What the licences ask of you

- **OFL 1.1** — keep this notice and the copyright line with the font, and do
  not sell the font files on their own. A modified version must not use the
  original's Reserved Font Name.
- **Apache 2.0** — keep the notice; no naming restriction.
- **UFL 1.0** — keep the notice; renaming is required if you modify the font.

None of the three restricts embedding a font in a document, a website or an
application, or using it for commercial work.

## The rest of the library

Fonts outside the `pack-google` collection were imported from the collection's
own source packs and are **not** covered by anything in this folder. Check the
rights on an individual family before using it commercially.
