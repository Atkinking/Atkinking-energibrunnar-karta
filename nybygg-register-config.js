/**
 * Konfiguration för koppling mot externt nybyggnadsregister.
 * Combify kräver API-nyckel även i sandbox (x-api-key).
 */

export const NYBYGG_REGISTER_MODES = {
  oppnaCache: "oppna-cache",
  lanRestCache: "lan-rest-cache",
  demo: "demo",
  combify: "combify",
  url: "url",
};

/** Standard – läns-cache (REST/WFS där tillgängligt), ingen nyckel. */
export const DEFAULT_REGISTER_MODE = NYBYGG_REGISTER_MODES.lanRestCache;

export const DEMO_REGISTER_URL = "data/demo-nybygg-register.json";

export const OPNA_CACHE_URL = "data/oppna-nybygg-cache.json";

/** Bundlad läns-cache (REST/WFS/HTML) – Stockholms län. */
export const LAN_REST_CACHE_URL = "data/lan-rest-nybygg-cache.json";

export const COMBIFY_API_BASES = {
  production: "https://api.combify.com/v1",
  sandbox: "https://sandbox-api.combify.com/v1",
};

/** Standard sandbox tills Alex aktiverar produktion. */
export const DEFAULT_COMBIFY_BASE = COMBIFY_API_BASES.sandbox;

/** Buffer runt nybyggnadslov / brunn vid spatial join (meter). */
export const SPATIAL_BUFFER_METERS = 50;

/**
 * Registerhändelse (detaljplan, bygglov) får ligga högst så här många kalendermånader
 * före borrdatum. Borr kan ske 3–5 mån efter plan/lov; standard 4 mån (mitten i intervallet).
 */
export const TEMPORAL_BUFFER_MONTHS = 4;

/** Projektperiod – filtrerar Combify-hämtning. */
export const PERMIT_DATE_FROM = "2025-10-01";
export const PERMIT_DATE_TO = "2026-03-31";

export const COMBIFY_PAGE_SIZE = 100;
export const COMBIFY_MAX_PAGES = 40;

/** sessionStorage-nyckel – nyckeln lagras endast i webbläsaren, inte i repo. */
export const COMBIFY_API_KEY_STORAGE = "sbc_combify_api_key";

/** Cursor Publish / server-proxy (framtida): bind-app-secrets COMBIFY_API_KEY */
export const COMBIFY_SECRET_NAME = "COMBIFY_API_KEY";
