import {
  filterFeaturesForMap,
  describeNybyggRegisterFilterCounts,
  setRegisterMatchedBrunnsIds,
  getRegisterMatchCount,
  hasRegisterMatches,
} from "./filter-config.js";
import {
  computeRegisterMatchedBrunnsIds,
  fetchCombifyPermits,
  loadDemoRegister,
  loadLanRestCacheRegister,
  loadOppnaCacheRegister,
  loadRegisterFromUrl,
} from "./nybygg-register.js";
import {
  COMBIFY_API_KEY_STORAGE,
  DEFAULT_REGISTER_MODE,
  NYBYGG_REGISTER_MODES,
  SPATIAL_BUFFER_METERS,
  TEMPORAL_BUFFER_MONTHS,
} from "./nybygg-register-config.js";

const DATE_FROM = "20251001";
const DATE_TO = "20260331";
const API_BASE =
  "https://api.sgu.se/oppnadata/brunnar/ogc/features/v1/collections/brunnar/items";
const FILTER = encodeURIComponent(
  `anvandning_kod='ENE' AND borrdatum >= '${DATE_FROM}' AND borrdatum <= '${DATE_TO}'`
);

const osmLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});

const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution:
      "Esri, Maxar, Earthstar Geographics, USDA FSA, USGS, AeroGRID, IGN, GIS Community",
  }
);

const map = L.map("map", {
  center: [62.5, 16.5],
  zoom: 5,
  layers: [osmLayer],
});

const clusterGroup = L.markerClusterGroup({
  chunkedLoading: true,
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
});

map.addLayer(clusterGroup);

L.control.scale({ imperial: false, metric: true }).addTo(map);

document.querySelectorAll('input[name="baselayer"]').forEach((input) => {
  input.addEventListener("change", () => {
    const useSatellite = input.value === "satellite" && input.checked;
    if (useSatellite) {
      map.removeLayer(osmLayer);
      map.addLayer(satelliteLayer);
    } else if (input.value === "osm" && input.checked) {
      map.removeLayer(satelliteLayer);
      map.addLayer(osmLayer);
    }
  });
});

const statCount = document.getElementById("stat-count");
const statusMsg = document.getElementById("status-msg");
const registerStatus = document.getElementById("register-status");
const btnReload = document.getElementById("btn-reload");
const filterNybyggRegister = document.getElementById("filter-nybygg-register");
const registerModeSelect = document.getElementById("register-mode");
const combifyKeyInput = document.getElementById("combify-api-key");
const combifyKeyRow = document.getElementById("combify-key-row");
const registerUrlInput = document.getElementById("register-custom-url");
const registerUrlRow = document.getElementById("register-url-row");
const btnSaveCombifyKey = document.getElementById("btn-save-combify-key");

/** @type {object[]} */
let allFeatures = [];
let hasFittedBounds = false;

/** @type {{ label: string, source: string } | null} */
let registerMeta = null;

function getFilterOptions() {
  return {
    onlyNybyggRegister: Boolean(filterNybyggRegister?.checked),
  };
}

function uniqueKommuner(features) {
  return [
    ...new Set(
      features
        .map((f) => f.properties?.kommunnamn)
        .filter(Boolean)
        .map((k) => String(k).trim())
    ),
  ];
}

function updateRegisterModeUi() {
  const mode = registerModeSelect?.value ?? DEFAULT_REGISTER_MODE;
  if (combifyKeyRow) {
    combifyKeyRow.hidden = mode !== NYBYGG_REGISTER_MODES.combify;
  }
  if (registerUrlRow) {
    registerUrlRow.hidden = mode !== NYBYGG_REGISTER_MODES.url;
  }
}

function updateStatCount(shown, total) {
  const opts = getFilterOptions();
  if (opts.onlyNybyggRegister) {
    statCount.textContent = describeNybyggRegisterFilterCounts(
      shown,
      total,
      getRegisterMatchCount()
    );
    return;
  }
  statCount.textContent = `${total.toLocaleString("sv-SE")} energibrunnar i perioden`;
}

function setRegisterStatus(text, variant = "info") {
  if (!registerStatus) return;
  registerStatus.textContent = text;
  registerStatus.dataset.variant = variant;
}

