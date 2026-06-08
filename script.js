// v0.9.0 - tablet-first Gullknapp OPS board

(function () {
  const STORAGE_KEY = "gullknapp_strips_v06";
  const STORAGE_META_KEY = "gullknapp_strips_meta_v090";
  const DB_URL = "./aircraft_db.json";

  const COLUMNS = ["groundActive", "departure", "arrival", "pattern", "training", "crossCountry", "encn"];
  const VALID_STATUSES = new Set(COLUMNS);

  let state = { strips: [], db: [] };
  let selectedStripId = null;

  const modalBackdrop = document.getElementById("modalBackdrop");
  const stripForm = document.getElementById("stripForm");
  const modalTitle = document.getElementById("modalTitle");
  const newStripBtn = document.getElementById("newStripBtn");
  const selectedEditBtn = document.getElementById("selectedEditBtn");
  const selectedDeleteBtn = document.getElementById("selectedDeleteBtn");
  const selectedClearBtn = document.getElementById("selectedClearBtn");
  const selectionReadout = document.getElementById("selectionReadout");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const menuBtn = document.getElementById("menuBtn");
  const menuPanel = document.getElementById("menuPanel");
  const exportBtn = document.getElementById("exportBtn");
  const importFile = document.getElementById("importFile");
  const clearAllBtn = document.getElementById("clearAllBtn");
  const changelogBtn = document.getElementById("changelogBtn");
  const changelogBackdrop = document.getElementById("changelogBackdrop");
  const closeChangelogBtn = document.getElementById("closeChangelogBtn");
  const summary = document.getElementById("summary");
  const clockLocal = document.getElementById("clockLocal");
  const clockUtc = document.getElementById("clockUtc");
  const board = document.getElementById("board");

  const f = {
    id: document.getElementById("stripId"),
    callsign: document.getElementById("callsign"),
    aircraftPick: document.getElementById("aircraftPick"),
    aircraftList: document.getElementById("aircraftList"),
    visiting: document.getElementById("visiting"),
    aircraft: document.getElementById("aircraft"),
    registration: document.getElementById("registration"),
    status: document.getElementById("status"),
    fueling: document.getElementById("fueling"),
    fuelingWrap: document.getElementById("fuelingWrap"),
    training: document.getElementById("training"),
    instructor: document.getElementById("instructor"),
    notes: document.getElementById("notes"),
    instructorWrap: document.getElementById("instructorWrap"),
  };

  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeInstructorCode(v) {
    return String(v || "").trim().toUpperCase().slice(0, 3);
  }

  function normalizeReg(v) {
    return String(v || "").trim().toUpperCase();
  }

  function normalizeText(v) {
    return String(v || "").trim().toUpperCase();
  }

  function normalizeStatus(status) {
    const s = String(status || "groundActive");
    if (VALID_STATUSES.has(s)) return s;
    if (s === "ground" || s === "fueling") return "groundActive";
    if (s === "airborne") return "departure";
    if (s === "enroute" || s === "standby" || s === "ENCN") return "encn";
    return "groundActive";
  }

  function statusShort(status, fueling) {
    if (fueling) return "FUEL";
    const map = {
      groundActive: "GND",
      departure: "DEP",
      arrival: "ARR",
      pattern: "TGL",
      training: "TRN",
      crossCountry: "X-C",
      encn: "ENCN"
    };
    return map[normalizeStatus(status)] || "GND";
  }

  function statusLabel(status) {
    const map = {
      groundActive: "Ground",
      departure: "Departure",
      arrival: "Arrival",
      pattern: "Pattern",
      training: "Training",
      crossCountry: "X-Country",
      encn: "ENCN"
    };
    return map[normalizeStatus(status)] || "Ground";
  }

  function formatHHMM(ms) {
    if (ms == null || !isFinite(ms) || ms < 0) return "00:00";
    const totalMin = Math.floor(ms / 60000);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
    const mm = String(totalMin % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function applyAirTimerTransition(strip, prevStatus, nextStatus) {
    const now = Date.now();
    const prevInAir = prevStatus !== "groundActive";
    const nextInAir = nextStatus !== "groundActive";

    if (!prevInAir && nextInAir) {
      strip.airborneStartMs = now;
      strip.lastAirTimeMs = null;
      return;
    }
    if (prevInAir && !nextInAir) {
      if (strip.airborneStartMs) strip.lastAirTimeMs = now - strip.airborneStartMs;
      strip.airborneStartMs = null;
    }
  }

  function loadStrips() {
    state.strips = safeJsonParse(localStorage.getItem(STORAGE_KEY), []) || [];
    state.strips = state.strips
      .filter(s => s && s.id && s.callsign)
      .map(s => {
        const status = normalizeStatus(s.status);
        return {
          id: String(s.id),
          callsign: normalizeText(s.callsign),
          aircraft: normalizeText(s.aircraft),
          registration: normalizeReg(s.registration),
          wake: normalizeText(s.wake),
          status,
          fueling: Boolean(s.fueling || s.status === "fueling"),
          training: ["none", "solo", "instructor"].includes(s.training) ? s.training : "none",
          instructor: normalizeInstructorCode(s.instructor),
          notes: String(s.notes || "").trim(),
          airborneStartMs: typeof s.airborneStartMs === "number" ? s.airborneStartMs : null,
          lastAirTimeMs: typeof s.lastAirTimeMs === "number" ? s.lastAirTimeMs : null,
          createdAt: s.createdAt || Date.now()
        };
      });
  }

  function saveStrips() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.strips));
      localStorage.setItem(STORAGE_META_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        selectedStripId
      }));
    } catch (err) {
      console.warn("Strip save failed", err);
    }
  }

  function flushStateToStorage() {
    saveStrips();
  }

  async function loadAircraftDB() {
    try {
      const res = await fetch(DB_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("DB fetch failed");
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("DB format");
      state.db = data.map(x => ({
        registration: normalizeReg(x.registration),
        type: normalizeText(x.type),
        notes: String(x.notes || "").trim()
      }));
    } catch {
      state.db = [];
    }
    fillDatalist();
  }

  function fillDatalist() {
    f.aircraftList.innerHTML = "";
    for (const a of state.db) {
      const opt = document.createElement("option");
      opt.value = a.registration;
      opt.label = `${a.registration} - ${a.type}`;
      f.aircraftList.appendChild(opt);
    }
  }

  function getDbAircraftByReg(reg) {
    const r = normalizeReg(reg);
    return state.db.find(a => a.registration === r) || null;
  }

  function setManualEnabled(enabled) {
    f.aircraft.disabled = !enabled;
    f.registration.disabled = !enabled;
    f.aircraftPick.disabled = enabled;
  }

  function updateFuelingVisibility() {
    const onGround = normalizeStatus(f.status.value) === "groundActive";
    if (f.fuelingWrap) f.fuelingWrap.style.display = onGround ? "flex" : "none";
    if (!onGround) f.fueling.value = "no";
  }

  function updateStatusButtons() {
    const current = normalizeStatus(f.status.value);
    document.querySelectorAll("[data-status-btn]").forEach(btn => {
      btn.classList.toggle("active", normalizeStatus(btn.dataset.statusBtn) === current);
    });
  }

  function setFormStatus(status) {
    f.status.value = normalizeStatus(status);
    updateFuelingVisibility();
    updateStatusButtons();
  }

  function updateInstructorVisibility() {
    const show = f.training.value === "instructor";
    f.instructorWrap.style.display = show ? "flex" : "none";
    if (!show) f.instructor.value = "";
  }

  function applyPickedAircraft() {
    const picked = normalizeReg(f.aircraftPick.value);
    const a = getDbAircraftByReg(picked);
    if (!a) return;
    f.registration.value = a.registration;
    f.aircraft.value = a.type || "";
  }

  function openModal(mode, strip) {
    modalBackdrop.classList.remove("hidden");
    modalBackdrop.setAttribute("aria-hidden", "false");

    if (mode === "new") {
      modalTitle.textContent = "Add aircraft";
      deleteBtn.hidden = true;
      f.id.value = "";
      f.callsign.value = "";
      f.aircraftPick.value = "";
      f.visiting.value = "no";
      f.aircraft.value = "";
      f.registration.value = "";
      setFormStatus("groundActive");
      f.fueling.value = "no";
      f.training.value = "none";
      f.instructor.value = "";
      f.notes.value = "";
      setManualEnabled(false);
      updateInstructorVisibility();
      updateFuelingVisibility();
      setTimeout(() => f.callsign.focus(), 0);
      return;
    }

    modalTitle.textContent = "Edit aircraft";
    deleteBtn.hidden = false;

    f.id.value = strip.id;
    f.callsign.value = strip.callsign || "";

    const match = getDbAircraftByReg(strip.registration);
    f.aircraftPick.value = match ? match.registration : "";
    f.visiting.value = match ? "no" : "yes";
    f.aircraft.value = strip.aircraft || "";
    f.registration.value = strip.registration || "";
    setFormStatus(strip.status);
    f.fueling.value = strip.fueling ? "yes" : "no";
    f.training.value = strip.training || "none";
    f.instructor.value = strip.instructor || "";
    f.notes.value = strip.notes || "";
    setManualEnabled(f.visiting.value === "yes");
    updateInstructorVisibility();
    updateFuelingVisibility();
    setTimeout(() => f.callsign.focus(), 0);
  }

  function closeModal() {
    modalBackdrop.classList.add("hidden");
    modalBackdrop.setAttribute("aria-hidden", "true");
  }

  function openChangelog() {
    changelogBackdrop.classList.remove("hidden");
    changelogBackdrop.setAttribute("aria-hidden", "false");
  }

  function closeChangelog() {
    changelogBackdrop.classList.add("hidden");
    changelogBackdrop.setAttribute("aria-hidden", "true");
  }

  function closeMenu() {
    menuPanel.classList.add("hidden");
    menuBtn.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    const isHidden = menuPanel.classList.contains("hidden");
    if (isHidden) {
      menuPanel.classList.remove("hidden");
      menuBtn.setAttribute("aria-expanded", "true");
    } else {
      closeMenu();
    }
  }

  function getSelectedStrip() {
    return state.strips.find(s => s.id === selectedStripId) || null;
  }

  function setSelectedStrip(id) {
    selectedStripId = id ? String(id) : null;
    updateSelectedControls();
    document.querySelectorAll(".strip").forEach(el => {
      el.classList.toggle("selected", !!selectedStripId && el.dataset.id === selectedStripId);
    });
    updateSmartLayout();
  }

  function updateSelectedControls() {
    const s = getSelectedStrip();
    const hasSelection = Boolean(s);
    selectedEditBtn.disabled = !hasSelection;
    selectedDeleteBtn.disabled = !hasSelection;
    selectedClearBtn.disabled = !hasSelection;
    selectionReadout.classList.toggle("active", hasSelection);
    selectionReadout.textContent = hasSelection
      ? `${s.callsign || "-"} | ${s.registration || "-"} | ${statusLabel(s.status)}`
      : "No strip selected";
  }

  function updateSmartLayout() {
    const selected = getSelectedStrip();
    const selectedColumn = selected ? normalizeStatus(selected.status) : null;
    document.querySelectorAll(".column").forEach(colEl => {
      colEl.classList.toggle("primary", selectedColumn === colEl.dataset.column);
    });
  }

  function setPatternAlert() {
    const patternCount = state.strips.filter(s => s.status === "pattern").length;
    const patternCol = document.querySelector('[data-column="pattern"]');
    if (patternCol) patternCol.classList.toggle("alert", patternCount > 2);
  }

  function computeSummary() {
    const counts = Object.fromEntries(COLUMNS.map(col => [col, state.strips.filter(s => s.status === col).length]));
    document.querySelectorAll("[data-count]").forEach(el => {
      el.textContent = String(counts[el.dataset.count] || 0);
    });

    const total = state.strips.length;
    summary.textContent = `GND ${counts.groundActive || 0} | DEP ${counts.departure || 0} | ARR ${counts.arrival || 0} | TGL ${counts.pattern || 0} | TRN ${counts.training || 0} | X-C ${counts.crossCountry || 0} | ENCN ${counts.encn || 0} | TOTAL ${total}`;
  }

  function getAirTimeHtml(strip) {
    let airMs = null;
    if (strip.status !== "groundActive" && typeof strip.airborneStartMs === "number") {
      airMs = Date.now() - strip.airborneStartMs;
    } else if (typeof strip.lastAirTimeMs === "number") {
      airMs = strip.lastAirTimeMs;
    }
    return airMs != null
      ? `<div class="airtime"><span>AIR</span><b>${formatHHMM(airMs)}</b></div>`
      : "";
  }

  function render() {
    document.querySelectorAll(".strip-container").forEach(c => { c.innerHTML = ""; });

    for (const strip of state.strips) {
      strip.status = normalizeStatus(strip.status);
      if (strip.status !== "groundActive" && (strip.airborneStartMs == null || !isFinite(strip.airborneStartMs)) && strip.lastAirTimeMs == null) {
        strip.airborneStartMs = Date.now();
      }

      const el = document.createElement("div");
      el.className = "strip" + (strip.training === "solo" ? " solo" : "") + (strip.id === selectedStripId ? " selected" : "");
      el.dataset.id = strip.id;
      el.dataset.status = strip.status;
      el.dataset.fueling = strip.fueling ? "yes" : "no";

      const callsign = escapeHtml(strip.callsign || "-");
      const type = escapeHtml(strip.aircraft || "-");
      const reg = escapeHtml(strip.registration || "-");
      const status = escapeHtml(statusShort(strip.status, strip.fueling));
      const instr = strip.training === "instructor" ? `CFI ${escapeHtml(strip.instructor || "---")}` : (strip.training === "solo" ? "SOLO" : "");
      const remarks = escapeHtml(strip.notes || instr || "");
      const badges = [];

      if (strip.training === "solo") badges.push('<span class="badge solo">SOLO</span>');
      if (strip.training === "instructor") badges.push(`<span class="badge cfi">CFI ${escapeHtml(strip.instructor || "---")}</span>`);
      if (strip.fueling) badges.push('<span class="badge fuel">FUEL</span>');

      el.innerHTML = `
        <div class="statusBand"></div>
        <div class="strip-grid">
          <div class="fcell callsign">
            <div class="lab">Callsign</div>
            <div class="val">${callsign}</div>
            <div class="badges">${badges.join("")}</div>
          </div>
          <div class="fcell typeCell">
            <div class="lab">Type</div>
            <div class="val">${type}</div>
            <div class="sub">${instr}</div>
          </div>
          <div class="fcell regCell">
            <div class="lab">Registration</div>
            <div class="val">${reg}</div>
            <div class="sub">${getAirTimeHtml(strip)}</div>
          </div>
          <div class="fcell infoCell">
            <div class="lab">Info</div>
            <div class="val">${strip.fueling ? "FUEL" : (strip.training === "solo" ? "SOLO" : "")}</div>
            <div class="sub">${escapeHtml(strip.wake || "")}</div>
          </div>
          <div class="fcell statusCell">
            <div class="lab">Status</div>
            <div class="val">${status}</div>
          </div>
          <div class="notesLine">${remarks}</div>
        </div>
      `;

      el.addEventListener("click", ev => {
        ev.stopPropagation();
        setSelectedStrip(strip.id);
      });

      el.addEventListener("dblclick", ev => {
        ev.stopPropagation();
        const s = state.strips.find(x => x.id === strip.id);
        if (s) openModal("edit", s);
      });

      const container = document.querySelector(`[data-column="${strip.status}"] .strip-container`);
      if (container) container.appendChild(el);
    }

    if (selectedStripId && !state.strips.some(s => s.id === selectedStripId)) selectedStripId = null;
    setPatternAlert();
    computeSummary();
    updateSelectedControls();
    updateSmartLayout();
    saveStrips();
  }

  function refreshOrderFromDOM() {
    const newOrder = [];
    for (const col of COLUMNS) {
      const container = document.querySelector(`[data-column="${col}"] .strip-container`);
      if (!container) continue;
      for (const el of container.querySelectorAll(".strip")) {
        const strip = state.strips.find(s => s.id === el.dataset.id);
        if (strip) newOrder.push(strip);
      }
    }
    for (const strip of state.strips) {
      if (!newOrder.some(s => s.id === strip.id)) newOrder.push(strip);
    }
    state.strips = newOrder;
    saveStrips();
  }

  function initSortable() {
    if (typeof Sortable === "undefined") {
      board.classList.add("dragUnavailable");
      console.warn("SortableJS is unavailable. Drag and drop is disabled until the library loads.");
      return;
    }

    document.querySelectorAll(".strip-container").forEach(container => {
      new Sortable(container, {
        group: "shared",
        animation: 160,
        forceFallback: true,
        fallbackOnBody: true,
        swapThreshold: 0.65,
        ghostClass: "sortable-ghost",
        chosenClass: "sortable-chosen",
        dragClass: "sortable-drag",
        onEnd: evt => {
          const id = evt.item?.dataset?.id;
          const newColumn = evt.to.closest(".column")?.dataset?.column;
          const strip = state.strips.find(s => s.id === id);
          if (!id || !newColumn || !strip) return;

          const prevStatus = strip.status;
          strip.status = normalizeStatus(newColumn);
          if (strip.status !== "groundActive") strip.fueling = false;
          applyAirTimerTransition(strip, prevStatus, strip.status);
          refreshOrderFromDOM();
          render();
        }
      });
    });
  }

  function updateClocks() {
    const now = new Date();
    clockLocal.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Oslo",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(now);

    clockUtc.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(now);
  }

  function editSelectedStrip() {
    const s = getSelectedStrip();
    if (s) openModal("edit", s);
  }

  function deleteSelectedStrip() {
    const s = getSelectedStrip();
    if (!s || !confirm(`Delete ${s.callsign}?`)) return;
    state.strips = state.strips.filter(x => x.id !== s.id);
    selectedStripId = null;
    saveStrips();
    render();
  }

  function clearSelectedStrip() {
    setSelectedStrip(null);
  }

  function installUppercaseInput(el) {
    if (!el) return;
    el.addEventListener("input", () => {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = el.value.toUpperCase();
      try { el.setSelectionRange(start, end); } catch {}
    });
  }

  newStripBtn.addEventListener("click", () => openModal("new"));
  selectedEditBtn.addEventListener("click", editSelectedStrip);
  selectedDeleteBtn.addEventListener("click", deleteSelectedStrip);
  selectedClearBtn.addEventListener("click", clearSelectedStrip);

  menuBtn.addEventListener("click", e => {
    e.stopPropagation();
    toggleMenu();
  });
  menuPanel.addEventListener("click", e => e.stopPropagation());
  document.addEventListener("click", () => closeMenu());

  closeModalBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", e => { if (e.target === modalBackdrop) closeModal(); });

  changelogBtn.addEventListener("click", () => {
    closeMenu();
    openChangelog();
  });
  closeChangelogBtn.addEventListener("click", closeChangelog);
  changelogBackdrop.addEventListener("click", e => { if (e.target === changelogBackdrop) closeChangelog(); });

  board.addEventListener("click", () => clearSelectedStrip());

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeMenu();
      closeModal();
      closeChangelog();
      return;
    }
    if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      openModal("new");
    }
  });

  f.aircraftPick.addEventListener("change", applyPickedAircraft);
  f.aircraftPick.addEventListener("blur", applyPickedAircraft);
  f.visiting.addEventListener("change", () => {
    const manual = f.visiting.value === "yes";
    setManualEnabled(manual);
    if (!manual) applyPickedAircraft();
  });
  f.training.addEventListener("change", updateInstructorVisibility);
  f.status.addEventListener("change", () => {
    updateFuelingVisibility();
    updateStatusButtons();
  });
  document.querySelectorAll("[data-status-btn]").forEach(btn => {
    btn.addEventListener("click", () => setFormStatus(btn.dataset.statusBtn));
  });

  [f.callsign, f.aircraftPick, f.aircraft, f.registration, f.instructor].forEach(installUppercaseInput);

  clearAllBtn.addEventListener("click", () => {
    closeMenu();
    if (!confirm("Clear all strips from the board?")) return;
    state.strips = [];
    selectedStripId = null;
    saveStrips();
    render();
  });

  exportBtn.addEventListener("click", () => {
    closeMenu();
    const payload = { exportedAt: new Date().toISOString(), strips: state.strips };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gullknapp-traffic-board-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  importFile.addEventListener("change", async () => {
    closeMenu();
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = safeJsonParse(text, null);
      if (!data || !Array.isArray(data.strips)) throw new Error("Invalid backup file.");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.strips));
      loadStrips();
      selectedStripId = null;
      render();
      alert("Import successful.");
    } catch (err) {
      alert("Import failed: " + (err?.message || err));
    } finally {
      importFile.value = "";
    }
  });

  stripForm.addEventListener("submit", e => {
    e.preventDefault();

    const id = f.id.value ? String(f.id.value) : String(Date.now());
    const existing = state.strips.find(s => s.id === id);
    const next = {
      id,
      callsign: normalizeText(f.callsign.value),
      aircraft: normalizeText(f.aircraft.value),
      registration: normalizeReg(f.registration.value),
      status: normalizeStatus(f.status.value),
      fueling: f.fueling.value === "yes",
      training: String(f.training.value || "none"),
      instructor: normalizeInstructorCode(f.instructor.value),
      notes: String(f.notes.value || "").trim(),
      createdAt: existing ? existing.createdAt : Date.now()
    };

    if (!next.callsign) {
      alert("Callsign is required.");
      return;
    }

    if (next.status !== "groundActive") next.fueling = false;
    if (next.training !== "instructor") next.instructor = "";

    if (f.visiting.value === "no") {
      const match = getDbAircraftByReg(next.registration || f.aircraftPick.value);
      if (match) {
        next.registration = match.registration;
        next.aircraft = match.type || next.aircraft;
      }
    }

    if (existing) {
      const prevStatus = existing.status;
      Object.assign(existing, next);
      applyAirTimerTransition(existing, prevStatus, existing.status);
    } else {
      next.airborneStartMs = next.status !== "groundActive" ? Date.now() : null;
      next.lastAirTimeMs = null;
      state.strips.push(next);
      selectedStripId = next.id;
    }

    saveStrips();
    render();
    closeModal();
  });

  deleteBtn.addEventListener("click", () => {
    const id = String(f.id.value || "");
    const s = state.strips.find(x => x.id === id);
    if (!s || !confirm(`Delete ${s.callsign}?`)) return;
    state.strips = state.strips.filter(x => x.id !== id);
    selectedStripId = null;
    saveStrips();
    render();
    closeModal();
  });

  window.addEventListener("pagehide", flushStateToStorage);
  window.addEventListener("beforeunload", flushStateToStorage);
  window.addEventListener("blur", flushStateToStorage);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushStateToStorage();
  });
  document.addEventListener("freeze", flushStateToStorage);
  setInterval(flushStateToStorage, 5000);

  loadStrips();
  initSortable();
  render();
  updateClocks();
  setInterval(updateClocks, 1000);
  setInterval(render, 30000);
  loadAircraftDB();
})();
