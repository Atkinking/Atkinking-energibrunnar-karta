import {
  filterFeaturesForMap,
  describeNybyggeFilterCounts,
  NYBYGGE_TEXT_PROPERTY_KEYS,
} from "./filter-config.js";

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
const btnReload = document.getElementById("btn-reload");
const filterNybygge = document.getElementById("filter-nybygge");
const filterNybyggeStrict = document.getElementById("filter-nybygge-strict");

/** @type {object[]} */
let allFeatures = [];
let hasFittedBounds = false;

function getFilterOptions() {
  return {
    onlyNybygge: Boolean(filterNybygge?.checked),
    strictNybygge: Boolean(filterNybyggeStrict?.checked),
  };
}

function updateStrictDisabled() {
  if (!filterNybyggeStrict || !filterNybygge) return;
  const on = filterNybygge.checked;
  filterNybyggeStrict.disabled = !on;
  if (!on) filterNybyggeStrict.checked = false;
}

function updateStatCount(shown, total) {
  const opts = getFilterOptions();
  if (opts.onlyNybygge) {
    statCount.textContent = describeNybyggeFilterCounts(shown, total);
    return;
  }
  statCount.textContent = `${total.toLocaleString("sv-SE")} energibrunnar i perioden`;
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
  for (const key of NYBYGGE_TEXT_PROPERTY_KEYS) {
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
  const filtered = filterFeaturesForMap(allFeatures, getFilterOptions());
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
    applyClientFilters({ fitBounds: true });
    statusMsg.textContent = `Senast uppdaterad: ${new Date().toLocaleString("sv-SE")}`;
  } catch (err) {
    console.error(err);
    allFeatures = [];
    clusterGroup.clearLayers();
    statCount.textContent = "Kunde inte ladda data";
    statusMsg.textContent =
      err instanceof Error ? err.message : "Okänt fel vid hämtning.";
  } finally {
    btnReload.disabled = false;
  }
}

filterNybygge?.addEventListener("change", () => {
  updateStrictDisabled();
  applyClientFilters({ fitBounds: !hasFittedBounds });
});

filterNybyggeStrict?.addEventListener("change", () => {
  applyClientFilters({ fitBounds: false });
});

updateStrictDisabled();
btnReload.addEventListener("click", () => loadData());
loadData();
