Drop newly downloaded/imported font files (or folders of them) here.

Then, from the "Fonts All" folder, run:

    python organize_all_fonts.py
    python build_index.py

The first command sorts everything in here (plus every other raw source
folder) into SmartOrganizedPlus by script, style, weight, family, and
format, skipping exact duplicates. The second command rebuilds fonts.json
so the new fonts show up on the site.
