/**
 * Klientfilter: nybyggda bostäder via externt register (primärt).
 *
 * SGU Brunnsarkiv saknar fält för nybygge. Textfilter (SBC-5) ersätts av
 * registerjoin i `nybygg-register.js` (fastighetsbeteckning + buffer ~50 m).
 */

/** @type {Set<string> | null} Träffar från nybyggnadsregister (brunnsid). */
let registerMatchedBrunnsIds = null;

/** @type {Set<string> | null} Valfri manuell allowlist (CSV/JSON). */
let externalAllowlistIds = null;

/**
 * Sätt mängd brunnsid som matchar nybyggnadsregister.
 * @param {Iterable<string> | null | undefined} ids
 */
export function setRegisterMatchedBrunnsIds(ids) {
  if (!ids) {
    registerMatchedBrunnsIds = null;
    return;
  }
  registerMatchedBrunnsIds = new Set(
    [...ids].map((id) => String(id).trim()).filter(Boolean)
  );
}

export function hasRegisterMatches() {
  return Boolean(registerMatchedBrunnsIds?.size);
}

export function getRegisterMatchCount() {
  return registerMatchedBrunnsIds?.size ?? 0;
}

/**
 * Sätt allowlist från extern lista. null/undefined rensar.
 * @param {Iterable<string> | null | undefined} ids
 */
export function setExternalAllowlistIds(ids) {
  if (!ids) {
    externalAllowlistIds = null;
    return;
  }
  externalAllowlistIds = new Set(
    [...ids].map((id) => String(id).trim()).filter(Boolean)
  );
}

/**
 * Ladda allowlist från URL (JSON-array av id-strängar eller objekt med `brunnsid`).
 * @param {string} url
 */
export async function loadExternalAllowlistFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Allowlist: HTTP ${res.status}`);
  }
  const data = await res.json();
  const ids = Array.isArray(data)
    ? data.map((row) =>
        typeof row === "string" ? row : row?.brunnsid ?? row?.id
      )
    : [];
  setExternalAllowlistIds(ids.filter(Boolean));
}

export function isOnExternalAllowlist(properties) {
  if (!externalAllowlistIds?.size) return false;
  const id = properties?.brunnsid;
  return id != null && externalAllowlistIds.has(String(id));
}

export function isRegisterMatch(properties) {
  if (!registerMatchedBrunnsIds?.size) return false;
  const id = properties?.brunnsid;
  return id != null && registerMatchedBrunnsIds.has(String(id));
}

/**
 * @param {object} feature GeoJSON-feature
 * @param {{ onlyNybyggRegister: boolean }} options
 */
export function featurePassesNybyggRegisterFilter(feature, options) {
  if (!options.onlyNybyggRegister) return true;

  const props = feature.properties ?? {};
  return isRegisterMatch(props) || isOnExternalAllowlist(props);
}

/**
 * @param {object[]} features
 * @param {{ onlyNybyggRegister: boolean }} options
 */
export function filterFeaturesForMap(features, options) {
  if (!options.onlyNybyggRegister) return features;
  return features.filter((f) => featurePassesNybyggRegisterFilter(f, options));
}

export function describeNybyggRegisterFilterCounts(shown, total, registerTotal) {
  const x = Number(shown).toLocaleString("sv-SE");
  const y = Number(total).toLocaleString("sv-SE");
  const r =
    registerTotal != null
      ? `, registerträffar ${Number(registerTotal).toLocaleString("sv-SE")}`
      : "";
  return `Visar ${x} av ${y} (filter: nybyggda bostäder via register${r})`;
}
