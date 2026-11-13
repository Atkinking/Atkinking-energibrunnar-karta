/**
 * Laddning och spatial/fastighetsjoin mot nybyggnadsregister (demo / Combify / egen URL).
 */

import {
  COMBIFY_API_BASES,
  COMBIFY_MAX_PAGES,
  COMBIFY_PAGE_SIZE,
  DEFAULT_COMBIFY_BASE,
  DEMO_REGISTER_URL,
  PERMIT_DATE_FROM,
  PERMIT_DATE_TO,
  SPATIAL_BUFFER_METERS,
} from "./nybygg-register-config.js";

const COMBIFY_RESIDENTIAL = "residential";
const COMBIFY_NEW_BUILDING = "new_building";

/**
 * Normaliserar svensk fastighetsbeteckning för jämförelse (SGU ↔ register).
 * @param {string | null | undefined} value
 */
export function normalizePropertyDesignation(value) {
  if (value == null) return "";
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/(\d+)\s*:\s*(\d+)/g, "$1:$2");
}

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} avstånd i meter
 */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * @param {object} permit rå rad från Combify eller demo-JSON
 */
export function extractPermitRecord(permit) {
  const lon =
    permit.longitude ??
    permit.lon ??
    permit.lng ??
    permit?.location?.longitude ??
    permit?.coordinates?.[0];
  const lat =
    permit.latitude ??
    permit.lat ??
    permit?.location?.latitude ??
    permit?.coordinates?.[1];
  const property =
    permit.property_designation ??
    permit.propertyDesignation ??
    permit.fastighetsbeteckning ??
    permit.property_id ??
    permit.property;
  const municipality =
    permit.municipality ?? permit.kommun ?? permit.kommunnamn ?? "";
  const labels = Array.isArray(permit.labels)
    ? permit.labels
    : permit.label
      ? [permit.label]
      : [];
  const procedure = permit.procedure ?? permit.procedure_type ?? "";
  return {
    id: permit.id ?? permit.permit_id ?? "",
    source: permit.source ?? "unknown",
    longitude: lon != null ? Number(lon) : null,
    latitude: lat != null ? Number(lat) : null,
    property_designation: property != null ? String(property) : "",
    property_key: normalizePropertyDesignation(property),
    municipality: String(municipality).trim().toUpperCase(),
    labels,
    procedure: String(procedure),
    decision_date:
      permit.decision_date ?? permit.decisionDate ?? permit.granted_at ?? null,
  };
}

/**
 * @param {unknown} payload
 * @returns {object[]}
 */
export function parseRegisterPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    return payload.map(extractPermitRecord);
  }
  if (Array.isArray(payload.permits)) {
    return payload.permits.map(extractPermitRecord);
  }
  if (Array.isArray(payload.items)) {
    return payload.items.map(extractPermitRecord);
  }
  if (Array.isArray(payload.data)) {
    return payload.data.map(extractPermitRecord);
  }
  return [];
}

/**
 * @param {string} url
 */
export async function loadRegisterFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Register-URL: HTTP ${res.status}`);
  }
  const data = await res.json();
  const permits = parseRegisterPayload(data);
  return {
    permits,
    source: "url",
    label: `Egen URL (${permits.length} poster)`,
  };
}

export async function loadDemoRegister() {
  const result = await loadRegisterFromUrl(DEMO_REGISTER_URL);
  return {
    ...result,
    source: "demo",
    label: `Demo (Falkenberg, Torsby, Värnamo – ${result.permits.length} bostadslov)`,
  };
}

/**
 * Mappa rå Combify-rad (fältnamn kan variera mellan versioner).
 * @param {object} row
 */
function mapCombifyRow(row) {
  return extractPermitRecord({
    ...row,
    property_designation:
      row.property_designation ??
      row.properties?.[0]?.designation ??
      row.property?.designation,
    longitude: row.longitude ?? row.lng ?? row.point?.lng,
    latitude: row.latitude ?? row.lat ?? row.point?.lat,
    municipality: row.municipality ?? row.municipality_name,
  });
}

/**
 * @param {string} apiKey
 * @param {{ baseUrl?: string, kommuner?: string[] }} [options]
 */
export async function fetchCombifyPermits(apiKey, options = {}) {
  if (!apiKey?.trim()) {
    throw new Error("Saknar Combify API-nyckel");
  }
  const base = options.baseUrl ?? DEFAULT_COMBIFY_BASE;
  const params = new URLSearchParams({
    labels: COMBIFY_RESIDENTIAL,
    procedure: COMBIFY_NEW_BUILDING,
    page_size: String(COMBIFY_PAGE_SIZE),
    decision_date_from: PERMIT_DATE_FROM,
    decision_date_to: PERMIT_DATE_TO,
  });

  const kommuner = options.kommuner?.filter(Boolean);
  if (kommuner?.length === 1) {
    params.set("municipality", kommuner[0]);
  }

  const collected = [];
  let nextToken = null;
  let page = 0;

  while (page < COMBIFY_MAX_PAGES) {
    page += 1;
    const qs = new URLSearchParams(params);
    if (nextToken) qs.set("next_token", nextToken);
    const url = `${base}/permits?${qs.toString()}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey.trim(),
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Combify: ogiltig eller saknad API-nyckel");
    }
    if (!res.ok) {
      throw new Error(`Combify: HTTP ${res.status}`);
    }
    const data = await res.json();
    const batch = parseRegisterPayload(data);
    if (!batch.length && Array.isArray(data.results)) {
      collected.push(...data.results.map(mapCombifyRow));
    } else {
      collected.push(...batch);
    }
    nextToken = data.next_token ?? data.nextToken ?? null;
    if (!nextToken) break;
  }

  const filtered =
    kommuner && kommuner.length > 1
      ? collected.filter((p) =>
          kommuner.some(
            (k) => p.municipality === String(k).trim().toUpperCase()
          )
        )
      : collected;

  const envLabel =
    base === COMBIFY_API_BASES.sandbox ? "Combify sandbox" : "Combify produktion";

  return {
    permits: filtered,
    source: "combify",
    label: `${envLabel} (${filtered.length} bostadslov, nybyggnad)`,
  };
}

