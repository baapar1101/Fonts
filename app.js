(() => {
  "use strict";

  const state = {
    all: [],
    filtered: [],
    lang: "all",       // all | fa | en
    style: "all",       // all | Sans | Serif | Handwriting | Monospace | Display | General
    collection: "all",  // all | a fonts.json collection id | mine:likes | mine:<id>
    collections: [],
    user: null,          // {phone} once signed in
    likes: new Set(),    // slugs this user liked
    myCollections: [],   // [{id, name, items:[slug]}]
    query: "",
    sort: "name",
    previewText: "",
    fontSize: 34,
    rendered: 0,
    pageSize: 48,
  };

  const FORMAT_WEB_PRIORITY = ["woff2", "woff", "ttf", "otf"];
  const FORMAT_DOWNLOAD_PRIORITY = ["ttf", "otf", "woff2", "woff"];

  const DEFAULT_TEXT_EN = "The quick brown fox jumps over the lazy dog — 0123456789";
  const DEFAULT_TEXT_FA = "یک شاهد عادل، برای پیروزی حق در دادگاه، اظهار حقیقت می‌کند — ۰۱۲۳۴۵۶۷۸۹";

  const grid = document.getElementById("grid");
  const searchInput = document.getElementById("searchInput");
  const previewInput = document.getElementById("previewInput");
  const sizeRange = document.getElementById("sizeRange");
  const sizeLabel = document.getElementById("sizeLabel");
  const statsLine = document.getElementById("statsLine");
  const sortSelect = document.getElementById("sortSelect");
  const styleSelect = document.getElementById("styleSelect");
  const collectionChips = document.getElementById("collectionChips");
  const langButtons = document.querySelectorAll(".seg[data-role=lang] button");
  const emptyState = document.getElementById("emptyState");
  const sentinel = document.getElementById("sentinel");

  const modalOverlay = document.getElementById("modalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");

  const loadedFonts = new Set(); // key -> loaded FontFace already added to document.fonts

  function encodePath(p) {
    return p.split("/").map(encodeURIComponent).join("/");
  }

  function pickFormat(files, priority) {
    for (const fmt of priority) {
      const f = files.find(x => x.format === fmt);
      if (f) return f;
    }
    return files[0] || null;
  }

  function fontFaceKey(slug, variant) {
    return `${slug}__${variant.weight}__${variant.italic ? "i" : "n"}`;
  }

  function cssFamilyName(slug, variant) {
    // Unique per-variant family name so each weight/style can load independently
    // without colliding with a browser's real installed fonts of the same name.
    return `wf-${slug}-${variant.weight}${variant.italic ? "i" : ""}`;
  }

  async function ensureVariantLoaded(fam, variant) {
    const key = fontFaceKey(fam.slug, variant);
    if (loadedFonts.has(key)) return true;
    const file = pickFormat(variant.files, FORMAT_WEB_PRIORITY);
    if (!file) return false;
    try {
      const url = encodePath(file.path);
      const ff = new FontFace(cssFamilyName(fam.slug, variant), `url("${url}")`, {
        weight: String(variant.weight),
        style: variant.italic ? "italic" : "normal",
      });
      await ff.load();
      document.fonts.add(ff);
      loadedFonts.add(key);
      return true;
    } catch (e) {
      loadedFonts.add(key); // avoid retry storms on broken files
      return false;
    }
  }

  function variantLabel(v) {
    const weightNames = {100:"Thin",200:"ExtraLight",300:"Light",400:"Regular",500:"Medium",600:"SemiBold",700:"Bold",800:"ExtraBold",900:"Black"};
    // Prefer the font's own style name: it is what separates two faces that
    // share a weight (Nexa ships Book and Regular at 400, Black and Heavy
    // at 900), which a generic weight label would render identically.
    const own = (v.subfamily || "").trim();
    const fallback = `${weightNames[v.weight] || v.weight}${v.italic ? " Italic" : ""}`;
    return `${own || fallback} (${v.weight})`;
  }

  function humanSize(bytes) {
    if (!bytes) return "";
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(0)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  function buildCard(fam) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.slug = fam.slug;

    const isFa = fam.langs.includes("fa");
    const isEn = fam.langs.includes("en");

    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = fam.family;
    const tags = document.createElement("div");
    tags.className = "card-tags";
    if (isFa) tags.innerHTML += `<span class="tag fa">FA</span>`;
    if (isEn) tags.innerHTML += `<span class="tag en">EN</span>`;
    head.appendChild(title);
    head.appendChild(tags);

    const previewBox = document.createElement("div");
    previewBox.className = "preview-box placeholder" + (isFa && !isEn ? " rtl" : "");
    previewBox.textContent = "Loading preview…";
    previewBox.style.fontSize = state.fontSize + "px";

    const variantRow = document.createElement("div");
    variantRow.className = "variant-row";
    const select = document.createElement("select");
    fam.variants.forEach((v, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `${variantLabel(v)} · ${v.files.map(f=>f.format).join("/")}`;
      select.appendChild(opt);
    });
    variantRow.appendChild(select);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const fileCount = fam.variants.reduce((n, v) => n + v.files.length, 0);
    const categoryLabel = (fam.styles || []).join(" / ");
    meta.textContent = `${categoryLabel ? categoryLabel + " · " : ""}${fam.variants.length} weight${fam.variants.length>1?"s":""} · ${fileCount} file${fileCount>1?"s":""}`;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const dlBtn = document.createElement("a");
    dlBtn.className = "btn primary";
    dlBtn.textContent = "Download";
    dlBtn.setAttribute("download", "");
    const codeBtn = document.createElement("button");
    codeBtn.className = "btn";
    codeBtn.textContent = "Get code";

    const likeBtn = document.createElement("button");
    likeBtn.className = "icon-btn like-btn" + (state.likes.has(fam.slug) ? " is-on" : "");
    likeBtn.type = "button";
    likeBtn.title = "پسندیدن / Like";
    likeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 5.6a5.1 5.1 0 0 0-7.2 0L12 7.2l-1.6-1.6a5.1 5.1 0 1 0-7.2 7.2l8.8 8.8 8.8-8.8a5.1 5.1 0 0 0 0-7.2z"/></svg>`;
    likeBtn.addEventListener("click", () => toggleLike(fam.slug));

    const bmBtn = document.createElement("button");
    bmBtn.className = "icon-btn bm-btn" + (isBookmarked(fam.slug) ? " is-on" : "");
    bmBtn.type = "button";
    bmBtn.title = "ذخیره در دسته / Save to collection";
    bmBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z"/></svg>`;
    bmBtn.addEventListener("click", e => { e.stopPropagation(); openBookmarkPopover(fam.slug, bmBtn); });

    actions.appendChild(dlBtn);
    actions.appendChild(codeBtn);
    actions.appendChild(likeBtn);
    actions.appendChild(bmBtn);

    let loaded = false;
    function currentVariant() {
      return fam.variants[Number(select.value)];
    }
    function updateDownloadLink() {
      const v = currentVariant();
      const f = pickFormat(v.files, FORMAT_DOWNLOAD_PRIORITY);
      if (f) {
        dlBtn.href = encodePath(f.path);
        dlBtn.title = `${f.format.toUpperCase()} · ${humanSize(f.size)}`;
      }
    }
    async function renderPreview() {
      const v = currentVariant();
      previewBox.classList.add("placeholder");
      previewBox.textContent = "Loading preview…";
      const ok = await ensureVariantLoaded(fam, v);
      const text = state.previewText || (isFa && !isEn ? DEFAULT_TEXT_FA : DEFAULT_TEXT_EN);
      previewBox.classList.remove("placeholder");
      previewBox.classList.toggle("rtl", isFa);
      previewBox.style.fontSize = state.fontSize + "px";
      if (ok) {
        previewBox.style.fontFamily = `"${cssFamilyName(fam.slug, v)}", ${isFa ? "'Vazirmatn', Tahoma," : ""} sans-serif`;
        previewBox.textContent = text;
      } else {
        previewBox.style.fontFamily = "inherit";
        previewBox.textContent = "Could not load preview for this file.";
      }
    }

    select.addEventListener("change", () => { updateDownloadLink(); renderPreview(); });
    codeBtn.addEventListener("click", () => openCodeModal(fam, currentVariant()));

    updateDownloadLink();

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !loaded) {
          loaded = true;
          renderPreview();
          io.disconnect();
        }
      });
    }, { rootMargin: "200px" });

    card.appendChild(head);
    card.appendChild(previewBox);
    card.appendChild(variantRow);
    card.appendChild(meta);
    card.appendChild(actions);

    io.observe(card);
    card._reRender = renderPreview;

    return card;
  }

  /* ---------------- Search: Persian-aware + typo tolerant ----------------
     No font in this library carries a Persian name record, so a Persian
     query is romanised and matched against the Latin family names. Because
     Persian script omits short vowels ("لوتوس" -> l-v-t-v-s vs "Lotus"), an
     additional consonant-skeleton pass drops vowels from BOTH sides so the
     two forms line up. Levenshtein then absorbs ordinary typos.          */

  const ARABIC_RE = /[؀-ۿ]/;

  function normalizeText(s) {
    return s
      .replace(/[ً-ٰٟ]/g, "")            // harakat
      .replace(/ـ/g, "")                            // tatweel
      .replace(/[​-‏]/g, " ")                  // ZWNJ & friends
      .replace(/[آأإٱ]/g, "ا")  // آ أ إ ٱ -> ا
      .replace(/[ىي]/g, "ی")              // ى ي -> ی
      .replace(/ك/g, "ک")                      // ك -> ک
      .replace(/ة/g, "ه")                      // ة -> ه
      .replace(/ؤ/g, "و")                      // ؤ -> و
      .replace(/ئ/g, "ی")                      // ئ -> ی
      .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
      .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  const FA_TO_LATIN = {
    "ا":"a","ب":"b","پ":"p","ت":"t","ث":"s","ج":"j","چ":"ch","ح":"h","خ":"kh",
    "د":"d","ذ":"z","ر":"r","ز":"z","ژ":"zh","س":"s","ش":"sh","ص":"s","ض":"z",
    "ط":"t","ظ":"z","ع":"a","غ":"gh","ف":"f","ق":"gh","ک":"k","گ":"g","ل":"l",
    "م":"m","ن":"n","و":"v","ه":"h","ی":"i","ء":"",
  };

  function translitWord(w) {
    // Word-initial alef carries the vowel: ایران -> iran, نه a-iran.
    let out = "", i = 0;
    if (w.startsWith("ای")) { out = "i"; i = 2; }
    else if (w.startsWith("او")) { out = "u"; i = 2; }
    else if (w.startsWith("ا")) { out = "a"; i = 1; }
    // Word-initial ی is the consonant "y" (یکان = Yekan), not the vowel "i".
    else if (w.startsWith("ی")) { out = "y"; i = 1; }
    for (; i < w.length; i++) {
      const c = w[i];
      out += (c in FA_TO_LATIN) ? FA_TO_LATIN[c] : c;
    }
    return out;
  }

  const translit = s => s.split(" ").map(translitWord).join(" ");

  // Drop vowels and semi-vowels, collapse doubles. Applied to both sides.
  // "gh" and "q" fold together first: ق romanises as either, so Persian
  // "نستعلیق" (nastaligh) still reaches the Latin "Nastaliq".
  // Separators are dropped too, so a prefix typed without a space
  // ("بنازنین") still lines up with "B Nazanin".
  const skeleton = s => s
    .replace(/gh/g, "q")
    .replace(/[aeiouywv']/g, "")
    .replace(/[^a-z0-9؀-ۿ]/g, "")
    .replace(/(.)\1+/g, "$1");

  function levenshtein(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const n = b.length;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      let rowBest = i;
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowBest) rowBest = cur[j];
      }
      if (rowBest > max) return max + 1;   // whole row already too far
      const swap = prev; prev = cur; cur = swap;
    }
    return prev[n];
  }

  function prepareSearchIndex(families) {
    families.forEach(f => {
      f._n = normalizeText(f.family);
      f._w = f._n.split(/[^a-z0-9؀-ۿ]+/).filter(Boolean);
      f._sk = skeleton(f._n);
    });
  }

  function searchFamilies(list, rawQuery) {
    const q0 = normalizeText(rawQuery);
    if (!q0) return { list, approx: false };
    const faQuery = ARABIC_RE.test(q0);
    const q = faQuery ? translit(q0) : q0;
    const qSk = skeleton(q);

    // A romanised Persian query is an approximation, so a literal substring
    // hit is weak evidence ("هما" -> "hma" sits inside "ba-hma-n"). For those
    // queries the vowel-insensitive comparison is the trustworthy one, so it
    // outranks `includes`. For Latin queries a substring means what it says.
    const INCLUDES_SCORE = faQuery ? 640 : 700;
    const SKELETON_BASE = faQuery ? 700 : 600;

    const scores = new Map();
    const put = (fam, s) => {
      const prev = scores.get(fam);
      if (prev === undefined || s > prev) scores.set(fam, s);
    };
    // Shorter names rank first among equally good matches.
    const brevity = fam => Math.min(fam._n.length, 99);

    for (const fam of list) {
      const n = fam._n;
      let s = -1;
      if (n === q) s = 1000;
      else if (n.startsWith(q)) s = 900 - brevity(fam);
      else if (fam._w.some(w => w.startsWith(q))) s = 800 - brevity(fam);
      else {
        if (n.includes(q)) s = INCLUDES_SCORE - brevity(fam);
        if (qSk.length >= 2 && fam._sk.includes(qSk)) {
          // Skeletons are lossy on purpose, so several names collapse to the
          // same one ("وزیر" -> zr matches both Vazir and Zar). Rank by how
          // close the romanised query is to the real name, not by length.
          let d = 99;
          for (const cand of [n, ...fam._w]) {
            const dd = levenshtein(q, cand, 8);
            if (dd < d) d = dd;
            if (d === 0) break;
          }
          s = Math.max(s, SKELETON_BASE - d * 20 - brevity(fam));
        }
      }
      if (s >= 0) put(fam, s);
    }

    // Only reach for fuzzy matching when the exact tiers came up thin.
    let approx = false;
    if (scores.size < 40 && q.length >= 3) {
      const maxD = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3;
      for (const fam of list) {
        if (scores.has(fam)) continue;
        let best = maxD + 1;
        for (const cand of [fam._n, ...fam._w]) {
          const d = levenshtein(q, cand, maxD);
          if (d < best) best = d;
          if (best === 0) break;
        }
        if (best > maxD && qSk.length >= 3 && fam._sk) {
          const d = levenshtein(qSk, fam._sk, maxD);
          if (d < best) best = d;
        }
        if (best <= maxD) { put(fam, 500 - best * 100 - brevity(fam)); approx = true; }
      }
    }

    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].family.localeCompare(b[0].family))
      .map(e => e[0]);
    return { list: ranked, approx };
  }

  function applyFilters() {
    const raw = state.query.trim();
    let list = state.all.filter(f => {
      if (state.lang !== "all" && !f.langs.includes(state.lang)) return false;
      if (state.style !== "all" && !(f.styles || []).includes(state.style)) return false;
      if (state.collection !== "all") {
        const sel = String(state.collection);
        if (sel === "mine:likes") {
          if (!state.likes.has(f.slug)) return false;
        } else if (sel.startsWith("mine:")) {
          const col = state.myCollections.find(c => String(c.id) === sel.slice(5));
          if (!col || !col.items.includes(f.slug)) return false;
        } else if (!(f.collections || []).includes(sel)) {
          return false;
        }
      }
      return true;
    });

    let approx = false;
    if (raw) {
      // A query ranks by relevance; the sort dropdown applies to browsing.
      const res = searchFamilies(list, raw);
      list = res.list;
      approx = res.approx;
    } else if (state.sort === "name") {
      list = list.slice().sort((a, b) => a.family.localeCompare(b.family));
    } else if (state.sort === "styles") {
      list = list.slice().sort((a, b) => b.variants.length - a.variants.length);
    }

    state.filtered = list;
    state.rendered = 0;
    grid.innerHTML = "";
    renderMore();
    statsLine.textContent = `${state.filtered.length} of ${state.all.length} families` +
      (approx ? " · including approximate matches" : "");
    emptyState.classList.toggle("hidden", state.filtered.length !== 0);
  }

  function renderMore() {
    const slice = state.filtered.slice(state.rendered, state.rendered + state.pageSize);
    const frag = document.createDocumentFragment();
    slice.forEach(fam => frag.appendChild(buildCard(fam)));
    grid.appendChild(frag);
    state.rendered += slice.length;
  }

  const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && state.rendered < state.filtered.length) {
        renderMore();
      }
    });
  }, { rootMargin: "600px" });
  scrollObserver.observe(sentinel);

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  searchInput.addEventListener("input", debounce(() => {
    state.query = searchInput.value;
    applyFilters();
  }, 180));

  previewInput.addEventListener("input", debounce(() => {
    state.previewText = previewInput.value;
    document.querySelectorAll(".card").forEach(c => c._reRender && c._reRender());
  }, 150));

  sizeRange.addEventListener("input", () => {
    state.fontSize = Number(sizeRange.value);
    sizeLabel.textContent = state.fontSize + "px";
    document.querySelectorAll(".preview-box").forEach(p => p.style.fontSize = state.fontSize + "px");
  });

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    applyFilters();
  });

  styleSelect.addEventListener("change", () => {
    state.style = styleSelect.value;
    applyFilters();
  });

  function makeChip(c) {
    const chip = document.createElement("button");
    chip.className = "chip" + (state.collection === c.id ? " active" : "");
    chip.dataset.id = c.id;
    chip.innerHTML = `<span class="chip-name">${c.label}</span>` +
      (c.labelFa ? `<span class="chip-fa">${c.labelFa}</span>` : "") +
      `<span class="chip-count">${c.count}</span>`;
    chip.addEventListener("click", () => {
      // Clicking the active chip clears the filter.
      state.collection = state.collection === c.id ? "all" : c.id;
      renderCollectionChips();
      applyFilters();
    });
    return chip;
  }

  function renderCollectionChips() {
    collectionChips.innerHTML = "";

    // Group order follows first appearance in fonts.json, so the backend
    // controls how collections are presented.
    const groups = [];
    const byGroup = new Map();
    state.collections.forEach(c => {
      const key = c.group || "other";
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        groups.push({ key, label: c.groupLabel || "", labelFa: c.groupLabelFa || "" });
      }
      byGroup.get(key).push(c);
    });

    const allRow = document.createElement("div");
    allRow.className = "chip-row";
    allRow.appendChild(makeChip({
      id: "all", label: "All", labelFa: "همه", count: state.all.length,
    }));
    collectionChips.appendChild(allRow);

    groups.forEach(g => {
      const row = document.createElement("div");
      row.className = "chip-row";
      if (g.label) {
        const heading = document.createElement("span");
        heading.className = "chip-group-label";
        heading.innerHTML = `${g.label}<em>${g.labelFa || ""}</em>`;
        row.appendChild(heading);
      }
      byGroup.get(g.key).forEach(c => row.appendChild(makeChip(c)));
      collectionChips.appendChild(row);
    });

    // The signed-in user's own shelf, kept separate from the catalog's.
    if (state.user && (state.likes.size || state.myCollections.length)) {
      const row = document.createElement("div");
      row.className = "chip-row";
      const heading = document.createElement("span");
      heading.className = "chip-group-label";
      heading.innerHTML = `Mine<em>من</em>`;
      row.appendChild(heading);

      if (state.likes.size) {
        row.appendChild(makeChip({
          id: "mine:likes", label: "Liked", labelFa: "پسندیده‌ها", count: state.likes.size,
        }));
      }
      state.myCollections.forEach(c => {
        row.appendChild(makeChip({
          id: `mine:${c.id}`, label: c.name, labelFa: "", count: c.items.length,
        }));
      });
      collectionChips.appendChild(row);
    }
  }

  langButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      langButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.lang = btn.dataset.lang;
      applyFilters();
    });
  });

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }

  function openCodeModal(fam, variant) {
    modalTitle.textContent = `${fam.family} — ${variantLabel(variant)}`;
    const webFile = pickFormat(variant.files, FORMAT_WEB_PRIORITY);
    const allFormats = variant.files.map(f => `url("${encodePath(f.path)}") format("${f.format === "ttf" ? "truetype" : f.format === "otf" ? "opentype" : f.format}")`).join(",\n       ");
    const fontFaceCss = `@font-face {
  font-family: "${fam.family.replace(/"/g,'\\"')}";
  src: ${allFormats};
  font-weight: ${variant.weight};
  font-style: ${variant.italic ? "italic" : "normal"};
  font-display: swap;
}`;
    const usageCss = `.your-element {
  font-family: "${fam.family.replace(/"/g,'\\"')}", ${fam.langs.includes("fa") ? "'Vazirmatn', Tahoma, " : ""}sans-serif;
  font-weight: ${variant.weight};
  ${variant.italic ? "font-style: italic;\n  " : ""}}`;

    modalBody.innerHTML = `
      <p class="hint">Copy this @font-face block into your CSS, then copy the font file(s) alongside your project (paths are relative to this library).</p>
      <div class="code-block">
        <button class="copy-btn" data-copy="fontface">Copy</button>
        <pre id="codeFontFace">${escapeHtml(fontFaceCss)}</pre>
      </div>
      <p class="hint">Use it like any other font family:</p>
      <div class="code-block">
        <button class="copy-btn" data-copy="usage">Copy</button>
        <pre id="codeUsage">${escapeHtml(usageCss)}</pre>
      </div>
      <p class="hint">Files in this style</p>
      <div class="modal-download-row">
        ${variant.files.map(f => `<a class="btn" download href="${encodePath(f.path)}">${f.format.toUpperCase()} · ${humanSize(f.size)}</a>`).join("")}
        ${fam.zip ? `<a class="btn primary" download href="${encodePath(fam.zip)}">Download all (.zip)</a>` : ""}
      </div>
    `;
    modalBody.querySelectorAll(".copy-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.copy === "fontface" ? "codeFontFace" : "codeUsage";
        const text = document.getElementById(targetId).textContent;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1400);
        });
      });
    });
    modalOverlay.classList.remove("hidden");
  }

  modalClose.addEventListener("click", () => modalOverlay.classList.add("hidden"));
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) modalOverlay.classList.add("hidden"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") modalOverlay.classList.add("hidden"); });

  /* ------------------------- Accounts ------------------------------ */

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: options.body ? { "Content-Type": "application/json" } : {},
      ...options,
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body is fine */ }
    if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
    return data;
  }

  /** Adopt the likes/collections snapshot the server returns with every write. */
  function adoptUserData(data) {
    if (Array.isArray(data.likes)) state.likes = new Set(data.likes);
    if (Array.isArray(data.collections)) state.myCollections = data.collections;
    refreshCardStates();
    renderCollectionChips();
  }

  const accountBtn = document.getElementById("accountBtn");
  const authOverlay = document.getElementById("authOverlay");
  const authClose = document.getElementById("authClose");
  const authStepPhone = document.getElementById("authStepPhone");
  const authStepCode = document.getElementById("authStepCode");
  const authPhone = document.getElementById("authPhone");
  const authCode = document.getElementById("authCode");
  const authSend = document.getElementById("authSend");
  const authVerify = document.getElementById("authVerify");
  const authBack = document.getElementById("authBack");
  const authMsg = document.getElementById("authMsg");
  const authPhoneEcho = document.getElementById("authPhoneEcho");

  function setAuthMsg(text, kind) {
    authMsg.hidden = !text;
    authMsg.className = "auth-msg" + (kind ? ` is-${kind}` : "");
    authMsg.innerHTML = text || "";
  }

  function showAuthStep(step) {
    authStepPhone.hidden = step !== "phone";
    authStepCode.hidden = step !== "code";
    setAuthMsg("");
  }

  function openAuth() {
    showAuthStep("phone");
    authOverlay.classList.remove("hidden");
    authPhone.focus();
  }
  const closeAuth = () => authOverlay.classList.add("hidden");

  function renderAccount() {
    if (state.user) {
      accountBtn.textContent = state.user.phone;
      accountBtn.title = "خروج از حساب / Sign out";
    } else {
      accountBtn.textContent = "ورود / Sign in";
      accountBtn.title = "ورود با شماره موبایل";
    }
    // The server decides who is an admin; this only reflects that answer.
    adminBtn.hidden = !state.user?.admin;
  }

  accountBtn.addEventListener("click", async () => {
    if (!state.user) return openAuth();
    if (!confirm("از حساب خارج می‌شوید؟")) return;
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* sign out locally anyway */ }
    state.user = null;
    state.likes = new Set();
    state.myCollections = [];
    if (String(state.collection).startsWith("mine:")) state.collection = "all";
    renderAccount();
    refreshCardStates();
    renderCollectionChips();
    applyFilters();
  });

  authClose.addEventListener("click", closeAuth);
  authOverlay.addEventListener("click", e => { if (e.target === authOverlay) closeAuth(); });
  authBack.addEventListener("click", () => showAuthStep("phone"));

  async function requestCode() {
    const phone = authPhone.value.trim();
    if (!phone) return setAuthMsg("شماره موبایل را وارد کنید", "error");
    authSend.disabled = true;
    setAuthMsg("در حال ارسال…");
    try {
      await api("/api/auth/request-otp", {
        method: "POST", body: JSON.stringify({ phone }),
      });
      authPhoneEcho.textContent = phone;
      showAuthStep("code");
      authCode.value = "";
      authCode.focus();
      setAuthMsg("کد ورود پیامک شد.", "ok");
    } catch (e) {
      setAuthMsg(e.message, "error");
    } finally {
      authSend.disabled = false;
    }
  }

  async function verifyCode() {
    const code = authCode.value.trim();
    if (!/^\d{6}$/.test(code)) return setAuthMsg("کد ۶ رقمی را وارد کنید", "error");
    authVerify.disabled = true;
    setAuthMsg("در حال بررسی…");
    try {
      const r = await api("/api/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ phone: authPhone.value.trim(), code }),
      });
      state.user = r.user;
      closeAuth();
      renderAccount();
      const me = await api("/api/me");
      adoptUserData(me);
    } catch (e) {
      setAuthMsg(e.message, "error");
    } finally {
      authVerify.disabled = false;
    }
  }

  authSend.addEventListener("click", requestCode);
  authVerify.addEventListener("click", verifyCode);
  authPhone.addEventListener("keydown", e => { if (e.key === "Enter") requestCode(); });
  authCode.addEventListener("keydown", e => { if (e.key === "Enter") verifyCode(); });

  /* -------------------------- Admin -------------------------------- */

  const adminBtn = document.getElementById("adminBtn");
  const adminOverlay = document.getElementById("adminOverlay");
  const adminClose = document.getElementById("adminClose");
  const adminDrop = document.getElementById("adminDrop");
  const adminDropText = document.getElementById("adminDropText");
  const adminFiles = document.getElementById("adminFiles");
  const adminList = document.getElementById("adminList");
  const adminUpload = document.getElementById("adminUpload");
  const adminMsg = document.getElementById("adminMsg");
  const adminBatch = document.getElementById("adminBatch");

  const ADMIN_EXTS = ["ttf", "otf", "woff", "woff2"];
  let adminQueue = [];

  function setAdminMsg(html, kind) {
    adminMsg.hidden = !html;
    adminMsg.className = "auth-msg" + (kind ? ` is-${kind}` : "");
    adminMsg.innerHTML = html || "";
  }

  function renderQueue() {
    adminList.innerHTML = "";
    adminQueue.forEach(f => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = f.name;
      const size = document.createElement("span");
      size.textContent = humanSize(f.size);
      li.append(name, size);
      adminList.appendChild(li);
    });
    adminUpload.disabled = adminQueue.length === 0;
    adminDropText.textContent = adminQueue.length
      ? `${adminQueue.length} فایل انتخاب شد — برای تغییر کلیک کنید`
      : "فایل‌ها را اینجا رها کنید یا کلیک کنید";
  }

  function acceptFiles(fileList) {
    adminQueue = [...fileList].filter(f =>
      ADMIN_EXTS.includes((f.name.split(".").pop() || "").toLowerCase()));
    const skipped = fileList.length - adminQueue.length;
    renderQueue();
    setAdminMsg(skipped ? `${skipped} فایل با پسوند نامعتبر نادیده گرفته شد.` : "", skipped ? "error" : "");
  }

  adminBtn.addEventListener("click", () => {
    adminQueue = [];
    renderQueue();
    setAdminMsg("");
    adminOverlay.classList.remove("hidden");
  });
  adminClose.addEventListener("click", () => adminOverlay.classList.add("hidden"));
  adminOverlay.addEventListener("click", e => {
    if (e.target === adminOverlay) adminOverlay.classList.add("hidden");
  });

  adminDrop.addEventListener("click", () => adminFiles.click());
  adminFiles.addEventListener("change", () => acceptFiles(adminFiles.files));
  ["dragenter", "dragover"].forEach(ev =>
    adminDrop.addEventListener(ev, e => { e.preventDefault(); adminDrop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach(ev =>
    adminDrop.addEventListener(ev, e => { e.preventDefault(); adminDrop.classList.remove("is-over"); }));
  adminDrop.addEventListener("drop", e => {
    if (e.dataTransfer?.files?.length) acceptFiles(e.dataTransfer.files);
  });

  const readAsBase64 = file => new Promise((resolve, reject) => {
    const r = new FileReader();
    // result is a data: URL; the payload starts after the comma.
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error(`خواندن ${file.name} ناموفق بود`));
    r.readAsDataURL(file);
  });

  adminUpload.addEventListener("click", async () => {
    if (!adminQueue.length) return;
    adminUpload.disabled = true;
    setAdminMsg("در حال خواندن فایل‌ها…");
    try {
      const files = [];
      for (const f of adminQueue) {
        files.push({ name: f.name, data: await readAsBase64(f) });
      }
      setAdminMsg("در حال افزودن به کتابخانه…");
      const r = await api("/api/admin/upload", {
        method: "POST",
        body: JSON.stringify({ folder: adminBatch.value.trim(), files }),
      });

      const parts = [`<b>${r.added}</b> فایل افزوده شد.`];
      if (r.duplicates) parts.push(`${r.duplicates} تکراری نادیده گرفته شد.`);
      if (r.families?.length) {
        parts.push(`خانواده‌ها: ${r.families.slice(0, 8).join("، ")}` +
          (r.families.length > 8 ? ` و ${r.families.length - 8} مورد دیگر` : ""));
      }
      if (r.rejected?.length) {
        parts.push(`<span style="color:#ff8f8f">${r.rejected.length} فایل رد شد.</span>`);
      }
      setAdminMsg(parts.join("<br>"), "ok");

      adminQueue = [];
      renderQueue();
      await reloadCatalog();
    } catch (e) {
      setAdminMsg(e.message, "error");
    } finally {
      adminUpload.disabled = adminQueue.length === 0;
    }
  });

  /** Re-fetch fonts.json after the library changes, keeping the current view. */
  async function reloadCatalog() {
    const data = await (await fetch("fonts.json", { cache: "no-store" })).json();
    state.all = data.families;
    prepareSearchIndex(state.all);
    state.collections = data.collections || [];
    renderCollectionChips();
    applyFilters();
  }

  /* --------------------- Likes & bookmarks ------------------------- */

  async function toggleLike(slug) {
    if (!state.user) return openAuth();
    const liked = !state.likes.has(slug);
    try {
      adoptUserData(await api("/api/likes", {
        method: "POST", body: JSON.stringify({ slug, liked }),
      }));
    } catch (e) { alert(e.message); }
  }

  let openPopover = null;
  function closePopover() {
    if (openPopover) { openPopover.remove(); openPopover = null; }
  }
  document.addEventListener("click", e => {
    if (openPopover && !openPopover.contains(e.target) && !e.target.closest(".bm-btn")) closePopover();
  });

  function openBookmarkPopover(slug, anchor) {
    if (!state.user) return openAuth();
    closePopover();

    const pop = document.createElement("div");
    pop.className = "bm-pop";
    pop.innerHTML = `<h4>ذخیره در دسته</h4>`;

    if (!state.myCollections.length) {
      pop.insertAdjacentHTML("beforeend", `<div class="bm-empty">هنوز دسته‌ای نساخته‌اید.</div>`);
    }
    state.myCollections.forEach(col => {
      const row = document.createElement("label");
      row.className = "bm-row";
      const checked = col.items.includes(slug);
      row.innerHTML = `<input type="checkbox" ${checked ? "checked" : ""}><span></span>`;
      row.querySelector("span").textContent = col.name;
      row.querySelector("input").addEventListener("change", async ev => {
        try {
          adoptUserData(await api(`/api/collections/${col.id}/items`, {
            method: "POST",
            body: JSON.stringify({ slug, remove: !ev.target.checked }),
          }));
        } catch (err) { alert(err.message); }
      });
      pop.appendChild(row);
    });

    const nw = document.createElement("div");
    nw.className = "bm-new";
    nw.innerHTML = `<input type="text" placeholder="دسته جدید…" maxlength="60"><button type="button">+</button>`;
    const nwInput = nw.querySelector("input");
    const addCollection = async () => {
      const name = nwInput.value.trim();
      if (!name) return;
      try {
        adoptUserData(await api("/api/collections", {
          method: "POST", body: JSON.stringify({ name }),
        }));
        const created = state.myCollections.find(c => c.name === name);
        if (created) {
          adoptUserData(await api(`/api/collections/${created.id}/items`, {
            method: "POST", body: JSON.stringify({ slug }),
          }));
        }
        closePopover();
      } catch (err) { alert(err.message); }
    };
    nw.querySelector("button").addEventListener("click", addCollection);
    nwInput.addEventListener("keydown", e => { if (e.key === "Enter") addCollection(); });
    pop.appendChild(nw);

    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    // Keep the panel inside the viewport on narrow screens.
    const left = Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - pop.offsetWidth - 12);
    pop.style.left = Math.max(window.scrollX + 8, left) + "px";
    pop.style.top = (r.bottom + window.scrollY + 6) + "px";
    openPopover = pop;
  }

  const isBookmarked = slug => state.myCollections.some(c => c.items.includes(slug));

  /** Re-sync every rendered card's like/bookmark buttons with current state. */
  function refreshCardStates() {
    document.querySelectorAll(".card").forEach(card => {
      const slug = card.dataset.slug;
      const like = card.querySelector(".like-btn");
      const bm = card.querySelector(".bm-btn");
      if (like) like.classList.toggle("is-on", state.likes.has(slug));
      if (bm) bm.classList.toggle("is-on", isBookmarked(slug));
    });
  }

  /* --------------------------- Theme ------------------------------- */

  const themeToggle = document.getElementById("themeToggle");
  const systemPrefersLight = () =>
    window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;

  // With no explicit choice the page follows the OS, so read that to decide
  // which way the next click should flip.
  const effectiveTheme = () =>
    document.documentElement.getAttribute("data-theme") ||
    (systemPrefersLight() ? "light" : "dark");

  themeToggle.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("markfont-theme", next); } catch { /* private mode */ }
  });

  const msHeader = document.getElementById("msHeader");
  function onScroll() {
    msHeader.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  async function init() {
    statsLine.textContent = "Loading font catalog…";
    const res = await fetch("fonts.json");
    const data = await res.json();
    state.all = data.families;
    prepareSearchIndex(state.all);
    state.collections = data.collections || [];

    // Restore an existing session, if the cookie is still good.
    try {
      const me = await api("/api/me");
      if (me.user) {
        state.user = me.user;
        if (Array.isArray(me.likes)) state.likes = new Set(me.likes);
        if (Array.isArray(me.collections)) state.myCollections = me.collections;
      }
    } catch { /* offline or static hosting: browsing still works */ }
    renderAccount();

    renderCollectionChips();
    previewInput.placeholder = DEFAULT_TEXT_EN;
    applyFilters();
  }

  init();
})();
