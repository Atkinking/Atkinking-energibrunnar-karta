/**
 * CLI: registerjoin-statistik för VP-period (använder nybygg-register.js).
 * node scripts/compute-register-matches.mjs [demo|oppna-cache]
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  computeRegisterMatchedBrunnsIds,
  parseRegisterPayload,
} from "../nybygg-register.js";
import {
  SPATIAL_BUFFER_METERS,
  TEMPORAL_BUFFER_MONTHS,
} from "../nybygg-register-config.js";

const DATE_FROM = "20251001";
const DATE_TO = "20260331";
const API_BASE =
  "https://api.sgu.se/oppnadata/brunnar/ogc/features/v1/collections/brunnar/items";
const FILTER = encodeURIComponent(
  `anvandning_kod='ENE' AND borrdatum >= '${DATE_FROM}' AND borrdatum <= '${DATE_TO}'`
);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2] ?? "oppna-cache";

async function fetchAllFeatures() {
  const features = [];
  let url = `${API_BASE}?filter=${FILTER}&limit=5000&f=application/geo%2Bjson`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SGU ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data.features)) features.push(...data.features);
    const next = (data.links || []).find((l) => l.rel === "next");
    url = next?.href ?? null;
  }
  return features;
}

async function loadRegisterPermits() {
  const rel =
    mode === "demo" ? "data/demo-nybygg-register.json" : "data/oppna-nybygg-cache.json";
  const raw = await readFile(path.join(root, rel), "utf8");
  const payload = JSON.parse(raw);
  return parseRegisterPayload(payload);
}

function isStockholmsLan(props) {
  const kod = String(props.kommunkod ?? "");
  return kod.startsWith("01");
}

function isStockholmStad(props) {
  return String(props.kommunkod ?? "") === "0180";
}

async function main() {
  const [features, permits] = await Promise.all([
    fetchAllFeatures(),
    loadRegisterPermits(),
  ]);
  const { ids, matchDetails } = computeRegisterMatchedBrunnsIds(features, permits, {
    bufferM: SPATIAL_BUFFER_METERS,
    temporalBufferMonths: TEMPORAL_BUFFER_MONTHS,
  });
  const matchedSet = ids;
  let lan = 0;
  let stad = 0;
  for (const f of features) {
    const id = String(f.properties?.brunnsid ?? "");
    if (!matchedSet.has(id)) continue;
    if (isStockholmsLan(f.properties)) lan += 1;
    if (isStockholmStad(f.properties)) stad += 1;
  }
  const out = {
    mode,
    spatial_buffer_m: SPATIAL_BUFFER_METERS,
    temporal_buffer_months: TEMPORAL_BUFFER_MONTHS,
    vp_period: "2025-10-01 – 2026-03-31",
    total_features: features.length,
    matches: {
      total: matchedSet.size,
      stockholms_lan: lan,
      stockholm_stad: stad,
    },
    match_details_count: matchDetails.length,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