/**
 * Bygger index för snabb spatial join.
 * @param {ReturnType<typeof extractPermitRecord>[]} permits
 */
export function buildPermitIndex(permits) {
  const propertyKeys = new Set();
  const points = [];
  for (const p of permits) {
    if (!p.labels.length || p.labels.includes(COMBIFY_RESIDENTIAL)) {
      // demo saknar ibland labels – behandla som bostad om procedure new_building eller demo
    }
    const isResidential =
      !p.labels.length ||
      p.labels.some(
        (l) => String(l).toLowerCase() === COMBIFY_RESIDENTIAL
      );
    const isNew =
      !p.procedure ||
      p.procedure === COMBIFY_NEW_BUILDING ||
      p.source === "demo";
    if (!isResidential || !isNew) continue;

    if (p.property_key) propertyKeys.add(p.property_key);
    if (
      p.latitude != null &&
      p.longitude != null &&
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude)
    ) {
      points.push(p);
    }
  }
  return { propertyKeys, points };
}

/**
 * @param {object} feature SGU GeoJSON
 * @param {ReturnType<typeof buildPermitIndex>} index
 * @param {{ bufferM?: number, requireMunicipalityMatch?: boolean }} [options]
 */
export function featureMatchesNybyggRegister(feature, index, options = {}) {
  const bufferM = options.bufferM ?? SPATIAL_BUFFER_METERS;
  const props = feature.properties ?? {};
  const propKey = normalizePropertyDesignation(props.fastighet);
  const kommun = String(props.kommunnamn ?? "")
    .trim()
    .toUpperCase();

  if (propKey && index.propertyKeys.has(propKey)) {
    if (!options.requireMunicipalityMatch) return true;
    const sameKommun = index.points.some(
      (p) => p.property_key === propKey && (!p.municipality || p.municipality === kommun)
    );
    if (sameKommun) return true;
  }

  const coords = feature.geometry?.coordinates;
  if (!coords || feature.geometry?.type !== "Point") return false;
  const [lon, lat] = coords;

  for (const p of index.points) {
    if (options.requireMunicipalityMatch && p.municipality && p.municipality !== kommun) {
      continue;
    }
    const d = haversineMeters(lat, lon, p.latitude, p.longitude);
    if (d <= bufferM) return true;
  }
  return false;
}

/**
 * @param {object[]} features
 * @param {ReturnType<typeof extractPermitRecord>[]} permits
 * @param {object} [options]
 */
export function computeRegisterMatchedBrunnsIds(features, permits, options = {}) {
  const index = buildPermitIndex(permits);
  const ids = new Set();
  const matchDetails = [];
  for (const f of features) {
    const props = f.properties ?? {};
    if (featureMatchesNybyggRegister(f, index, options)) {
      const id = String(props.brunnsid);
      ids.add(id);
      matchDetails.push({
        brunnsid: id,
        fastighet: props.fastighet,
        kommun: props.kommunnamn,
      });
    }
  }
  return { ids, index, matchDetails };
}
