#!/usr/bin/env python3
"""
SBC-12: Inventera och harvesta öppna REST/WFS/ArcGIS-källor för nybygg-/bygglovdata
i Stockholms län (26 kommuner + Stockholm stad). Ingen Fixlo, ingen betald auth.

Kör: python3 scripts/harvest-lan-rest-nybygg.py
     (valfritt: --stockholm för att först uppdatera data/oppna-nybygg-cache.json)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "data" / "lan-rest-nybygg-cache.json"
STOCKHOLM_CACHE = ROOT / "data" / "oppna-nybygg-cache.json"
STOCKHOLM_HARVEST = ROOT / "scripts" / "harvest-stockholm-oppna-cache.py"

UA = "sbc-nybygg-harvest-lan/1.0 (SBC-12, öppen data)"

KOMMUNER: list[dict[str, str]] = [
    {"kod": "0114", "namn": "Upplands-Bro", "slug": "upplands-bro"},
    {"kod": "0115", "namn": "Vallentuna", "slug": "vallentuna"},
    {"kod": "0117", "namn": "Österåker", "slug": "ostersaker"},
    {"kod": "0120", "namn": "Värmdö", "slug": "varmdo"},
    {"kod": "0123", "namn": "Järfälla", "slug": "jarfalla"},
    {"kod": "0125", "namn": "Ekerö", "slug": "ekero"},
    {"kod": "0126", "namn": "Huddinge", "slug": "huddinge"},
    {"kod": "0127", "namn": "Botkyrka", "slug": "botkyrka"},
    {"kod": "0128", "namn": "Salem", "slug": "salem"},
    {"kod": "0136", "namn": "Haninge", "slug": "haninge"},
    {"kod": "0138", "namn": "Tyresö", "slug": "tyreso"},
    {"kod": "0139", "namn": "Upplands Väsby", "slug": "upplandsvasby"},
    {"kod": "0160", "namn": "Vaxholm", "slug": "vaxholm"},
    {"kod": "0162", "namn": "Nykvarn", "slug": "nykvarn"},
    {"kod": "0163", "namn": "Sollentuna", "slug": "sollentuna"},
    {"kod": "0164", "namn": "Södertälje", "slug": "sodertalje"},
    {"kod": "0165", "namn": "Solna", "slug": "solna"},
    {"kod": "0166", "namn": "Lidingö", "slug": "lidingo"},
    {"kod": "0167", "namn": "Nacka", "slug": "nacka"},
    {"kod": "0168", "namn": "Sundbyberg", "slug": "sundbyberg"},
    {"kod": "0169", "namn": "Danderyd", "slug": "danderyd"},
    {"kod": "0170", "namn": "Täby", "slug": "taby"},
    {"kod": "0180", "namn": "Stockholm", "slug": "stockholm"},
    {"kod": "0181", "namn": "Sigtuna", "slug": "sigtuna"},
    {"kod": "0182", "namn": "Nynäshamn", "slug": "nynashamn"},
    {"kod": "0183", "namn": "Norrtälje", "slug": "norrtalje"},
]

# Inventeringsresultat (sondering 2026-11-13, curl + WFS/ArcGIS capabilities)
INVENTORY: list[dict[str, Any]] = [
    {
        "kod": "0180",
        "namn": "Stockholm",
        "harvestable": True,
        "source_type": "html",
        "endpoints": [
            {
                "name": "Bygg- och plantjänsten – pågående planarbeten",
                "url": "https://etjanster.stockholm.se/Byggochplantjansten/pagaendeplanarbeten",
                "geometry": "indirekt (Nominatim/stadsdel)",
                "cors_browser": "indirekt (bundlad cache)",
                "auth": "ingen",
            }
        ],
        "notes": "ByggR bulk-API saknas. LM NGP 401 utan OAuth.",
    },
    {
        "kod": "0167",
        "namn": "Nacka",
        "harvestable": True,
        "source_type": "wfs",
        "endpoints": [
            {
                "name": "GeoServer exploateringskarta bygglov",
                "url": "https://karta.nacka.se/geoserver/ows",
                "layer": "nacka:exploateringskarta_soboo_bygglov",
                "fields": "fastighet, bygglov_dnr, bygglov_status, plannamn, nytt_bygglov",
                "geometry": "MultiPolygon (EPSG:3006)",
                "cors_browser": "ja (*)",
                "auth": "ingen",
            },
            {
                "name": "Detaljplaner gällande (ej bygglov)",
                "url": "https://karta.nacka.se/geoserver/ows",
                "layer": "nacka:detaljplaner_gallande",
                "geometry": "polygon",
                "harvested": False,
            },
        ],
        "notes": "Exploaterings-/markbygglov, svag bostadsfiltrering.",
    },
    {
        "kod": "0120",
        "namn": "Värmdö",
        "harvestable": True,
        "source_type": "wfs",
        "endpoints": [
            {
                "name": "Byggnader med ny-/ombyggnadsår",
                "url": "https://karta.varmdo.se/geoserver/ows",
                "layer": "extern_db:vy_fb_byggnader_med_nybyggar_ombyggar_y",
                "fields": "fastighet, andamal_text, nybyggnadsar, total_bostadsarea",
                "geometry": "MultiPolygon (EPSG:3006)",
                "cors_browser": "ja (*)",
                "auth": "ingen",
            }
        ],
        "notes": "Byggnadsregister, inte ByggR-ärenden. Bostadsfilter via andamal + nybyggnadsar.",
    },
    {
        "kod": "0163",
        "namn": "Sollentuna",
        "harvestable": False,
        "endpoints": [
            {
                "name": "karta.sollentuna.se → kartor.sollentuna.se (Bios)",
                "url": "https://kartor.sollentuna.se/bios/dpwebmap/cust_sol/extern/",
                "auth": "ingen i webb",
                "notes": "Ingen publik FeatureServer/WFS för bygglov i REST.",
            }
        ],
    },
]

# Standardpost för kommuner utan träff – fylls i build_full_inventory()
_NEGATIVE_TEMPLATE = (
    "Ingen öppen ArcGIS FeatureServer/MapServer eller GeoServer-WFS med "
    "bygglovsansökningar/beviljade hittades (sondering karta.*.se / gis.*.se). "
    "Öppen geodata ofta WMS/tomgata eller e-tjänst utan bulk-API."
)


def fetch_json(url: str, timeout: int = 90) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def fetch_wfs_geojson(base: str, type_name: str, *, cql: str | None = None, count: int = 5000) -> dict:
    params: dict[str, str] = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": type_name,
        "outputFormat": "application/json",
        "count": str(count),
    }
    if cql:
        params["cql_filter"] = cql
    url = base + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def ring_centroid(ring: list[list[float]]) -> tuple[float, float]:
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    n = len(ring)
    if n < 3:
        return sum(xs) / n, sum(ys) / n
    a = cx = cy = 0.0
    for i in range(n):
        j = (i + 1) % n
        cross = ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]
        a += cross
        cx += (ring[i][0] + ring[j][0]) * cross
        cy += (ring[i][1] + ring[j][1]) * cross
    if abs(a) < 1e-9:
        return sum(xs) / n, sum(ys) / n
    a *= 0.5
    return cx / (6 * a), cy / (6 * a)


def geometry_centroid_sweref(geom: dict | None) -> tuple[float, float] | None:
    if not geom:
        return None
    t = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return None
    if t == "Point":
        return float(coords[0]), float(coords[1])
    if t == "Polygon":
        return ring_centroid(coords[0])
    if t == "MultiPolygon":
        best = None
        best_area = -1.0
        for poly in coords:
            if not poly:
                continue
            ring = poly[0]
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            area = (max(xs) - min(xs)) * (max(ys) - min(ys))
            if area > best_area:
                best_area = area
                best = ring
        if best:
            return ring_centroid(best)
    return None


def sweref99_tm_to_wgs84(x: float, y: float) -> tuple[float, float]:
    from pyproj import Transformer

    tr = Transformer.from_crs(3006, 4326, always_xy=True)
    lon, lat = tr.transform(x, y)
    return float(lat), float(lon)


RESIDENTIAL_RE = re.compile(
    r"bost|villa|flerb|lägen|radhus|brf|småhus|bostads", re.I
)


def is_residential_text(blob: str) -> bool:
    return bool(RESIDENTIAL_RE.search(blob))


def normalize_property(raw: str | None) -> str | None:
    if not raw:
        return None
    s = re.sub(r"\s+", " ", str(raw).strip()).upper()
    s = re.sub(r"(\d+)\s*:\s*(\d+)", r"\1:\2", s)
    return s or None


def parse_year_from_dnr(dnr: str | None) -> int | None:
    if not dnr:
        return None
    m = re.search(r"(20\d{2})", dnr)
    return int(m.group(1)) if m else None


def harvest_stockholm_from_cache() -> list[dict]:
    if not STOCKHOLM_CACHE.is_file():
        return []
    data = json.loads(STOCKHOLM_CACHE.read_text(encoding="utf-8"))
    permits: list[dict] = []
    for p in data.get("permits", []):
        permits.append(
            {
                **p,
                "source_type": "html",
                "municipality": "STOCKHOLM",
                "meta": {
                    **(p.get("meta") or {}),
                    "kommunkod": "0180",
                    "harvest_layer": "stockholm_pagaende_dplan",
                },
            }
        )
    return permits


def harvest_nacka_bygglov() -> list[dict]:
    wfs = "https://karta.nacka.se/geoserver/ows"
    layer = "nacka:exploateringskarta_soboo_bygglov"
    fc = fetch_wfs_geojson(wfs, layer, count=5000)
    out: list[dict] = []
    for feat in fc.get("features", []):
        props = feat.get("properties") or {}
        blob = " ".join(str(v) for v in props.values() if v)
        residential = is_residential_text(blob)
        cent = geometry_centroid_sweref(feat.get("geometry"))
        lat = lon = None
        if cent:
            lat, lon = sweref99_tm_to_wgs84(*cent)
        prop = normalize_property(props.get("fastighet") or props.get("fastighetsbeteckning"))
        dnr = props.get("bygglov_dnr")
        year = parse_year_from_dnr(str(dnr) if dnr else None)
        decision = f"{year}-07-01" if year and year >= 2010 else None
        fid = re.sub(r"[^\w\-]", "_", str(dnr or feat.get("id") or len(out)))
        out.append(
            {
                "id": f"nacka-wfs-{fid}",
                "source": "nacka_geoserver_bygglov",
                "source_type": "wfs",
                "procedure": "new_building" if residential else "land_development",
                "labels": ["residential"] if residential else ["non_residential"],
                "property_designation": prop,
                "municipality": "NACKA",
                "longitude": lon,
                "latitude": lat,
                "decision_date": decision,
                "meta": {
                    "kommunkod": "0167",
                    "bygglov_dnr": dnr,
                    "bygglov_status": props.get("bygglov_status"),
                    "plannamn": props.get("plannamn"),
                    "nytt_bygglov": props.get("nytt_bygglov"),
                    "wfs_layer": layer,
                    "crs": "EPSG:3006",
                    "geometry_type": "polygon_centroid",
                },
            }
        )
    return out


def harvest_varmdo_bostadsbyggnader() -> list[dict]:
    wfs = "https://karta.varmdo.se/geoserver/ows"
    layer = "extern_db:vy_fb_byggnader_med_nybyggar_ombyggar_y"
    years = (2024, 2025, 2026)
    collected: list[dict] = []
    for year in years:
        cql = f"nybyggnadsar={year} AND andamal_text ILIKE '%bost%'"
        fc = fetch_wfs_geojson(wfs, layer, cql=cql, count=5000)
        for feat in fc.get("features", []):
            props = feat.get("properties") or {}
            cent = geometry_centroid_sweref(feat.get("geometry"))
            lat = lon = None
            if cent:
                lat, lon = sweref99_tm_to_wgs84(*cent)
            prop = normalize_property(props.get("fastighet"))
            uid = props.get("uuid_byggnad") or feat.get("id")
            collected.append(
                {
                    "id": f"varmdo-wfs-{uid}",
                    "source": "varmdo_geoserver_byggnader",
                    "source_type": "wfs",
                    "procedure": "new_building",
                    "labels": ["residential"],
                    "property_designation": prop,
                    "municipality": "VÄRMDÖ",
                    "longitude": lon,
                    "latitude": lat,
                    "decision_date": f"{year}-06-15",
                    "status_date": f"{year}-06-15",
                    "meta": {
                        "kommunkod": "0120",
                        "andamal_text": props.get("andamal_text"),
                        "nybyggnadsar": props.get("nybyggnadsar"),
                        "total_bostadsarea": props.get("total_bostadsarea"),
                        "wfs_layer": layer,
                        "data_class": "fardig_byggnad_ar",
                    },
                }
            )
    return collected


def build_full_inventory() -> list[dict[str, Any]]:
    by_kod = {row["kod"]: row for row in INVENTORY}
    full: list[dict[str, Any]] = []
    for k in KOMMUNER:
        kod = k["kod"]
        if kod in by_kod:
            full.append(by_kod[kod])
        else:
            full.append(
                {
                    "kod": kod,
                    "namn": k["namn"],
                    "harvestable": False,
                    "endpoints": [],
                    "notes": _NEGATIVE_TEMPLATE,
                }
            )
    return full


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--stockholm",
        action="store_true",
        help="Kör harvest-stockholm-oppna-cache.py före merge",
    )
    args = parser.parse_args()

    if args.stockholm and STOCKHOLM_HARVEST.is_file():
        subprocess.run([sys.executable, str(STOCKHOLM_HARVEST)], check=False)

    permits: list[dict] = []
    harvest_log: list[dict[str, Any]] = []

    stockholm = harvest_stockholm_from_cache()
    permits.extend(stockholm)
    harvest_log.append(
        {
            "municipality": "Stockholm",
            "source_type": "html",
            "count": len(stockholm),
            "ok": True,
        }
    )

    try:
        nacka = harvest_nacka_bygglov()
        residential = sum(1 for p in nacka if "residential" in p.get("labels", []))
        permits.extend(nacka)
        harvest_log.append(
            {
                "municipality": "Nacka",
                "source_type": "wfs",
                "count": len(nacka),
                "residential_hint": residential,
                "ok": True,
            }
        )
    except Exception as exc:
        harvest_log.append({"municipality": "Nacka", "ok": False, "error": str(exc)})

    try:
        varmdo = harvest_varmdo_bostadsbyggnader()
        permits.extend(varmdo)
        harvest_log.append(
            {
                "municipality": "Värmdö",
                "source_type": "wfs",
                "count": len(varmdo),
                "ok": True,
            }
        )
    except Exception as exc:
        harvest_log.append({"municipality": "Värmdö", "ok": False, "error": str(exc)})

    inventory = build_full_inventory()
    harvested_kommuner = sorted({p.get("municipality") for p in permits if p.get("municipality")})

    payload = {
        "meta": {
            "description": (
                "Bundlad öppen REST/WFS/HTML-cache för nybygg-/bygglovdata i Stockholms län. "
                "Ersätter inte Combify eller ByggR. Kommuner utan harvest finns listade i inventory."
            ),
            "scope": "Stockholms län (26 kommuner, inkl. Stockholms stad 0180)",
            "municipalities": harvested_kommuner,
            "spatial_buffer_m": 50,
            "temporal_buffer_months": 4,
            "harvested_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "inventory_kommuner": len(inventory),
            "harvestable_kommuner": sum(1 for i in inventory if i.get("harvestable")),
            "permit_count": len(permits),
            "with_coordinates": sum(1 for p in permits if p.get("latitude") is not None),
            "with_property_designation": sum(1 for p in permits if p.get("property_designation")),
            "harvest_log": harvest_log,
            "inventory": inventory,
            "reference_patterns": [
                {
                    "name": "Skellefteå Nybyggnadskarta (utanför länet)",
                    "url": "https://geodata.skelleftea.se/arcgis/rest/services/Planerad_markanvändning/Nybyggnadskarta_openE_ext/FeatureServer/0",
                    "type": "arcgis_featureserver",
                    "notes": "Mönster för ArcGIS FeatureServer – ej tillgängligt för länsk kommuner i bulk.",
                }
            ],
            "blocked_sources": [
                {
                    "name": "Lantmäteriet NGP / Byggnad OGC",
                    "url": "https://api.lantmateriet.se/",
                    "auth": "OAuth/API-nyckel (401 utan)",
                    "notes": "Endast om Alex binder Geotorget-konto; ej i browsern utan proxy.",
                }
            ],
            "notes": [
                "Majoriteten av länskommunerna saknar öppen ByggR-/ArcGIS FeatureServer-export.",
                "Nacka WFS är exploateringskarta, inte full bygglovslista med beslutsdatum.",
                "Värmdö WFS är byggnadsår (färdig byggnad), inte bygglovsansökan.",
            ],
        },
        "permits": permits,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Skrev {OUT_PATH} ({len(permits)} poster, {len(harvested_kommuner)} kommuner)")


if __name__ == "__main__":
    main()
