// v0.8.2 - robust iPad state persistence

(function () {
  const STORAGE_KEY = "gullknapp_strips_v06";
  const STORAGE_META_KEY = "gullknapp_strips_meta_v082";
  const DB_URL = "./aircraft_db.json";

  const COLUMNS = ["departure","arrival","training","crossCountry","groundActive","pattern","encn"];
  const VALID_STATUSES = new Set(COLUMNS);
  let state = { strips: [], db: [] };
  let selectedStripId = null;

  // DOM
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

  // Form
  const f = {
    id: document.getElementById("stripId"),
    callsign: document.getElementById("callsign"),
    aircraftPick: document.getElementById("aircraftPick"),
    aircraftList: document.getElementById("aircraftList"),
    visiting: document.getElementById("visiting"),
    aircraft: document.getElementById("aircraft"),
    registration: document.getElementById("registration"),
    wake: document.getElementById("wake"),
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

  function normalizeInstructorCode(v){
    const s = String(v || "").trim().toUpperCase();
    return s.slice(0, 3);
  }

  function normalizeReg(v){
    return String(v || "").trim().toUpperCase();
  }

  function formatHHMM(ms){
    if (ms == null || !isFinite(ms) || ms < 0) return "00:00";
    const totalMin = Math.floor(ms / 60000);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
    const mm = String(totalMin % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

    function applyAirTimerTransition(strip, prevStatus, nextStatus){
    const now = Date.now();
    const prevInAir = (prevStatus !== "groundActive");
    const nextInAir = (nextStatus !== "groundActive");
    if (!prevInAir && nextInAir){
      strip.airborneStartMs = now;
      strip.lastAirTimeMs = null;
      return;
    }
    if (prevInAir && nextInAir){
      return;
    }
    if (prevInAir && !nextInAir){
      if (strip.airborneStartMs){
        strip.lastAirTimeMs = now - strip.airborneStartMs;
      }
      strip.airborneStartMs = null;
    }
  }

  function normalizeStatus(status) {
    const s = String(status || "groundActive");
    if (VALID_STATUSES.has(s)) return s;

    // Backwards compatibility for older stored/imported boards.
    if (s === "ground" || s === "fueling") return "groundActive";
    if (s === "airborne") return "departure";
    if (s === "enroute" || s === "standby" || s === "ENCN") return "encn";
    return "groundActive";
  }

  function loadStrips() {
    state.strips = safeJsonParse(localStorage.getItem(STORAGE_KEY), []) || [];
    state.strips = state.strips
      .filter(s => s && s.id && s.callsign)
      .map(s => {
        const status = normalizeStatus(s.status);
        return {
          id: String(s.id),
          callsign: String(s.callsign || "").trim(),
          aircraft: String(s.aircraft || "").trim().toUpperCase(),
          registration: String(s.registration || "").trim().toUpperCase(),
          wake: String(s.wake || "").trim().toUpperCase(),
          status,
          fueling: Boolean(s.fueling || s.status === "fueling"),
          training: ["none","solo","instructor"].includes(s.training) ? s.training : "none",
          instructor: normalizeInstructorCode(s.instructor),
          notes: String(s.notes || "").trim(),
          airborneStartMs: (typeof s.airborneStartMs === "number" ? s.airborneStartMs : null),
          lastAirTimeMs: (typeof s.lastAirTimeMs === "number" ? s.lastAirTimeMs : null),
          createdAt: s.createdAt || Date.now()
        };
      });
  }

  function saveStrips() {
    // localStorage is synchronous, which is useful on iPad/Safari when the browser
    // may suspend the tab quickly after switching apps. Keep this function small
    // and call it after every state/order change.
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

  function flushStateToStorage(){
    saveStrips();
  }

  async function loadAircraftDB() {
    try {
      // Fetching local JSON from GitHub Pages works. Opening as file:// may require a local server.
      const res = await fetch(DB_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("DB fetch failed");
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("DB format");
      state.db = data.map(x => ({
        registration: normalizeReg(x.registration),
        type: String(x.type || "").trim().toUpperCase(),
          notes: String(x.notes || "").trim()
      }));
      fillDatalist();
    } catch (e) {
      state.db = [];
      // No hard error UI; user can still type manually.
      fillDatalist();
    }
  }

  function fillDatalist() {
    f.aircraftList.innerHTML = "";
    for (const a of state.db) {
      const opt = document.createElement("option");
      opt.value = a.registration;
      opt.label = `${a.registration} • ${a.type}`;
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
    if (f.wake) f.wake.disabled = !enabled;
    f.aircraftPick.disabled = enabled; // if manual, disable picker
  }

  function updateFuelingVisibility(){
    const s = normalizeStatus(f.status.value);
    const onGround = (s === "groundActive");
    if (f.fuelingWrap) f.fuelingWrap.style.display = onGround ? "flex" : "none";
    if (!onGround) f.fueling.value = "no";
  }

  function updateStatusButtons(){
    const current = normalizeStatus(f.status.value);
    document.querySelectorAll("[data-status-btn]").forEach(btn => {
      btn.classList.toggle("active", normalizeStatus(btn.dataset.statusBtn) === current);
    });
  }

  function setFormStatus(status){
    f.status.value = normalizeStatus(status);
    updateFuelingVisibility();
    updateStatusButtons();
  }

  function updateInstructorVisibility(){
    const t = f.training.value;
    const show = (t === "instructor");
    f.instructorWrap.style.display = show ? "flex" : "none";
    if (!show) f.instructor.value = "";
  }

  function applyPickedAircraft() {
    const picked = normalizeReg(f.aircraftPick.value);
    const a = getDbAircraftByReg(picked);
    if (!a) return;
    // Auto-fill, but keep editable if visiting=yes
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
      updateInstructorVisibility();
      updateFuelingVisibility();
      setManualEnabled(false);
      setTimeout(() => f.callsign.focus(), 0);
      return;
    }

    modalTitle.textContent = "Edit aircraft";
    deleteBtn.hidden = false;

    f.id.value = strip.id;
    f.callsign.value = strip.callsign || "";

    // Try to match to DB
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
    updateInstructorVisibility();
    updateFuelingVisibility();
    setManualEnabled(f.visiting.value === "yes");
    setTimeout(() => f.callsign.focus(), 0);
  }

  function closeModal() {
    modalBackdrop.classList.add("hidden");
    modalBackdrop.setAttribute("aria-hidden", "true");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function statusShort(status, fueling){
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


  function setPatternAlert(){
    const patternCount = state.strips.filter(s => s.status === "pattern").length;
    const patternCol = document.querySelector('[data-column="pattern"]');
    if (!patternCol) return;
    if (patternCount > 2) patternCol.classList.add("alert");
    else patternCol.classList.remove("alert");
  }

    function computeSummary() {
    const gnd = state.strips.filter(s => s.status === "groundActive").length;
    const dep = state.strips.filter(s => s.status === "departure").length;
    const arr = state.strips.filter(s => s.status === "arrival").length;
    const pat = state.strips.filter(s => s.status === "pattern").length;
    const trn = state.strips.filter(s => s.status === "training").length;
    const xc  = state.strips.filter(s => s.status === "crossCountry").length;
    const encn = state.strips.filter(s => s.status === "encn").length;
    const solo = state.strips.filter(s => s.training === "solo").length;
    const instructor = state.strips.filter(s => s.training === "instructor").length;
    const total = state.strips.length;
    summary.textContent = `GND ACTIVE: ${gnd} • DEP: ${dep} • ARR: ${arr} • PATTERN: ${pat} • TRAIN: ${trn} • X-C: ${xc} • ENCN: ${encn} • SOLO: ${solo} • INSTRUCTOR: ${instructor} • TOTAL: ${total}`;
  }


  function getSelectedStrip(){
    return state.strips.find(s => s.id === selectedStripId) || null;
  }

  function setSelectedStrip(id){
    selectedStripId = id ? String(id) : null;
    updateSelectedControls();
    document.querySelectorAll(".strip").forEach(el => {
      el.classList.toggle("selected", !!selectedStripId && el.dataset.id === selectedStripId);
    });
    updateSmartLayout();
  }

  function updateSelectedControls(){
    const s = getSelectedStrip();
    const hasSelection = !!s;
    if (selectedEditBtn) selectedEditBtn.disabled = !hasSelection;
    if (selectedDeleteBtn) selectedDeleteBtn.disabled = !hasSelection;
    if (selectedClearBtn) selectedClearBtn.disabled = !hasSelection;
    if (selectionReadout){
      selectionReadout.classList.toggle("active", hasSelection);
      selectionReadout.textContent = hasSelection ? `${s.callsign || "—"}  •  ${s.registration || "—"}` : "NO STRIP SELECTED";
    }
  }

  function editSelectedStrip(){
    const s = getSelectedStrip();
    if (s) openModal("edit", s);
  }

  function deleteSelectedStrip(){
    const s = getSelectedStrip();
    if (!s) return;
    if (confirm(`Delete ${s.callsign}?`)){
      state.strips = state.strips.filter(x => x.id !== s.id);
      selectedStripId = null;
      saveStrips();
      render();
    }
  }

  function clearSelectedStrip(){
    setSelectedStrip(null);
  }

  function updateSmartLayout(){
    // v0.8 uses a fixed, predictable ops layout. No auto-collapse or dynamic column resizing.
    const selected = getSelectedStrip();
    const selectedColumn = selected ? normalizeStatus(selected.status) : null;
    document.querySelectorAll(".column").forEach(colEl => {
      const col = colEl.dataset.column;
      colEl.classList.toggle("primary", selectedColumn === col);
      colEl.classList.remove("collapsed");
    });
  }

  function render() {
    document.querySelectorAll(".strip-container").forEach(c => c.innerHTML = "");

    for (const strip of state.strips) {
      // Timer self-heal: if a strip is already AIRBORNE (e.g. after import/old data) but missing start time,
      // start timing from now so the AIR timer is always visible and running.
      if ((strip.status !== "groundActive") && (strip.airborneStartMs == null || !isFinite(strip.airborneStartMs)) && strip.lastAirTimeMs == null) {
        strip.airborneStartMs = Date.now();
      }

      const el = document.createElement("div");
      el.className = "strip" + (strip.training === "solo" ? " solo" : "") + (strip.id === selectedStripId ? " selected" : "");
      el.dataset.id = strip.id;
      el.dataset.status = strip.status;
      el.dataset.fueling = strip.fueling ? "yes" : "no";

      const typeWake = `${escapeHtml(strip.aircraft || "—")}`;
      const callsign = escapeHtml(strip.callsign || "—");
      const reg = escapeHtml(strip.registration || "—");

      const badges = [];
      // Air time display
      let airMs = null;
      if ((strip.status !== "groundActive") && typeof strip.airborneStartMs === "number" && strip.airborneStartMs != null){
        airMs = Date.now() - strip.airborneStartMs;
      } else if (typeof strip.lastAirTimeMs === "number" && strip.lastAirTimeMs != null){
        airMs = strip.lastAirTimeMs;
      }
      const airtimeHtml = (airMs != null)
        ? `<div class=\"airtime\"><span>AIR</span><b>${formatHHMM(airMs)}</b></div>`
        : "";

      if (strip.training === "solo") badges.push('<span class="badge solo">SOLO</span>');
      if (strip.training === "instructor") badges.push(`<span class="badge cfi">CFI: ${escapeHtml(strip.instructor || "")}</span>`);
      if (strip.fueling) badges.push('<span class="badge fuel">FUEL</span>');

      const status = escapeHtml(statusShort(strip.status, strip.fueling));
      const instr = strip.training === "instructor" ? `CFI ${escapeHtml(strip.instructor || "---")}` : (strip.training === "solo" ? "SOLO" : "");
      const remarks = escapeHtml(strip.notes || instr || "");
      el.innerHTML = `
        <div class="statusBand"></div>
        <div class="strip-grid">
          <div class="fcell callsign">
            <div class="lab">CALLSIGN</div>
            <div class="val">${callsign}</div>
            <div class="badges">${badges.join("")}</div>
          </div>
          <div class="fcell">
            <div class="lab">TYPE</div>
            <div class="val">${typeWake}</div>
            <div class="sub">${instr}</div>
          </div>
          <div class="fcell">
            <div class="lab">REG</div>
            <div class="val">${reg}</div>
            <div class="sub">${airtimeHtml}</div>
          </div>
          <div class="fcell">
            <div class="lab">INFO</div>
            <div class="val">${strip.fueling ? "FUEL" : (strip.training === "solo" ? "SOLO" : "")}</div>
            <div class="sub">${escapeHtml(strip.wake || "")}</div>
          </div>
          <div class="fcell statusCell">
            <div class="lab">STATUS</div>
            <div class="val">${status}</div>
          </div>
          <div class="notesLine">${remarks}</div>
        </div>
      `;

      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setSelectedStrip(strip.id);
      });

      el.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        const s = state.strips.find(x => x.id === strip.id);
        if (s) openModal("edit", s);
      });

      const column = normalizeStatus(strip.status);
      const container = document.querySelector(`[data-column="${column}"] .strip-container`);
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

      const ids = Array.from(container.querySelectorAll(".strip")).map(el => el.dataset.id);
      for (const id of ids) {
        const s = state.strips.find(x => x.id === id);
        if (s) newOrder.push(s);
      }
    }
    for (const s of state.strips) {
      if (!newOrder.some(x => x.id === s.id)) newOrder.push(s);
    }
    state.strips = newOrder;
    saveStrips();
  }

  function initSortable() {
    document.querySelectorAll(".strip-container").forEach(container => {
      new Sortable(container, {
        group: "shared",
        animation: 150,
        forceFallback: true,
        fallbackOnBody: true,
        swapThreshold: 0.65,
        ghostClass: "sortable-ghost",
        chosenClass: "sortable-chosen",
        dragClass: "sortable-drag",
        onEnd: function (evt) {
          const id = evt.item?.dataset?.id;
          if (!id) return;

          const newColumn = evt.to.closest(".column")?.dataset?.column;
          if (!newColumn) return;

          const strip = state.strips.find(s => s.id === id);
          if (!strip) return;

          // Move between columns changes status
          const prevStatus = strip.status;
          strip.status = newColumn;
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
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).format(now);

    clockUtc.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).format(now);
  }

  // Events
  newStripBtn.addEventListener("click", () => openModal("new"));
  if (selectedEditBtn) selectedEditBtn.addEventListener("click", editSelectedStrip);
  if (selectedDeleteBtn) selectedDeleteBtn.addEventListener("click", deleteSelectedStrip);
  if (selectedClearBtn) selectedClearBtn.addEventListener("click", clearSelectedStrip);

  // Menu toggle
  function openChangelog(){
    if (!changelogBackdrop) return;
    changelogBackdrop.classList.remove("hidden");
    changelogBackdrop.setAttribute("aria-hidden", "false");
  }
  function closeChangelog(){
    if (!changelogBackdrop) return;
    changelogBackdrop.classList.add("hidden");
    changelogBackdrop.setAttribute("aria-hidden", "true");
  }

  function closeMenu(){
    if (!menuPanel) return;
    menuPanel.classList.add("hidden");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
  }
  function toggleMenu(){
    if (!menuPanel) return;
    const isHidden = menuPanel.classList.contains("hidden");
    if (isHidden){
      menuPanel.classList.remove("hidden");
      if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
    } else {
      closeMenu();
    }
  }

  if (menuBtn){
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu();
    });
  }
  if (menuPanel){
    menuPanel.addEventListener("click", (e)=> e.stopPropagation());
  }
  document.addEventListener("click", () => closeMenu());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeMenu(); closeChangelog(); }
  });

  closeModalBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeChangelog(); }
    if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      openModal("new");
    }
  });

  // Picker behavior
  f.aircraftPick.addEventListener("change", applyPickedAircraft);
  f.aircraftPick.addEventListener("blur", applyPickedAircraft);
  f.visiting.addEventListener("change", () => {
    const manual = (f.visiting.value === "yes");
    setManualEnabled(manual);
    if (!manual) {
      // if switching back to based, re-apply pick
      applyPickedAircraft();
    }
  });

  f.training.addEventListener("change", updateInstructorVisibility);
  f.status.addEventListener("change", () => { updateFuelingVisibility(); updateStatusButtons(); });
  document.querySelectorAll("[data-status-btn]").forEach(btn => {
    btn.addEventListener("click", () => setFormStatus(btn.dataset.statusBtn));
  });

  clearAllBtn.addEventListener("click", () => {
    closeMenu();
    if (!confirm("Clear ALL strips from the board?")) return;
    state.strips = [];
    selectedStripId = null;
    saveStrips();
    render();
  });

  if (changelogBtn){
    changelogBtn.addEventListener("click", () => {
      closeMenu();
      openChangelog();
    });
  }
  if (closeChangelogBtn){
    closeChangelogBtn.addEventListener("click", closeChangelog);
  }
  if (changelogBackdrop){
    changelogBackdrop.addEventListener("click", (e)=>{ if (e.target === changelogBackdrop) closeChangelog(); });
  }

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
      state.strips = data.strips;
      // normalize
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.strips));
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

  stripForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const id = f.id.value ? String(f.id.value) : String(Date.now());
    const existing = state.strips.find(s => s.id === id);

    const next = {
      id,
      callsign: String(f.callsign.value || "").trim(),
      aircraft: String(f.aircraft.value || "").trim().toUpperCase(),
      registration: normalizeReg(f.registration.value),
      status: normalizeStatus(f.status.value),
      fueling: f.fueling.value === "yes",
      training: String(f.training.value || "none"),
      instructor: normalizeInstructorCode(f.instructor.value),
      notes: String(f.notes.value || "").trim(),
      createdAt: existing ? existing.createdAt : Date.now()
    };

    if (!next.callsign) { alert("Callsign is required."); return; }

    if (next.status !== "groundActive") next.fueling = false;
    if (next.training !== "instructor") next.instructor = "";

    // If visiting=no and a DB match exists, enforce DB type/reg/wake (prevents typos)
    if (f.visiting.value === "no") {
      const match = getDbAircraftByReg(next.registration || f.aircraftPick.value);
      if (match) {
        next.registration = match.registration;
        if (match.type) next.aircraft = match.type;
      }
    }

    if (existing) {
      const prevStatus = existing.status;
      Object.assign(existing, next);
      applyAirTimerTransition(existing, prevStatus, existing.status);
    } else {
      if (next.status !== "groundActive") {
        next.airborneStartMs = Date.now();
        next.lastAirTimeMs = null;
      } else {
        next.airborneStartMs = null;
        next.lastAirTimeMs = null;
      }
      state.strips.push(next);
    }

    saveStrips();
    render();
    closeModal();
  });

  deleteBtn.addEventListener("click", () => {
    const id = String(f.id.value || "");
    if (!id) return;
    const s = state.strips.find(x => x.id === id);
    if (!s) return;

    if (confirm(`Delete ${s.callsign}?`)) {
      state.strips = state.strips.filter(x => x.id !== id);
      saveStrips();
      render();
      closeModal();
    }
  });

  // iPad/Safari persistence guards. These fire when the user switches apps,
  // locks the iPad, opens another tab, or Safari decides to freeze the page.
  window.addEventListener("pagehide", flushStateToStorage);
  window.addEventListener("beforeunload", flushStateToStorage);
  window.addEventListener("blur", flushStateToStorage);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushStateToStorage();
  });
  document.addEventListener("freeze", flushStateToStorage);

  // Extra safety net: save periodically even if no button/drag event happens.
  setInterval(flushStateToStorage, 5000);

  // Init
  loadStrips();
  initSortable();
  render();
  updateClocks();
  setInterval(updateClocks, 1000);
  // Refresh display so AIR timer updates (HH:MM) while airborne
  setInterval(() => { render(); }, 30000);
  loadAircraftDB();
})();
