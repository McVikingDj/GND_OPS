// Gullknapp Ops Strip Board - v2 (static, GitHub Pages friendly)

(function () {
  const STORAGE_KEY = "gullknapp_strips_v2";
  const SETTINGS_KEY = "gullknapp_settings_v2";

  const DEFAULT_COLUMNS = ["inbound", "ground", "turnaround", "ready", "departed"];

  // ---- State ----
  let state = {
    strips: [],
    settings: {
      autoSort: false
    }
  };

  // ---- DOM ----
  const modalBackdrop = document.getElementById("modalBackdrop");
  const stripForm = document.getElementById("stripForm");
  const modalTitle = document.getElementById("modalTitle");

  const newStripBtn = document.getElementById("newStripBtn");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const deleteBtn = document.getElementById("deleteBtn");

  const autoSortToggle = document.getElementById("autoSortToggle");
  const exportBtn = document.getElementById("exportBtn");
  const importFile = document.getElementById("importFile");
  const clearDepartedBtn = document.getElementById("clearDepartedBtn");

  const clockLocal = document.getElementById("clockLocal");
  const clockUtc = document.getElementById("clockUtc");

  // Form fields
  const f = {
    id: document.getElementById("stripId"),
    callsign: document.getElementById("callsign"),
    category: document.getElementById("category"),
    from: document.getElementById("from"),
    to: document.getElementById("to"),
    aircraft: document.getElementById("aircraft"),
    pob: document.getElementById("pob"),
    eta: document.getElementById("eta"),
    etd: document.getElementById("etd"),
    notes: document.getElementById("notes"),
  };

  // ---- Helpers ----
  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function load() {
    state.strips = safeJsonParse(localStorage.getItem(STORAGE_KEY), []) || [];
    state.settings = safeJsonParse(localStorage.getItem(SETTINGS_KEY), { autoSort: false }) || { autoSort: false };

    // Basic migration safety
    state.strips = state.strips
      .filter(s => s && s.id && s.callsign)
      .map(s => ({
        id: String(s.id),
        callsign: s.callsign || "",
        category: s.category || "scheduled",
        from: s.from || "",
        to: s.to || "",
        aircraft: s.aircraft || "",
        pob: s.pob || "",
        eta: s.eta || "",
        etd: s.etd || "",
        notes: s.notes || "",
        column: DEFAULT_COLUMNS.includes(s.column) ? s.column : "inbound",
        createdAt: s.createdAt || Date.now()
      }));
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.strips));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function openModal(mode, strip) {
    modalBackdrop.classList.remove("hidden");
    modalBackdrop.setAttribute("aria-hidden", "false");

    if (mode === "new") {
      modalTitle.textContent = "New strip";
      deleteBtn.hidden = true;
      f.id.value = "";
      f.callsign.value = "";
      f.category.value = "scheduled";
      f.from.value = "";
      f.to.value = "";
      f.aircraft.value = "";
      f.pob.value = "";
      f.eta.value = "";
      f.etd.value = "";
      f.notes.value = "";
      setTimeout(() => f.callsign.focus(), 0);
      return;
    }

    modalTitle.textContent = "Edit strip";
    deleteBtn.hidden = false;

    f.id.value = strip.id;
    f.callsign.value = strip.callsign || "";
    f.category.value = strip.category || "scheduled";
    f.from.value = strip.from || "";
    f.to.value = strip.to || "";
    f.aircraft.value = strip.aircraft || "";
    f.pob.value = strip.pob || "";
    f.eta.value = strip.eta || "";
    f.etd.value = strip.etd || "";
    f.notes.value = strip.notes || "";
    setTimeout(() => f.callsign.focus(), 0);
  }

  function closeModal() {
    modalBackdrop.classList.add("hidden");
    modalBackdrop.setAttribute("aria-hidden", "true");
  }

  function normalizeHHMM(value) {
    if (!value) return "";
    const v = String(value).trim();
    // Accept HHMM, H:MM, HH:MM
    const m1 = v.match(/^([0-2]?\d):([0-5]\d)$/);
    if (m1) return `${m1[1].padStart(2, "0")}:${m1[2]}`;

    const m2 = v.match(/^([0-2]?\d)([0-5]\d)$/);
    if (m2) return `${m2[1].padStart(2, "0")}:${m2[2]}`;

    return v; // leave as-is if unknown format
  }

  function minutesDeltaFromNowLocal(hhmm) {
    // Local (Europe/Oslo) today, compare to now (local). Returns minutes (time - now).
    if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;

    const now = new Date();
    const [H, M] = hhmm.split(":").map(Number);
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), H, M, 0, 0);
    const diffMs = t.getTime() - now.getTime();
    return Math.round(diffMs / 60000);
  }

  function timeKeyForStrip(strip) {
    // For auto-sort: INBOUND uses ETA, READY uses ETD, others prefer ETD then ETA.
    const col = strip.column;
    const eta = normalizeHHMM(strip.eta);
    const etd = normalizeHHMM(strip.etd);

    const pick = (col === "inbound") ? eta
      : (col === "ready") ? etd
      : (etd || eta);

    if (!pick || !/^\d{2}:\d{2}$/.test(pick)) return 99999;

    const [h, m] = pick.split(":").map(Number);
    return h * 60 + m;
  }

  function isOverdue(strip) {
    // INBOUND: ETA passed by > 5 min
    // READY/TURNAROUND/GROUND: ETD passed by > 10 min (if provided)
    const eta = normalizeHHMM(strip.eta);
    const etd = normalizeHHMM(strip.etd);

    if (strip.column === "inbound" && eta) {
      const d = minutesDeltaFromNowLocal(eta);
      return (d !== null && d < -5);
    }

    if ((strip.column === "ready" || strip.column === "turnaround" || strip.column === "ground") && etd) {
      const d = minutesDeltaFromNowLocal(etd);
      return (d !== null && d < -10);
    }

    return false;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function render() {
    // Clear containers
    document.querySelectorAll(".strip-container").forEach(c => c.innerHTML = "");

    // Auto-sort (non-destructive on visual order) – we still keep array order, but render sorted when enabled.
    let renderList = state.strips.slice();
    if (state.settings.autoSort) {
      renderList.sort((a, b) => {
        if (a.column !== b.column) return DEFAULT_COLUMNS.indexOf(a.column) - DEFAULT_COLUMNS.indexOf(b.column);
        const ka = timeKeyForStrip(a);
        const kb = timeKeyForStrip(b);
        if (ka !== kb) return ka - kb;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
    }

    for (const strip of renderList) {
      const el = document.createElement("div");
      el.className = "strip" + (isOverdue(strip) ? " overdue" : "");
      el.dataset.id = strip.id;
      el.dataset.category = strip.category || "scheduled";

      const route = [strip.from, strip.to].filter(Boolean).join(" → ") || "—";
      const aircraft = strip.aircraft ? escapeHtml(strip.aircraft) : "—";
      const pob = strip.pob ? escapeHtml(strip.pob) : "—";

      const eta = normalizeHHMM(strip.eta);
      const etd = normalizeHHMM(strip.etd);

      el.innerHTML = `
        <div class="band"></div>
        <div class="actions">
          <button class="mini editbtn" title="Edit">Edit</button>
          <button class="mini delbtn" title="Delete">Del</button>
        </div>

        <div class="row1">
          <div class="callsign">${escapeHtml(strip.callsign)}</div>
          <div class="aircraft">${aircraft}</div>
        </div>

        <div class="route">${escapeHtml(route)}</div>

        <div class="times">
          <div><b>ETA</b> ${escapeHtml(eta || "—")}</div>
          <div><b>ETD</b> ${escapeHtml(etd || "—")}</div>
        </div>

        <div class="meta">
          <div><b>POB</b> ${pob}</div>
          <div><b>CAT</b> ${escapeHtml(strip.category || "—")}</div>
        </div>

        ${strip.notes ? `<div class="notes">${escapeHtml(strip.notes)}</div>` : ""}
      `;

      // Button handlers
      el.querySelector(".editbtn").addEventListener("click", (ev) => {
        ev.stopPropagation();
        const s = state.strips.find(x => x.id === strip.id);
        if (s) openModal("edit", s);
      });

      el.querySelector(".delbtn").addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (confirm(`Delete strip ${strip.callsign}?`)) {
          state.strips = state.strips.filter(x => x.id !== strip.id);
          save();
          render();
        }
      });

      // Click strip to edit
      el.addEventListener("click", () => {
        const s = state.strips.find(x => x.id === strip.id);
        if (s) openModal("edit", s);
      });

      const container = document.querySelector(`[data-column="${strip.column}"] .strip-container`);
      if (container) container.appendChild(el);
    }

    save();
  }

  function refreshOrderFromDOM() {
    // When autosort is ON, we don't preserve manual ordering.
    if (state.settings.autoSort) return;

    // Build new order by iterating columns in order and reading DOM order
    const newOrder = [];
    for (const col of DEFAULT_COLUMNS) {
      const container = document.querySelector(`[data-column="${col}"] .strip-container`);
      if (!container) continue;
      const ids = Array.from(container.querySelectorAll(".strip")).map(el => el.dataset.id);

      for (const id of ids) {
        const s = state.strips.find(x => x.id === id);
        if (s) newOrder.push(s);
      }
    }
    // Keep any stray items (shouldn't happen)
    for (const s of state.strips) {
      if (!newOrder.some(x => x.id === s.id)) newOrder.push(s);
    }
    state.strips = newOrder;
    save();
  }

  // ---- Drag & drop ----
  function initSortable() {
    document.querySelectorAll(".strip-container").forEach(container => {
      new Sortable(container, {
        group: "shared",
        animation: 150,
        forceFallback: true,
        fallbackOnBody: true,
        swapThreshold: 0.65,
        onEnd: function (evt) {
          const id = evt.item?.dataset?.id;
          if (!id) return;

          const newColumn = evt.to.closest(".column")?.dataset?.column;
          if (!newColumn) return;

          const strip = state.strips.find(s => s.id === id);
          if (strip) {
            strip.column = newColumn;
            refreshOrderFromDOM();
            save();
            render();
          }
        }
      });
    });
  }

  // ---- Clocks ----
  function updateClocks() {
    const now = new Date();
    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Oslo",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(now);

    const utcTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(now);

    clockLocal.textContent = localTime;
    clockUtc.textContent = utcTime;
  }

  // ---- Events ----
  newStripBtn.addEventListener("click", () => openModal("new"));
  closeModalBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);

  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Avoid triggering while typing in inputs
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      openModal("new");
    }
  });

  autoSortToggle.addEventListener("change", () => {
    state.settings.autoSort = !!autoSortToggle.checked;
    save();
    render();
  });

  clearDepartedBtn.addEventListener("click", () => {
    if (!confirm("Clear all strips in DEPARTED?")) return;
    state.strips = state.strips.filter(s => s.column !== "departed");
    save();
    render();
  });

  exportBtn.addEventListener("click", () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      strips: state.strips,
      settings: state.settings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "gullknapp-stripboard-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = safeJsonParse(text, null);
      if (!data || !Array.isArray(data.strips)) throw new Error("Invalid backup file.");

      state.strips = data.strips;
      state.settings = data.settings || state.settings;

      // Normalize
      load();
      // Apply imported (load() would overwrite from localStorage, so re-assign + normalize)
      state.strips = (data.strips || []).map(s => ({
        id: String(s.id || Date.now()),
        callsign: s.callsign || "",
        category: s.category || "scheduled",
        from: s.from || "",
        to: s.to || "",
        aircraft: s.aircraft || "",
        pob: s.pob || "",
        eta: s.eta || "",
        etd: s.etd || "",
        notes: s.notes || "",
        column: DEFAULT_COLUMNS.includes(s.column) ? s.column : "inbound",
        createdAt: s.createdAt || Date.now()
      }));
      state.settings = { autoSort: !!(data.settings && data.settings.autoSort) };

      save();
      autoSortToggle.checked = state.settings.autoSort;
      render();
      alert("Import successful.");
    } catch (err) {
      alert("Import failed: " + (err?.message || err));
    } finally {
      importFile.value = "";
    }
  });

  stripForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const id = f.id.value ? String(f.id.value) : String(Date.now());
    const existing = state.strips.find(s => s.id === id);

    const next = {
      id,
      callsign: String(f.callsign.value || "").trim(),
      category: String(f.category.value || "scheduled"),
      from: String(f.from.value || "").trim().toUpperCase(),
      to: String(f.to.value || "").trim().toUpperCase(),
      aircraft: String(f.aircraft.value || "").trim().toUpperCase(),
      pob: String(f.pob.value || "").trim(),
      eta: normalizeHHMM(f.eta.value),
      etd: normalizeHHMM(f.etd.value),
      notes: String(f.notes.value || "").trim(),
      column: existing ? existing.column : "inbound",
      createdAt: existing ? existing.createdAt : Date.now()
    };

    if (!next.callsign) {
      alert("Callsign is required.");
      return;
    }

    if (existing) {
      Object.assign(existing, next);
    } else {
      state.strips.push(next);
    }

    save();
    render();
    closeModal();
  });

  deleteBtn.addEventListener("click", () => {
    const id = String(f.id.value || "");
    if (!id) return;
    const s = state.strips.find(x => x.id === id);
    if (!s) return;

    if (confirm(`Delete strip ${s.callsign}?`)) {
      state.strips = state.strips.filter(x => x.id !== id);
      save();
      render();
      closeModal();
    }
  });

  // When modal opens for edit, show delete button
  const originalOpenModal = openModal;
  openModal = function(mode, strip){
    originalOpenModal(mode, strip);
    deleteBtn.hidden = (mode !== "edit");
  };

  // ---- Init ----
  load();
  autoSortToggle.checked = !!state.settings.autoSort;
  initSortable();
  render();
  updateClocks();
  setInterval(updateClocks, 1000);
  // Re-render to update overdue highlighting
  setInterval(render, 30_000);
})();