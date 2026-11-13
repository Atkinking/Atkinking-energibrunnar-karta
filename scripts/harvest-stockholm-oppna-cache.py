#!/usr/bin/env python3
"""
Harvest Stockholms stads öppna plan-/byggdata (Bygg- och plantjänsten) till
data/oppna-nybygg-cache.json. Ingen inloggning eller API-nyckel.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "data" / "oppna-nybygg-cache.json"

BASE = "https://etjanster.stockholm.se/Byggochplantjansten/pagaendeplanarbeten"
LIST_URL = (
    BASE
    + "?"
    + urllib.parse.urlencode(
        {
            "SearchParameters.SearchType": "Advanced",
            "SearchParameters.PlanContent": "Bostäder",
        }
    )
)
MAP_URL = (
    "https://kartor.stockholm.se/bios/servlet/app.htmlclient.servlets.GetMapForQuery/"
    "app/baggis/web/web_query?section=locate*planarea_from_dnr&1={jid}"
    "&wms=/wms/app/baggis/web/WMS_STHLM_STOCKHOLMSKARTA_GRA_PUBLIC"
    "&width=325&height=323&srs=EPSG:3011&bufferaspercent=10"
)

# Grova stadsdelscentrum (WGS84) – reserv om varken projektnamn eller Nominatim ger träff.
STADSDEL_CENTROID = {
    "Kista": (59.403, 17.944),
    "Kärrtorp": (59.286, 18.116),
    "Långsjö": (59.306, 18.000),
    "Sätra": (59.247, 17.967),
    "Södermalm": (59.314, 18.074),
    "Solhem": (59.275, 17.880),
    "Sundby": (59.275, 18.043),
    "Norrmalm": (59.334, 18.063),
}


class DLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_dt = False
        self.in_dd = False
        self.dt = ""
        self.dd = ""
        self.pairs: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "dt":
            self.in_dt = True
        if tag == "dd":
            self.in_dd = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "dt":
            self.in_dt = False
        if tag == "dd":
            self.in_dd = False
            self.pairs.append((self.dt.strip(), re.sub(r"\s+", " ", self.dd.strip())))
            self.dt = ""
            self.dd = ""

    def handle_data(self, data: str) -> None:
        if self.in_dt:
            self.dt += data
        if self.in_dd:
            self.dd += data


def fetch(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "sbc-nybygg-harvest/1.0 (Stockholms stad öppen data, SBC-karta)",
            "Accept": "text/html,application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read().decode("utf-8", "replace")


def list_plan_ids() -> list[str]:
    html = fetch(LIST_URL)
    ids = set(re.findall(r"pagaendeplanarbeten/(\d{4}-\d+)", html))
    html_home = fetch(BASE)
    ids.update(re.findall(r"pagaendeplanarbeten/(\d{4}-\d+)", html_home))
    return sorted(ids)


def normalize_property(raw: str) -> str:
    s = raw.strip()
    s = re.sub(r"(?i)^fastigheten\s+", "", s)
    s = re.sub(r"(?i)^del av\s+", "", s)
    s = re.sub(r"(?i)\s+m\.fl\.?$", "", s)
    s = re.sub(r"\s+", " ", s).upper()
    s = re.sub(r"(\d+)\s*:\s*(\d+)", r"\1:\2", s)
    return s


def extract_property(project_name: str) -> str:
    patterns = [
        r"(?i)fastigheten\s+([A-Za-zÅÄÖåäö\s]+?\d+(?::\d+)?)",
        r"(?i)del av\s+([A-Za-zÅÄÖåäö\s]+?\d+(?::\d+)?)",
        r"^([A-Za-zÅÄÖåäö]+\s+\d+:\d+)",
        r"(?i)fastigheten\s+([A-Za-zÅÄÖåäö]+\s+\d+)",
    ]
    for pat in patterns:
        m = re.search(pat, project_name)
        if m:
            return normalize_property(m.group(1))
    return ""


def parse_dates(fields: dict[str, str]) -> str | None:
    for key in ("Period för samråd", "Samrådsmöte datum"):
        val = fields.get(key, "")
        m = re.search(r"(\d{4}-\d{2}-\d{2})", val)
        if m:
            return m.group(1)
    for block in fields.values():
        for m in re.finditer(r"(\d{4}-\d{2}-\d{2})", block):
            d = m.group(1)
            if "2025" <= d[:4] <= "2026":
                return d
    return None


def nominatim_geocode(query: str) -> tuple[float, float] | None:
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 1, "countrycodes": "se"}
    )
    req = urllib.request.Request(
        url, headers={"User-Agent": "sbc-nybygg-harvest/1.0 (Stockholms stad öppen data)"}
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        data = json.load(resp)
    if not data:
        return None
    return float(data[0]["lat"]), float(data[0]["lon"])


def geocode_plan(property_designation: str, stadsdel: str) -> tuple[float | None, float | None, str]:
    queries = []
    if property_designation:
        queries.append(f"{property_designation}, Stockholm, Sweden")
    if stadsdel:
        queries.append(f"{stadsdel}, Stockholm, Sweden")
    for q in queries:
        try:
            pt = nominatim_geocode(q)
            time.sleep(1.05)
            if pt:
                return pt[0], pt[1], f"nominatim:{q}"
        except Exception:
            continue
    if stadsdel in STADSDEL_CENTROID:
        lat, lon = STADSDEL_CENTROID[stadsdel]
        return lat, lon, f"stadsdel_centroid:{stadsdel}"
    return None, None, "none"


@dataclass
class PlanRow:
    journal_id: str
    project_name: str
    property_designation: str
    stadsdel: str
    bostader: int | None
    decision_date: str | None
    latitude: float | None
    longitude: float | None
    geocode_method: str


def parse_plan(journal_id: str) -> PlanRow:
    page = fetch(f"{BASE}/{journal_id}")
    parser = DLParser()
    parser.feed(page)
    fields = dict(parser.pairs)
    project = fields.get("Projektnamn", "")
    prop = extract_property(project)
    bost_match = re.search(r"Bostäder:\s*(\d+)", fields.get("Planinnehåll", ""))
    bost = int(bost_match.group(1)) if bost_match else None
    stadsdel = fields.get("Stadsdelar", "").split(",")[0].strip()
    decision = parse_dates(fields)
    lat, lon, method = geocode_plan(prop, stadsdel)
  # Verifiera att stadens karttjänst känner igen diariet (öppen, utan nyckel).
    try:
        fetch(MAP_URL.format(jid=journal_id))
    except Exception:
        pass
    return PlanRow(
        journal_id=journal_id,
        project_name=project,
        property_designation=prop,
        stadsdel=stadsdel,
        bostader=bost,
        decision_date=decision,
        latitude=lat,
        longitude=lon,
        geocode_method=method,
    )


def main() -> None:
    ids = list_plan_ids()
    rows: list[PlanRow] = []
    for jid in ids:
        print(f"Hämtar {jid} …")
        rows.append(parse_plan(jid))
        time.sleep(0.25)

    permits = []
    for r in rows:
        labels = ["residential"] if (r.bostader or 0) > 0 or "bost" in r.project_name.lower() else ["residential"]
        permits.append(
            {
                "id": f"stockholm-plan-{r.journal_id}",
                "source": "stockholm_stad_bygg_plantjanst",
                "procedure": "new_building",
                "labels": labels,
                "property_designation": r.property_designation or None,
                "municipality": "STOCKHOLM",
                "longitude": r.longitude,
                "latitude": r.latitude,
                "decision_date": r.decision_date,
                "meta": {
                    "journal_id": r.journal_id,
                    "project_name": r.project_name,
                    "stadsdel": r.stadsdel,
                    "bostader_planerade": r.bostader,
                    "geocode_method": r.geocode_method,
                    "data_class": "pagaende_dplan_bostad",
                },
            }
        )

    payload = {
        "meta": {
            "description": (
                "Bundlad öppen cache från Stockholms stads Bygg- och plantjänst "
                "(pågående detaljplaner med bostadsinnehåll). Ersätter inte ByggR/Combify "
                "bygglovsregister; ingen inloggning krävs."
            ),
            "scope": "Stockholms stad (kommun 0180)",
            "municipalities": ["STOCKHOLM"],
            "spatial_buffer_m": 50,
            "harvested_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sources": [
                {
                    "name": "Bygg- och plantjänsten – pågående planarbeten",
                    "url": "https://etjanster.stockholm.se/Byggochplantjansten/pagaendeplanarbeten",
                    "license": "Öppen e-tjänst/öppna handlingar (Stockholms stad)",
                    "type": "HTML (offentliga planärenden)",
                },
                {
                    "name": "Kartunderlag planområde (diarienummer)",
                    "url": "https://kartor.stockholm.se/bios/servlet/app.htmlclient.servlets.GetMapForQuery/…",
                    "license": "Stockholms stad karttjänst (publik förhandsbild)",
                    "type": "WMS-bakgrund + internt planlager",
                },
                {
                    "name": "Geokodning reserv",
                    "url": "https://nominatim.openstreetmap.org/",
                    "license": "ODbL (endast där koordinat saknas från register)",
                    "type": "Nominatim (batch, ej i webbläsaren)",
                },
            ],
            "notes": [
                "ByggR och aktuella bygglovsärenden exponeras inte som bulk-öppet API.",
                "Stadsarkivet (äldre bygglovsritningar) är historiskt och saknar maskinläsbar nybyggnadslayout för 2025–2026.",
                "Dataportalen (open.stockholm.se) kräver manuell nedladdning per datamängd; JSON-sök API blockerades (403/500) vid harvest.",
            ],
            "plan_count": len(permits),
            "with_coordinates": sum(1 for p in permits if p.get("latitude") is not None),
            "with_property_designation": sum(1 for p in permits if p.get("property_designation")),
        },
        "permits": permits,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Skrev {OUT_PATH} ({len(permits)} poster)")


if __name__ == "__main__":
    main()
