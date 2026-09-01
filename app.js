(() => {
  "use strict";

  const state = {
    all: [],
    filtered: [],
    lang: "all",       // all | fa | en
    style: "all",       // all | Sans | Serif | Handwriting | Monospace | Display | General
    collection: "all",  // all | one of the ids in fonts.json -> collections
    collections: [],
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
    const w = weightNames[v.weight] || v.weight;
    return `${w}${v.italic ? " Italic" : ""} (${v.weight})`;
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
    actions.appendChild(dlBtn);
    actions.appendChild(codeBtn);

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

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    let list = state.all.filter(f => {
      if (state.lang !== "all" && !f.langs.includes(state.lang)) return false;
      if (state.style !== "all" && !(f.styles || []).includes(state.style)) return false;
      if (state.collection !== "all" && !(f.collections || []).includes(state.collection)) return false;
      if (q && !f.family.toLowerCase().includes(q) && !f.slug.includes(q)) return false;
      return true;
    });
    if (state.sort === "name") {
      list = list.slice().sort((a, b) => a.family.localeCompare(b.family));
    } else if (state.sort === "styles") {
      list = list.slice().sort((a, b) => b.variants.length - a.variants.length);
    }
    state.filtered = list;
    state.rendered = 0;
    grid.innerHTML = "";
    renderMore();
    statsLine.textContent = `${state.filtered.length} of ${state.all.length} families`;
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
    state.collections = data.collections || [];
    renderCollectionChips();
    previewInput.placeholder = DEFAULT_TEXT_EN;
    applyFilters();
  }

  init();
})();
