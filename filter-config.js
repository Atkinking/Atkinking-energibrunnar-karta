/**
 * Klientfilter: nybygge vs befintlig bostad.
 *
 * SGU Brunnsarkiv har inget officiellt fält för nybygge – endast fritext i
 * `lage_specifikt` och `allman_anmarkning`.
 *
 * Räknat mot API (ENE, 2025-10-01–2026-03-31, 2026-11-13):
 * - Totalt: 5 028 poster
 * - Mönster nybygg|nyproduktion (äldre): 10
 * - Inkludering nedan (fash 1): 11
 * - Strikt läge med exkludering (fash 1b): 11 (ingen av inkluderingarna träffades av exkludering)
 */

/** Fält som kombineras till söktext (gemensam policy). */
export const NYBYGGE_TEXT_PROPERTY_KEYS = ["lage_specifikt", "allman_anmarkning"];

/**
 * Fash 1 – text tyder på nybygge (case-insensitive, svenska tecken).
 * Undviker falska träffar på t.ex. «Benny» genom helordsmönster, inte enkel «ny».
 */
export const NYBYGGE_INCLUDE_PATTERN = new RegExp(
  [
    "nybygg(?:nad|e)?",
    "nyproduktion",
    "nybebyggelse",
    "ny(?:a|tt)?\\s+byggn?ad",
  ].join("|"),
  "i"
);

/**
 * Fash 1b – när strikt läge är på: exkludera poster där fritext tydligt avser befintlig bostad
 * eller kompletteringsborrning vid gamla hål.
 */
export const NYBYGGE_STRICT_EXCLUDE_PATTERN = new RegExp(
  [
    "befintlig\\s+bostad",
    "befintligt\\s+boende",
    "befintligt\\s+hus",
    "gammal[a]?\\s+bostad",
    "gamla\\s+bostad",
    "äldre\\s+bostad",
    "\\bvilla\\b",
    "\\bsmåhus\\b",
    "enskilt\\s+boende",
    "ersätter\\s+äldre",
    "gamla\\s+hålet",
    "kompletterings\\s+borrning",
  ].join("|"),
  "i"
);

/** @type {Set<string> | null} Valfri extern allowlist (t.ex. SBC CSV med brunnsid). */
let externalAllowlistIds = null;

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

export function getCombinedNybyggeText(properties) {
  return NYBYGGE_TEXT_PROPERTY_KEYS.map((key) =>
    String(properties?.[key] ?? "").trim()
  )
    .filter(Boolean)
    .join(" ");
}

export function matchesNybyggeText(properties) {
  const text = getCombinedNybyggeText(properties);
  if (!text) return false;
  return NYBYGGE_INCLUDE_PATTERN.test(text);
}

export function matchesStrictExclude(properties) {
  const text = getCombinedNybyggeText(properties);
  if (!text) return false;
  return NYBYGGE_STRICT_EXCLUDE_PATTERN.test(text);
}

export function isOnExternalAllowlist(properties) {
  if (!externalAllowlistIds?.size) return false;
  const id = properties?.brunnsid;
  return id != null && externalAllowlistIds.has(String(id));
}

/**
 * @param {object} feature GeoJSON-feature
 * @param {{ onlyNybygge: boolean, strictNybygge: boolean }} options
 */
export function featurePassesNybyggeFilter(feature, options) {
  if (!options.onlyNybygge) return true;

  const props = feature.properties ?? {};
  const textMatch = matchesNybyggeText(props);
  const allowlisted = isOnExternalAllowlist(props);

  if (!textMatch && !allowlisted) return false;
  if (options.strictNybygge && textMatch && matchesStrictExclude(props)) {
    return allowlisted;
  }
  return true;
}

/**
 * @param {object[]} features
 * @param {{ onlyNybygge: boolean, strictNybygge: boolean }} options
 */
export function filterFeaturesForMap(features, options) {
  if (!options.onlyNybygge) return features;
  return features.filter((f) => featurePassesNybyggeFilter(f, options));
}

export function describeNybyggeFilterCounts(shown, total) {
  const x = Number(shown).toLocaleString("sv-SE");
  const y = Number(total).toLocaleString("sv-SE");
  return `Visar ${x} av ${y} (filter: nybygge)`;
}
