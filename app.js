(() => {
  const STORAGE_KEY = "osmaa_ground_ops_v1";
  const META_KEY = "osmaa_ground_ops_meta_v1";

  const POSITIONS = ["ground", "movement", "pattern", "local", "inbound", "outbound", "away"];
  const AIRBORNE = new Set(["pattern", "local", "inbound", "outbound", "away"]);
  const POSITION_LABELS = {
    ground: "Ground",
    movement: "Movement",
    pattern: "Pattern",
    local: "Local Area",
    inbound: "Inbound",
    outbound: "Outbound",
    away: "Away"
  };
  const POSITION_SHORT = {
    ground: "GND",
    movement: "TAXI",
    pattern: "TGL",
    local: "LOCAL",
    inbound: "IN",
    outbound: "OUT",
    away: "AWAY"
  };
  const WATCH_MS = 8 * 60 * 1000;
  const URGENT_MS = 16 * 60 * 1000;

  let aircraft = [];
  let selectedId = null;

  const els = {
    summaryLine: document.getElementById("summaryLine"),
    metricAway: document.getElementById("metricAway"),
    attentionCount: document.getElementById("attentionCount"),
    activeCount: document.getElementById("activeCount"),
    attentionList: document.getElementById("attentionList"),
    activeList: document.getElementById("activeList"),
    clockLocal: document.getElementById("clockLocal"),
    clockUtc: document.getElementById("clockUtc"),
    selectedCard: document.getElementById("selectedCard"),
    clearSelectionBtn: document.getElementById("clearSelectionBtn"),
    addAircraftBtn: document.getElementById("addAircraftBtn"),
    editAircraftBtn: document.getElementById("editAircraftBtn"),
    closeAircraftBtn: document.getElementById("closeAircraftBtn"),
    demoBtn: document.getElementById("demoBtn"),
    exportBtn: document.getElementById("exportBtn"),
    importFile: document.getElementById("importFile"),
    clearAllBtn: document.getElementById("clearAllBtn"),
    toggleAwayBtn: document.getElementById("toggleAwayBtn"),
    listAway: document.getElementById("listAway"),
    modal: document.getElementById("aircraftModal"),
    modalTitle: document.getElementById("modalTitle"),
    closeModalBtn: document.getElementById("closeModalBtn"),
    cancelModalBtn: document.getElementById("cancelModalBtn"),
    deleteFromModalBtn: document.getElementById("deleteFromModalBtn"),
    form: document.getElementById("aircraftForm"),
    aircraftId: document.getElementById("aircraftId"),
    callsign: document.getElementById("callsign"),
    registration: document.getElementById("registration"),
    aircraftType: document.getElementById("aircraftType"),
    position: document.getElementById("position"),
    intention: document.getElementById("intention"),
    operatorType: document.getElementById("operatorType"),
    flagSolo: document.getElementById("flagSolo"),
    flagInstructor: document.getElementById("flagInstructor"),
    flagFuel: document.getElementById("flagFuel"),
    note: document.getElementById("note")
  };

  function nowId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function safeJsonParse(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function normalizeText(value) {
    return String(value || "").trim().toUpperCase();
  }

  function normalizePosition(value) {
    return POSITIONS.includes(value) ? value : "ground";
  }

  function isAirborne(position) {
    return AIRBORNE.has(normalizePosition(position));
  }

  function selectedAircraft() {
    return aircraft.find(item => item.id === selectedId) || null;
  }

  function formatDuration(ms) {
    if (ms == null || !isFinite(ms) || ms < 0) return "00:00";
    const minutes = Math.floor(ms / 60000);
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function getAirMs(item) {
    if (isAirborne(item.position) && typeof item.airborneStartMs === "number") {
      return Date.now() - item.airborneStartMs;
    }
    if (typeof item.lastAirMs === "number") return item.lastAirMs;
    return null;
  }

  function minutesSinceUpdate(item) {
    return Math.max(0, Math.floor((Date.now() - (item.updatedAt || item.createdAt || Date.now())) / 60000));
  }

  function classifyAttention(item) {
    if (item.position === "away") return { level: "away", reason: "" };
    const staleMs = Date.now() - (item.updatedAt || item.createdAt || Date.now());
    const staleMin = minutesSinceUpdate(item);

    if (staleMs >= URGENT_MS) return { level: "urgent", reason: `${staleMin} min` };
    if (item.position === "outbound" && staleMs >= WATCH_MS) return { level: "watch", reason: "Move away?" };
    if (staleMs >= WATCH_MS) return { level: "watch", reason: `${staleMin} min` };
    if (item.position === "inbound") return { level: "watch", reason: "Inbound" };
    if (item.flags.solo) return { level: "watch", reason: "Solo" };
    if (item.flags.fuel) return { level: "watch", reason: "Fuel" };
    return { level: "normal", reason: "" };
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(aircraft));
    localStorage.setItem(META_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      selectedId
    }));
  }

  function load() {
    aircraft = safeJsonParse(localStorage.getItem(STORAGE_KEY), []) || [];
    aircraft = aircraft
      .filter(item => item && item.id && item.callsign)
      .map(item => ({
        id: String(item.id),
        callsign: normalizeText(item.callsign),
        registration: normalizeText(item.registration),
        type: normalizeText(item.type),
        position: normalizePosition(item.position),
        intention: String(item.intention || "Unknown"),
        operatorType: item.operatorType === "Visitor" ? "Visitor" : "OSM",
        flags: {
          solo: Boolean(item.flags?.solo),
          instructor: Boolean(item.flags?.instructor),
          fuel: Boolean(item.flags?.fuel)
        },
        note: String(item.note || "").trim(),
        airborneStartMs: typeof item.airborneStartMs === "number" ? item.airborneStartMs : null,
        lastAirMs: typeof item.lastAirMs === "number" ? item.lastAirMs : null,
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || Date.now()
      }));
  }

  function updateAirTimer(item, previousPosition, nextPosition) {
    const wasAirborne = isAirborne(previousPosition);
    const nowAirborne = isAirborne(nextPosition);
    const now = Date.now();

    if (!wasAirborne && nowAirborne) {
      item.airborneStartMs = now;
      item.lastAirMs = null;
    } else if (wasAirborne && !nowAirborne) {
      if (item.airborneStartMs) item.lastAirMs = now - item.airborneStartMs;
      item.airborneStartMs = null;
    }
  }

  function counts() {
    const result = Object.fromEntries(POSITIONS.map(pos => [pos, 0]));
    for (const item of aircraft) result[item.position] += 1;
    return result;
  }

  function localCount(count) {
    return count.ground + count.movement + count.pattern + count.local + count.inbound + count.outbound;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildTags(item) {
    const tags = [];
    const airMs = getAirMs(item);
    const attention = classifyAttention(item);
    if (item.flags.fuel) tags.push('<span class="tag fuel">Fuel</span>');
    if (item.flags.solo) tags.push('<span class="tag solo">Solo</span>');
    if (item.flags.instructor) tags.push('<span class="tag cfi">CFI</span>');
    if (airMs != null && isAirborne(item.position)) tags.push(`<span class="tag air">Air ${formatDuration(airMs)}</span>`);
    if (attention.level === "watch" && !["Fuel", "Solo"].includes(attention.reason)) {
      tags.push(`<span class="tag watch">${escapeHtml(attention.reason)}</span>`);
    }
    if (attention.level === "urgent") tags.push(`<span class="tag urgent">${escapeHtml(attention.reason)}</span>`);
    return tags.join("");
  }

  function priority(item) {
    const attention = classifyAttention(item);
    const order = {
      inbound: 0,
      pattern: 1,
      movement: 2,
      outbound: 3,
      local: 4,
      ground: 5,
      away: 9
    };
    let score = order[item.position] ?? 8;
    if (attention.level === "urgent") score -= 20;
    if (attention.level === "watch") score -= 10;
    if (item.flags.fuel) score -= 0.25;
    if (item.flags.solo) score -= 0.15;
    return score;
  }

  function sortedAircraft(items) {
    return [...items].sort((a, b) => {
      const byPriority = priority(a) - priority(b);
      if (byPriority !== 0) return byPriority;
      return (a.updatedAt || 0) - (b.updatedAt || 0);
    });
  }

  function makeAircraftTile(item) {
    const attention = classifyAttention(item);
    const row = document.createElement("article");
    row.className = [
      "aircraftRow",
      item.operatorType === "Visitor" ? "visitor" : "",
      item.flags.solo ? "solo" : "",
      item.flags.fuel ? "fuel" : "",
      attention.level === "watch" ? "watch" : "",
      attention.level === "urgent" ? "urgent" : "",
      item.id === selectedId ? "selected" : ""
    ].filter(Boolean).join(" ");
    row.dataset.id = item.id;
    row.dataset.position = item.position;
    row.innerHTML = `
      <div class="stripe"></div>
      <div class="rowCell">
        <div class="rowLabel">Callsign</div>
        <div class="callsign">${escapeHtml(item.callsign)}</div>
        <div class="secondaryText">${escapeHtml([item.type, item.registration].filter(Boolean).join(" · ") || "-")}</div>
      </div>
      <div class="rowCell intentCell">
        <div class="rowLabel">Intention</div>
        <div class="primaryText">${escapeHtml(item.intention || "Unknown")}</div>
        <div class="tags">${buildTags(item)}</div>
      </div>
      <div class="rowCell">
        <div class="rowLabel">Position</div>
        <div class="primaryText">${escapeHtml(POSITION_LABELS[item.position])}</div>
        <div class="secondaryText">Updated ${minutesSinceUpdate(item)} min ago</div>
      </div>
      <div class="rowCell noteCell">
        <div class="rowLabel">OPS note</div>
        <div class="primaryText">${escapeHtml(item.note || "-")}</div>
      </div>
      <div class="rowCell stateCell">
        <div class="rowLabel">State</div>
        <div class="stateText">${POSITION_SHORT[item.position]}</div>
      </div>
    `;
    row.addEventListener("click", () => {
      selectedId = item.id;
      render();
    });
    row.addEventListener("dblclick", () => openModal("edit", item));
    return row;
  }

  function renderLists() {
    els.attentionList.innerHTML = "";
    els.activeList.innerHTML = "";
    els.listAway.innerHTML = "";

    const localAircraft = aircraft.filter(entry => entry.position !== "away");
    const attentionAircraft = localAircraft.filter(item => classifyAttention(item).level !== "normal");
    const activeAircraft = localAircraft.filter(item => classifyAttention(item).level === "normal");

    for (const item of sortedAircraft(attentionAircraft)) {
      els.attentionList.appendChild(makeAircraftTile(item));
    }
    for (const item of sortedAircraft(activeAircraft)) {
      els.activeList.appendChild(makeAircraftTile(item));
    }
    for (const item of sortedAircraft(aircraft.filter(entry => entry.position === "away"))) {
      els.listAway.appendChild(makeAircraftTile(item));
    }
  }

  function renderSummary() {
    const count = counts();
    const active = localCount(count);
    const airborne = count.pattern + count.local + count.inbound + count.outbound;
    const attention = aircraft.filter(item => item.position !== "away" && classifyAttention(item).level !== "normal").length;
    const normal = aircraft.filter(item => item.position !== "away" && classifyAttention(item).level === "normal").length;

    els.metricAway.textContent = String(count.away);
    els.attentionCount.textContent = String(attention);
    els.activeCount.textContent = String(normal);
    els.summaryLine.textContent = `Attention ${attention} · Active ${normal} · Airborne ${airborne} · Away ${count.away}`;
  }

  function renderSelected() {
    const item = selectedAircraft();
    const buttons = [
      ...document.querySelectorAll("[data-action-position]"),
      ...document.querySelectorAll("[data-action-intention]"),
      els.editAircraftBtn,
      els.closeAircraftBtn,
      els.clearSelectionBtn
    ];
    buttons.forEach(button => { button.disabled = !item; });

    if (!item) {
      els.selectedCard.className = "selectedBlock empty";
      els.selectedCard.innerHTML = "<strong>No aircraft selected</strong><span>Tap a row to update it</span>";
      return;
    }

    const airMs = getAirMs(item);
    els.selectedCard.className = "selectedBlock active";
    els.selectedCard.innerHTML = `
      <strong>${escapeHtml(item.callsign)} · ${escapeHtml(POSITION_SHORT[item.position])}</strong>
      <span>${escapeHtml(item.type || "-")} ${escapeHtml(item.registration || "")} · ${escapeHtml(item.intention)} · Updated ${minutesSinceUpdate(item)} min${airMs == null ? "" : ` · AIR ${formatDuration(airMs)}`}</span>
    `;
  }

  function render() {
    renderLists();
    renderSummary();
    renderSelected();
    save();
  }

  function openModal(mode, item) {
    els.modal.classList.remove("hidden");
    els.modal.setAttribute("aria-hidden", "false");
    els.modalTitle.textContent = mode === "edit" ? "Edit aircraft" : "Add aircraft";
    els.deleteFromModalBtn.hidden = mode !== "edit";

    if (mode === "edit" && item) {
      els.aircraftId.value = item.id;
      els.callsign.value = item.callsign;
      els.registration.value = item.registration || "";
      els.aircraftType.value = item.type || "";
      els.position.value = item.position;
      els.intention.value = item.intention;
      els.operatorType.value = item.operatorType;
      els.flagSolo.checked = item.flags.solo;
      els.flagInstructor.checked = item.flags.instructor;
      els.flagFuel.checked = item.flags.fuel;
      els.note.value = item.note || "";
    } else {
      els.aircraftId.value = "";
      els.callsign.value = "";
      els.registration.value = "";
      els.aircraftType.value = "";
      els.position.value = "ground";
      els.intention.value = "Departure";
      els.operatorType.value = "OSM";
      els.flagSolo.checked = false;
      els.flagInstructor.checked = false;
      els.flagFuel.checked = false;
      els.note.value = "";
    }

    setTimeout(() => els.callsign.focus(), 0);
  }

  function closeModal() {
    els.modal.classList.add("hidden");
    els.modal.setAttribute("aria-hidden", "true");
  }

  function formAircraft() {
    return {
      id: els.aircraftId.value || nowId(),
      callsign: normalizeText(els.callsign.value),
      registration: normalizeText(els.registration.value),
      type: normalizeText(els.aircraftType.value),
      position: normalizePosition(els.position.value),
      intention: els.intention.value,
      operatorType: els.operatorType.value === "Visitor" ? "Visitor" : "OSM",
      flags: {
        solo: els.flagSolo.checked,
        instructor: els.flagInstructor.checked,
        fuel: els.flagFuel.checked
      },
      note: els.note.value.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      airborneStartMs: null,
      lastAirMs: null
    };
  }

  function saveForm(event) {
    event.preventDefault();
    const next = formAircraft();
    if (!next.callsign) {
      alert("Callsign is required.");
      return;
    }

    const existing = aircraft.find(item => item.id === next.id);
    if (existing) {
      next.createdAt = existing.createdAt;
      next.airborneStartMs = existing.airborneStartMs;
      next.lastAirMs = existing.lastAirMs;
      updateAirTimer(next, existing.position, next.position);
      Object.assign(existing, next);
      selectedId = existing.id;
    } else {
      if (isAirborne(next.position)) next.airborneStartMs = Date.now();
      aircraft.push(next);
      selectedId = next.id;
    }

    closeModal();
    render();
  }

  function updateSelectedPosition(position) {
    const item = selectedAircraft();
    if (!item) return;
    const previous = item.position;
    item.position = normalizePosition(position);
    item.updatedAt = Date.now();
    updateAirTimer(item, previous, item.position);
    render();
  }

  function updateSelectedIntention(intention) {
    const item = selectedAircraft();
    if (!item) return;
    item.intention = intention;
    item.updatedAt = Date.now();
    render();
  }

  function closeSelectedAircraft() {
    const item = selectedAircraft();
    if (!item) return;
    if (!confirm(`Close ${item.callsign}?`)) return;
    aircraft = aircraft.filter(entry => entry.id !== item.id);
    selectedId = null;
    render();
  }

  function loadDemo() {
    const now = Date.now();
    aircraft = [
      demoAircraft("SCQ23A", "LN-AZA", "C172", "ground", "Fuel", "OSM", { fuel: true }, "Fuel before next sortie", null, now - 5 * 60000),
      demoAircraft("SCQ417", "SE-MIN", "DA42", "movement", "Departure", "OSM", {}, "Taxi RWY 05", null, now - 3 * 60000),
      demoAircraft("SCQ8K", "LN-AZC", "C172", "pattern", "TGL", "OSM", { solo: true }, "Solo circuit", now - 7 * 60000, now - 4 * 60000),
      demoAircraft("SCQ51B", "LN-AZD", "C172", "local", "Local training", "OSM", { instructor: true }, "Training area west", now - 18 * 60000, now - 18 * 60000),
      demoAircraft("LN-ABC", "LN-ABC", "PA28", "inbound", "Arrival", "Visitor", {}, "Inbound from reporting point", now - 41 * 60000, now - 6 * 60000),
      demoAircraft("SCQ92C", "SE-MEJ", "DA42", "outbound", "Departure", "OSM", {}, "Leaving local soon", now - 14 * 60000, now - 12 * 60000),
      demoAircraft("SCQ77", "LN-AZE", "C172", "away", "Local training", "OSM", {}, "Changed frequency", now - 31 * 60000, now - 21 * 60000)
    ];
    selectedId = aircraft[0].id;
    render();
  }

  function demoAircraft(callsign, registration, type, position, intention, operatorType, flags, note, airborneStartMs = null, updatedAt = Date.now()) {
    return {
      id: nowId(),
      callsign,
      registration,
      type,
      position,
      intention,
      operatorType,
      flags: {
        solo: Boolean(flags.solo),
        instructor: Boolean(flags.instructor),
        fuel: Boolean(flags.fuel)
      },
      note,
      airborneStartMs,
      lastAirMs: null,
      createdAt: Date.now(),
      updatedAt
    };
  }

  function exportBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      aircraft
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "osmaa-ground-ops-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importBackup() {
    const file = els.importFile.files?.[0];
    if (!file) return;
    try {
      const data = safeJsonParse(await file.text(), null);
      const incoming = Array.isArray(data) ? data : data?.aircraft;
      if (!Array.isArray(incoming)) throw new Error("Invalid backup file.");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(incoming));
      load();
      selectedId = null;
      render();
      alert("Import successful.");
    } catch (err) {
      alert(`Import failed: ${err.message || err}`);
    } finally {
      els.importFile.value = "";
    }
  }

  function clearBoard() {
    if (!confirm("Clear all aircraft from the board?")) return;
    aircraft = [];
    selectedId = null;
    render();
  }

  function updateClocks() {
    const now = new Date();
    els.clockLocal.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Oslo",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(now);
    els.clockUtc.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(now);
  }

  function uppercaseField(input) {
    input.addEventListener("input", () => {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = input.value.toUpperCase();
      try { input.setSelectionRange(start, end); } catch {}
    });
  }

  function bindEvents() {
    els.addAircraftBtn.addEventListener("click", () => openModal("new"));
    els.editAircraftBtn.addEventListener("click", () => {
      const item = selectedAircraft();
      if (item) openModal("edit", item);
    });
    els.closeAircraftBtn.addEventListener("click", closeSelectedAircraft);
    els.clearSelectionBtn.addEventListener("click", () => {
      selectedId = null;
      render();
    });
    els.demoBtn.addEventListener("click", loadDemo);
    els.exportBtn.addEventListener("click", exportBackup);
    els.importFile.addEventListener("change", importBackup);
    els.clearAllBtn.addEventListener("click", clearBoard);
    els.form.addEventListener("submit", saveForm);
    els.closeModalBtn.addEventListener("click", closeModal);
    els.cancelModalBtn.addEventListener("click", closeModal);
    els.modal.addEventListener("click", event => {
      if (event.target === els.modal) closeModal();
    });
    els.deleteFromModalBtn.addEventListener("click", closeSelectedAircraft);
    els.toggleAwayBtn.addEventListener("click", () => {
      const collapsed = els.listAway.classList.toggle("collapsed");
      els.toggleAwayBtn.setAttribute("aria-expanded", String(!collapsed));
    });

    document.querySelectorAll("[data-action-position]").forEach(button => {
      button.addEventListener("click", () => updateSelectedPosition(button.dataset.actionPosition));
    });
    document.querySelectorAll("[data-action-intention]").forEach(button => {
      button.addEventListener("click", () => updateSelectedIntention(button.dataset.actionIntention));
    });

    [els.callsign, els.registration, els.aircraftType].forEach(uppercaseField);

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeModal();
      if (event.key.toLowerCase() === "n" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        openModal("new");
      }
    });

    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", save);
    window.addEventListener("blur", save);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") save();
    });
  }

  bindEvents();
  load();
  render();
  updateClocks();
  setInterval(updateClocks, 1000);
  setInterval(render, 30000);
  setInterval(save, 5000);
})();