function formatBorrdatum(raw) {
  if (!raw) return "–";
  const s = String(raw);
  if (s.length === 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  if (s.length === 6) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
  }
  if (s.length === 4) return s;
  return raw;
}

function popupHtml(props) {
  const rows = [
    ["Brunns-ID", props.brunnsid ?? "–"],
    ["Kommun", props.kommunnamn ?? "–"],
    ["Fastighet", props.fastighet ?? "–"],
    ["Ort", props.ort ?? "–"],
    ["Borrdatum", formatBorrdatum(props.borrdatum)],
    ["Totaldjup (m)", props.totaldjup ?? "–"],
    ["Användning", props.anvandning ?? "–"],
    ["Lägeskvalitet", props.posvardering ?? "–"],
  ];
  for (const key of ["lage_specifikt", "allman_anmarkning"]) {
    const val = props[key];
    if (val) {
      const label = key === "lage_specifikt" ? "Läge (specifikt)" : "Allmän anmärkning";
      rows.push([label, val]);
    }
  }
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><th>${k}</th><td>${escapeHtml(String(v))}</td></tr>`
    )
    .join("");
  return `<p class="popup-title">Energibrunn</p><table class="popup-table"><tbody>${body}</tbody></table>`;
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchAllFeatures() {
  const features = [];
  let url = `${API_BASE}?filter=${FILTER}&limit=5000&f=application/geo%2Bjson`;
  let page = 0;

  while (url) {
    page += 1;
    statusMsg.textContent = `Hämtar sida ${page} från SGU …`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SGU API svarade ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    if (Array.isArray(data.features)) {
      features.push(...data.features);
    }
    const next = (data.links || []).find((l) => l.rel === "next");
    url = next?.href ?? null;
  }

  return features;
}

async function loadNybyggRegister(features) {
  const mode = registerModeSelect?.value ?? DEFAULT_REGISTER_MODE;

  if (mode === NYBYGG_REGISTER_MODES.oppnaCache) {
    return loadOppnaCacheRegister();
  }

  if (mode === NYBYGG_REGISTER_MODES.lanRestCache) {
    return loadLanRestCacheRegister();
  }

  if (mode === NYBYGG_REGISTER_MODES.demo) {
    return loadDemoRegister();
  }

  if (mode === NYBYGG_REGISTER_MODES.url) {
    const customUrl = registerUrlInput?.value?.trim();
    if (!customUrl) {
      throw new Error("Ange URL till eget nybygg-register (JSON).");
    }
    return loadRegisterFromUrl(customUrl);
  }

  if (mode === NYBYGG_REGISTER_MODES.combify) {
    const fromInput = combifyKeyInput?.value?.trim();
    const fromStorage = sessionStorage.getItem(COMBIFY_API_KEY_STORAGE) ?? "";
    const apiKey = fromInput || fromStorage;
    if (!apiKey) {
      throw new Error(
        "Saknar Combify API-nyckel – ange nyckel nedan eller använd demoläge."
      );
    }
    const kommuner = uniqueKommuner(features);
    return fetchCombifyPermits(apiKey, { kommuner });
  }

  return loadDemoRegister();
}

async function rebuildRegisterJoin(features) {
  setRegisterStatus("Laddar nybyggnadsregister …");
  try {
    const loaded = await loadNybyggRegister(features);
    registerMeta = { label: loaded.label, source: loaded.source };
    const { ids, matchDetails } = computeRegisterMatchedBrunnsIds(
      features,
      loaded.permits,
      {
        bufferM: SPATIAL_BUFFER_METERS,
        temporalBufferMonths: TEMPORAL_BUFFER_MONTHS,
      }
    );
    setRegisterMatchedBrunnsIds(ids);
    const matchN = matchDetails.length;
    setRegisterStatus(
      `${loaded.label}. Registerjoin: ${matchN} brunnar (≤${SPATIAL_BUFFER_METERS} m eller fastighet, plan/lov högst ${TEMPORAL_BUFFER_MONTHS} mån före borrning).`,
      "ok"
    );
  } catch (err) {
    console.error(err);
    setRegisterMatchedBrunnsIds(null);
    registerMeta = null;
    const message =
      err instanceof Error ? err.message : "Kunde inte ladda nybygg-register.";
    setRegisterStatus(message, "error");
  }
}

function renderFeatures(features, { fitBounds = false } = {}) {
  clusterGroup.clearLayers();
  const markers = [];

  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!coords || f.geometry?.type !== "Point") continue;
    const [lon, lat] = coords;
    const marker = L.marker([lat, lon]);
    marker.bindPopup(popupHtml(f.properties || {}));
    markers.push(marker);
  }

  clusterGroup.addLayers(markers);

  if (fitBounds && markers.length > 0) {
    const bounds = clusterGroup.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.08));
      hasFittedBounds = true;
    }
  }
}

function applyClientFilters({ fitBounds = false } = {}) {
  const opts = getFilterOptions();
  if (opts.onlyNybyggRegister && !hasRegisterMatches()) {
    statCount.textContent =
      "Inga registerträffar – aktivera demoläge eller ange Combify-nyckel";
  }
  const filtered = filterFeaturesForMap(allFeatures, opts);
  renderFeatures(filtered, { fitBounds });
  updateStatCount(filtered.length, allFeatures.length);
}

async function loadData() {
  btnReload.disabled = true;
  statCount.textContent = "Laddar …";
  statusMsg.textContent = "Kontaktar SGU:s öppna API …";

  try {
    allFeatures = await fetchAllFeatures();
    hasFittedBounds = false;
    await rebuildRegisterJoin(allFeatures);
    applyClientFilters({ fitBounds: true });
    statusMsg.textContent = `Senast uppdaterad: ${new Date().toLocaleString("sv-SE")}`;
  } catch (err) {
    console.error(err);
    allFeatures = [];
    setRegisterMatchedBrunnsIds(null);
    clusterGroup.clearLayers();
    statCount.textContent = "Kunde inte ladda data";
    statusMsg.textContent =
      err instanceof Error ? err.message : "Okänt fel vid hämtning.";
  } finally {
    btnReload.disabled = false;
  }
}

filterNybyggRegister?.addEventListener("change", () => {
  applyClientFilters({ fitBounds: !hasFittedBounds });
});

registerModeSelect?.addEventListener("change", async () => {
  updateRegisterModeUi();
  if (allFeatures.length) {
    await rebuildRegisterJoin(allFeatures);
    applyClientFilters({ fitBounds: false });
  }
});

btnSaveCombifyKey?.addEventListener("click", () => {
  const key = combifyKeyInput?.value?.trim();
  if (key) {
    sessionStorage.setItem(COMBIFY_API_KEY_STORAGE, key);
    setRegisterStatus("Combify-nyckel sparad i sessionStorage för denna flik.", "ok");
  } else {
    sessionStorage.removeItem(COMBIFY_API_KEY_STORAGE);
    setRegisterStatus("Combify-nyckel borttagen från sessionStorage.", "info");
  }
});

updateRegisterModeUi();

const storedKey = sessionStorage.getItem(COMBIFY_API_KEY_STORAGE);
if (storedKey && combifyKeyInput) {
  combifyKeyInput.placeholder = "Nyckel sparad i sessionStorage";
}

btnReload.addEventListener("click", () => loadData());

const MOBILE_MAX_WIDTH = 640;
const sidebarEl = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarPanel = document.getElementById("sidebar-panel");
const appShell = document.getElementById("app-shell");

function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}

function setMobileSidebarCollapsed(collapsed) {
  if (!sidebarEl || !sidebarToggle || !sidebarPanel) return;
  const on = isMobileLayout();
  if (!on) {
    sidebarEl.dataset.mobileCollapsed = "false";
    sidebarToggle.setAttribute("aria-expanded", "true");
    sidebarPanel.hidden = false;
    appShell?.classList.remove("sidebar-expanded");
    return;
  }
  sidebarEl.dataset.mobileCollapsed = collapsed ? "true" : "false";
  sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  sidebarPanel.hidden = collapsed;
  appShell?.classList.toggle("sidebar-expanded", !collapsed);
}

function initMobileSidebar() {
  setMobileSidebarCollapsed(true);
  sidebarToggle?.addEventListener("click", () => {
    if (!isMobileLayout()) return;
    const collapsed = sidebarEl?.dataset.mobileCollapsed !== "false";
    setMobileSidebarCollapsed(!collapsed);
  });
  window
    .matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`)
    .addEventListener("change", () => setMobileSidebarCollapsed(true));
}

initMobileSidebar();
loadData();
