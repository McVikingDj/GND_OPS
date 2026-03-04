// v2.3 - aircraft database + picker, keeps manual type/REG for visitors + drag/drop

(function () {
  const STORAGE_KEY = "gullknapp_strips_v23";
  const DB_URL = "./aircraft_db.json";

  const COLUMNS = ["airborne", "pattern", "ground"];
  let state = { strips: [], db: [] };

  // DOM
  const modalBackdrop = document.getElementById("modalBackdrop");
  const stripForm = document.getElementById("stripForm");
  const modalTitle = document.getElementById("modalTitle");

  const newStripBtn = document.getElementById("newStripBtn");
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
    const prevInAir = (prevStatus === "airborne" || prevStatus === "pattern");
    const nextInAir = (nextStatus === "airborne" || nextStatus === "pattern");

    // Start timer when entering AIRBORNE or PATTERN from ground/fueling
    if (!prevInAir && nextInAir){
      strip.airborneStartMs = now;
      strip.lastAirTimeMs = null;
      return;
    }

    // Keep running while in AIRBORNE or PATTERN (no action when switching between them)
    if (prevInAir && nextInAir){
      return;
    }

    // Stop when arriving GROUND/FUELING from AIRBORNE or PATTERN
    if (prevInAir && !nextInAir){
      if (strip.airborneStartMs){
        strip.lastAirTimeMs = now - strip.airborneStartMs;
      }
      strip.airborneStartMs = null;
    }
  }

  function loadStrips() {
    state.strips = safeJsonParse(localStorage.getItem(STORAGE_KEY), []) || [];
    state.strips = state.strips
      .filter(s => s && s.id && s.callsign)
      .map(s => ({
        id: String(s.id),
        callsign: String(s.callsign || "").trim(),
        aircraft: String(s.aircraft || "").trim().toUpperCase(),
        registration: String(s.registration || "").trim().toUpperCase(),
            status: ["airborne","pattern","ground","fueling"].includes(s.status) ? s.status : "ground",
        training: ["none","solo","instructor"].includes(s.training) ? s.training : "none",
        instructor: normalizeInstructorCode(s.instructor),
        notes: String(s.notes || "").trim(),
        airborneStartMs: (typeof s.airborneStartMs === "number" ? s.airborneStartMs : null),
        lastAirTimeMs: (typeof s.lastAirTimeMs === "number" ? s.lastAirTimeMs : null),
        createdAt: s.createdAt || Date.now()
      }));
  }

  function saveStrips() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.strips));
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
    f.wake.disabled = !enabled;
    f.aircraftPick.disabled = enabled; // if manual, disable picker
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
      f.wake.value = "";
      f.status.value = "ground";
      f.training.value = "none";
      f.instructor.value = "";
      f.notes.value = "";
      updateInstructorVisibility();
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
    f.wake.value = strip.wake || "";
    f.status.value = strip.status || "ground";
    f.training.value = strip.training || "none";
    f.instructor.value = strip.instructor || "";
    f.notes.value = strip.notes || "";
    updateInstructorVisibility();
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


  function setPatternAlert(){
    const patternCount = state.strips.filter(s => s.status === "pattern").length;
    const patternCol = document.querySelector('[data-column="pattern"]');
    if (!patternCol) return;
    if (patternCount > 2) patternCol.classList.add("alert");
    else patternCol.classList.remove("alert");
  }

  function computeSummary() {
    const airborne = state.strips.filter(s => s.status === "airborne").length;
    const pattern = state.strips.filter(s => s.status === "pattern").length;
    const ground = state.strips.filter(s => s.status === "ground").length;
    const fueling = state.strips.filter(s => s.status === "fueling").length;
    const solo = state.strips.filter(s => s.training === "solo").length;
    const instructor = state.strips.filter(s => s.training === "instructor").length;
    const total = state.strips.length;

    summary.textContent =
      `AIRBORNE: ${airborne} • PATTERN: ${pattern} • GROUND: ${ground} • FUELING: ${fueling} • SOLO: ${solo} • INSTRUCTOR: ${instructor} • TOTAL: ${total}`;
  }

  function render() {
    document.querySelectorAll(".strip-container").forEach(c => c.innerHTML = "");

    for (const strip of state.strips) {
      // Timer self-heal: if a strip is already AIRBORNE (e.g. after import/old data) but missing start time,
      // start timing from now so the AIR timer is always visible and running.
      if ((strip.status === "airborne" || strip.status === "pattern") && (strip.airborneStartMs == null || !isFinite(strip.airborneStartMs)) && strip.lastAirTimeMs == null) {
        strip.airborneStartMs = Date.now();
      }

      const el = document.createElement("div");
      el.className = "strip" + (strip.training === "solo" ? " solo" : "");
      el.dataset.id = strip.id;
      el.dataset.status = strip.status;

      const typeWake = `${escapeHtml(strip.aircraft || "—")}`;
      const callsign = escapeHtml(strip.callsign || "—");
      const reg = escapeHtml(strip.registration || "—");

      const badges = [];
      // Air time display
      let airMs = null;
      if ((strip.status === "airborne" || strip.status === "pattern") && typeof strip.airborneStartMs === "number" && strip.airborneStartMs != null){
        airMs = Date.now() - strip.airborneStartMs;
      } else if (typeof strip.lastAirTimeMs === "number" && strip.lastAirTimeMs != null){
        airMs = strip.lastAirTimeMs;
      }
      const airtimeHtml = (airMs != null)
        ? `<div class=\"airtime\"><span>AIR</span><b>${formatHHMM(airMs)}</b></div>`
        : "";

      if (strip.training === "solo") badges.push('<span class="badge solo">SOLO</span>');
      if (strip.training === "instructor") badges.push(`<span class="badge cfi">CFI: ${escapeHtml(strip.instructor || "")}</span>`);
      if (strip.status === "fueling") badges.push('<span class="badge fuel">FUEL</span>');

      el.innerHTML = `
        <div class="statusBand"></div>
        <div class="top">
          <div class="cell">
            <div class="miniLabel">TYPE</div>
            <div class="rightBig">${typeWake}</div>
          </div>

          <div class="cell">
            <div class="miniLabel">CALLSIGN</div>
            <div class="big">${callsign}</div>
            <div class="badges">${badges.join("")}</div>${airtimeHtml}
          </div>

          <div class="cell">
            <div class="miniLabel">REG</div>
            <div class="rightBig">${reg}</div>
          </div>
        </div>

        <div class="bottom">
          <div class="notes">${escapeHtml(strip.notes || "")}</div>
          <div class="actions">
            <button class="miniBtn editbtn" title="Edit">Edit</button>
            <button class="miniBtn delbtn" title="Delete">Del</button>
          </div>
        </div>
      `;

      el.querySelector(".editbtn").addEventListener("click", (ev) => {
        ev.stopPropagation();
        const s = state.strips.find(x => x.id === strip.id);
        if (s) openModal("edit", s);
      });

      el.querySelector(".delbtn").addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (confirm(`Delete ${strip.callsign}?`)) {
          state.strips = state.strips.filter(x => x.id !== strip.id);
          saveStrips();
          render();
        }
      });

      el.addEventListener("click", () => {
        const s = state.strips.find(x => x.id === strip.id);
        if (s) openModal("edit", s);
      });

      const column = strip.status === "fueling" ? "ground" : strip.status;
      const container = document.querySelector(`[data-column="${column}"] .strip-container`);
      if (container) container.appendChild(el);
    }

    setPatternAlert();
    computeSummary();
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

          // Move between columns changes status (fueling stays ground unless set via modal)
          const prevStatus = strip.status;
          if (newColumn !== "ground" && strip.status === "fueling") strip.status = newColumn;
          else if (newColumn === "ground" && strip.status !== "fueling") strip.status = "ground";
          else if (newColumn !== "ground") strip.status = newColumn;
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

  clearAllBtn.addEventListener("click", () => {
    closeMenu();
    if (!confirm("Clear ALL strips (airborne, pattern, ground)?")) return;
    state.strips = [];
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
        status: String(f.status.value || "ground"),
      training: String(f.training.value || "none"),
      instructor: normalizeInstructorCode(f.instructor.value),
      notes: String(f.notes.value || "").trim(),
      createdAt: existing ? existing.createdAt : Date.now()
    };

    if (!next.callsign) { alert("Callsign is required."); return; }

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
      if (next.status === "airborne") {
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
