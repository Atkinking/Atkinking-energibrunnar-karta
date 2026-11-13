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

function renderFeatures(features) {
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

  if (markers.length > 0) {
    const bounds = clusterGroup.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.08));
    }
  }
}

async function loadData() {
  btnReload.disabled = true;
  statCount.textContent = "Laddar …";
  statusMsg.textContent = "Kontaktar SGU:s öppna API …";

  try {
    const features = await fetchAllFeatures();
    renderFeatures(features);
    statCount.textContent = `${features.length.toLocaleString("sv-SE")} energibrunnar i perioden`;
    statusMsg.textContent = `Senast uppdaterad: ${new Date().toLocaleString("sv-SE")}`;
  } catch (err) {
    console.error(err);
    statCount.textContent = "Kunde inte ladda data";
    statusMsg.textContent =
      err instanceof Error ? err.message : "Okänt fel vid hämtning.";
  } finally {
    btnReload.disabled = false;
  }
}

btnReload.addEventListener("click", () => loadData());
loadData();
