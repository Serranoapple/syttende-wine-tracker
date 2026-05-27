#!/usr/bin/env python3
"""
Syttende Wine Tracker — Scraper
Fetches wine list PDFs from syttende.dk, parses them, detects changes,
looks up Wine-Searcher EU prices, and stores everything in Supabase.

Deploy on Render.com as a cron job or background worker.
"""

import os
import re
import io
import json
import time
import hashlib
import logging
import requests
import pdfplumber
from datetime import datetime, timezone
from typing import Optional
from supabase import create_client, Client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────
SUPABASE_URL  = os.environ["SUPABASE_URL"]
SUPABASE_KEY  = os.environ["SUPABASE_SERVICE_KEY"]   # service role key

PDF_URLS = {
    "white":     "https://cdn.prod.website-files.com/68e4e0d05e784db5b02931a0/698f5696d37acaa6f98eed15_db0c5c76c52868dc16dc5d110d8cf687_Vinkort%20HVIDVIN.pdf",
    "sparkling": "https://cdn.prod.website-files.com/68e4e0d05e784db5b02931a0/698f5696066729ad6f5d5bd4_77e5403ce19c0082f527b3a7ca1b86c7_Vinkort%20BOBLER%20%26%20S%C3%98DT.pdf",
    "red_rose":  "https://cdn.prod.website-files.com/68e4e0d05e784db5b02931a0/698f56967915ca645f55ab51_3d3d5376de879ad7ba5d8413cfe1f6d4_Vinkort%20ROS%C3%88%20%26%20R%C3%98DVIN.pdf",
    "avec":      "https://cdn.prod.website-files.com/68e4e0d05e784db5b02931a0/69bbf8cf10f6a1d7d706adbd_04ef0f7aac2b42b057991bb7a68656e3_Avec.pdf",
}

# Landing page to scrape live PDF URLs (fallback regex)
WINE_PAGE_URL = "https://www.syttende.dk/vinen"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; WineTracker/1.0)",
    "Referer": "https://www.syttende.dk/",
}

WINE_SEARCHER_SEARCH = "https://www.wine-searcher.com/find/{query}/1/denmark"


# ─────────────────────────────────────────────
# PDF fetching
# ─────────────────────────────────────────────

def fetch_live_pdf_urls() -> dict[str, str]:
    """Scrape the wine page to detect if PDF URLs have changed."""
    try:
        r = requests.get(WINE_PAGE_URL, headers=HEADERS, timeout=20)
        r.raise_for_status()
        text = r.text
        urls = {}
        patterns = {
            "white":     r'href="([^"]+Vinkort[^"]*HVIDVIN[^"]*\.pdf)"',
            "sparkling": r'href="([^"]+Vinkort[^"]*BOBLER[^"]*\.pdf)"',
            "red_rose":  r'href="([^"]+Vinkort[^"]*ROS[^"]*\.pdf)"',
            "avec":      r'href="([^"]+Avec[^"]*\.pdf)"',
        }
        for key, pat in patterns.items():
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                urls[key] = m.group(1)
                log.info(f"Found live URL for {key}: {urls[key]}")
            else:
                urls[key] = PDF_URLS[key]   # fall back to hardcoded
        return urls
    except Exception as e:
        log.warning(f"Could not fetch live PDF URLs: {e}. Using hardcoded.")
        return PDF_URLS.copy()


def download_pdf(url: str) -> bytes:
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    if b"%PDF" not in r.content[:10] and b"PDF" not in r.content[:10]:
        # Try without referer
        r = requests.get(url, timeout=30)
        r.raise_for_status()
    return r.content


# ─────────────────────────────────────────────
# PDF parsing
# ─────────────────────────────────────────────

# Matches all wine line formats from syttende.dk PDFs:
#   2022 RIESLING FASS 3 KABINETT Julian Haart 570    (with vintage)
#   NV GRANDE CUVEE Krug 3250                          (Non-Vintage)
#   PROSECCO SPUMANTE, EXTRA DRY Bianca Vigna 425      (no vintage)
#
# Two-pass: WINE_LINE_RE extracts structure; split_name_producer()
# splits middle chunk at first word containing a lowercase letter.
WINE_LINE_RE = re.compile(
    r"^(?:(\d{4}|NV)\s+)?"  r"(.+?)\s+"  r"(?:(\d+(?:[,\.]\d+)?)\s+)?"  r"(\d{3,5})$"
)


# Section headers we track for category/region
CATEGORY_KEYWORDS = {
    # Multi-word and specific matches first
    "WHITE WINE": "white",
    "RED WINE": "red",
    "SPARKLING WINE": "sparkling",
    "DESSERT WINE": "dessert",
    "WINE BY THE GLASS": "white",  # default; subcategory logic refines further
    # Danish
    "HVIDVIN": "white",
    "ROSÉ & RØDVIN": "rose",     # full header string — most specific, checked first
    "ROSÉ": "rose",
    "RØDVIN": "red",
    "MOUSSERENDE": "sparkling",
    "SPARKLING": "sparkling",
    "CHAMPAGNE": "sparkling",
    "DESSERT": "dessert",
    "AVEC": "avec",
}

# Maps country-level keywords to (country, region="")
COUNTRY_KEYWORDS = {
    "FRANCE": "France", "GERMANY": "Germany", "AUSTRIA": "Austria",
    "ITALY": "Italy", "SPAIN": "Spain", "PORTUGAL": "Portugal",
    "USA": "USA", "AUSTRALIA": "Australia", "NEW ZEALAND": "New Zealand",
    "SOUTH AFRICA": "South Africa", "ARGENTINA": "Argentina", "HUNGARY": "Hungary",
    "DENMARK": "Denmark",
}

# Maps region-level keywords to (country, region) — country is set alongside region
# so a German sub-region correctly overrides a previously-set French country.
REGION_TO_COUNTRY = {
    # France
    "ALSACE": ("France", "Alsace"),
    "BURGUNDY": ("France", "Burgundy"),
    "BOURGOGNE": ("France", "Burgundy"),
    "BORDEAUX": ("France", "Bordeaux"),
    "LOIRE": ("France", "Loire"),
    "RHONE": ("France", "Rhône"),
    "CHAMPAGNE REGION": ("France", "Champagne"),   # avoid collision with category keyword
    "CHABLIS": ("France", "Chablis"),
    "MEURSAULT": ("France", "Meursault"),
    "PULIGNY": ("France", "Puligny-Montrachet"),
    "CHASSAGNE": ("France", "Chassagne-Montrachet"),
    # Germany
    "SEKT": ("Germany", ""),        # "GERMANY - SEKT" header safeguard
    "MOSEL": ("Germany", "Mosel"),
    "PFALZ": ("Germany", "Pfalz"),
    "NAHE": ("Germany", "Nahe"),
    "RHEINGAU": ("Germany", "Rheingau"),
    "RHEINHESSEN": ("Germany", "Rheinhessen"),
    "SAAR": ("Germany", "Saar"),
    "RUWER": ("Germany", "Ruwer"),
    # Austria
    "WACHAU": ("Austria", "Wachau"),
    "KAMPTAL": ("Austria", "Kamptal"),
    "KREMSTAL": ("Austria", "Kremstal"),
    # Italy
    "TUSCANY": ("Italy", "Tuscany"),
    "TOSCANA": ("Italy", "Tuscany"),
    "PIEDMONT": ("Italy", "Piedmont"),
    "PIEMONTE": ("Italy", "Piedmont"),
    "VENETO": ("Italy", "Veneto"),
    "FRIULI": ("Italy", "Friuli"),
    # Spain
    "RIOJA": ("Spain", "Rioja"),
    "RIBERA": ("Spain", "Ribera del Duero"),
    "PRIORAT": ("Spain", "Priorat"),
    "PENEDES": ("Spain", "Penedès"),
}

# All keywords to scan for (order doesn't matter — handled by dicts above)
REGION_KEYWORDS = list(COUNTRY_KEYWORDS.keys()) + list(REGION_TO_COUNTRY.keys())

SUBCATEGORY_KEYWORDS = {
    "WINE BY THE GLASS": "by_the_glass",
    "CORAVIN": "coravin",
    "WINE PAIRING": "pairing",
    "VINMENU": "pairing",
}


def parse_pdf(pdf_bytes: bytes, category_hint: str) -> list[dict]:
    """
    Parse a wine list PDF and return a list of wine dicts:
    {vintage, name, producer, volume_cl, price_dkk, category, region, country}
    """
    wines = []
    current_category = category_hint
    current_region = ""
    current_country = ""
    current_subcategory = ""
    seen_keys = set()
    # For avec PDFs, category keywords inside the file (e.g. "CHAMPAGNE" as a
    # cognac sub-region, "SPARKLING" in product names) must not override the hint.
    lock_category = (category_hint == "avec")

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text(layout=False) or ""
            lines = text.split("\n")

            for raw_line in lines:
                line = raw_line.strip()
                if not line:
                    continue

                upper = line.upper()

                # Detect category
                # Guard: skip if category is locked (avec PDF) or line is a wine entry.
                _is_wine_entry = bool(re.search(r'\d{3,5}$', line))
                if not _is_wine_entry and not lock_category:
                    for kw, cat in CATEGORY_KEYWORDS.items():
                        if kw in upper and len(line) < 50:
                            current_category = cat
                            break

                # Detect subcategory
                for kw, sub in SUBCATEGORY_KEYWORDS.items():
                    if kw in upper and len(line) < 50:
                        current_subcategory = sub
                        break

                # Detect region/country
                # Scan all non-wine-entry lines (headers never end with a price).
                # No length limit — "SPARKLING WINE GERMANY - SEKT" must match.
                _is_wine_entry = bool(re.search(r'\d{3,5}$', line))
                if not _is_wine_entry:
                    for kw in REGION_KEYWORDS:
                        if kw in upper:
                            if kw in COUNTRY_KEYWORDS:
                                current_country = COUNTRY_KEYWORDS[kw]
                                current_region  = ""
                            elif kw in REGION_TO_COUNTRY:
                                current_country, current_region = REGION_TO_COUNTRY[kw]
                            break

                # Try to match a wine entry
                m = WINE_LINE_RE.match(line)
                if m:
                    v_str     = m.group(1)   # "2022", "NV", or None
                    middle    = m.group(2)
                    vol_str   = m.group(3)
                    price_dkk = int(m.group(4))

                    # Parse vintage
                    if v_str is None or v_str == "NV":
                        vintage = None
                    else:
                        vintage = int(v_str)

                    # Pass 2: split ALL-CAPS name from Title-Case producer
                    name_raw, producer = split_name_producer(middle)
                    name = clean_wine_name(name_raw)

                    # Skip if we couldn't extract a producer (likely a header line)
                    if not producer:
                        continue

                    volume_cl = 75
                    if vol_str:
                        try:
                            volume_cl = int(float(vol_str.replace(",", ".")))
                        except ValueError:
                            pass

                    # Deduplicate within this PDF parse
                    key = f"{vintage}|{name}|{producer}|{volume_cl}"
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    # Per-wine country override: some entries embed "REGION, COUNTRY"
                    # e.g. "2024 RIESLING - NAHE, GERMANY Schäfer-Fröhlich 160"
                    wine_country = current_country
                    wine_region  = current_region
                    inline = re.search(
                        r'-\s*([\w\s]+),\s*(GERMANY|FRANCE|AUSTRIA|ITALY|SPAIN|PORTUGAL|USA|HUNGARY|AUSTRALIA|DENMARK)\b',
                        line.upper()
                    )
                    if inline:
                        wine_region  = inline.group(1).title().strip()
                        wine_country = inline.group(2).title()

                    wines.append({
                        "vintage":      vintage,
                        "name":         name,
                        "producer":     producer,
                        "volume_cl":    volume_cl,
                        "price_dkk":    price_dkk,
                        "category":     current_category,
                        "subcategory":  current_subcategory,
                        "region":       wine_region,
                        "country":      wine_country,
                    })

    log.info(f"Parsed {len(wines)} wines from PDF (category={category_hint})")
    return wines


def split_name_producer(middle: str) -> tuple[str, str]:
    """
    Split "WINE NAME Producer Name" into (name, producer).
    Wine names are ALL CAPS (digits, commas, hyphens allowed).
    Producers start with a Capital letter followed by lowercase letters.
    Splits at the first word that contains a lowercase letter.
    """
    words = middle.split()
    split_idx = None
    for i, word in enumerate(words):
        if i > 0 and re.search(r'[a-zàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþ]', word):
            split_idx = i
            break

    if split_idx is None or split_idx == 0:
        return middle.strip(), ""

    name     = " ".join(words[:split_idx]).strip().replace(",", "").strip()
    producer = clean_producer(" ".join(words[split_idx:]))
    return name, producer


# Lowercase tokens that are legitimate parts of producer names — never stripped
_PRODUCER_PARTICLES = {"de", "et", "du", "di", "le", "la", "les", "van", "von", "of", "i"}

# Known PDF column-split word fragments: (last_word_lower, suffix) → rejoin
# When pdfplumber splits a word across a column, the suffix must be rejoined.
# Add entries here whenever a new split-word producer is discovered.
_REJOIN_SUFFIXES = {
    ("navera", "n"),    # Naveran (Bodegas Naveran)
}

_PRODUCER_NOISE_RE = re.compile(r'\s+([a-z]{1,2})$')

def clean_producer(producer: str) -> str:
    """
    Fix PDF column-break artefacts in producer names.
    pdfplumber sometimes appends a stray 1-2 char lowercase token from the
    next column when text reflows — e.g. "Bodegas Navera n" or "Pol Roger n".

    If the (previous_word, token) pair is in _REJOIN_SUFFIXES, the token is
    a genuine word-fragment and is rejoined: "Navera" + "n" → "Naveran".
    Otherwise the token is noise and is stripped: "Roger" + "n" → "Roger".
    Legitimate name particles (de, et, du, …) are always kept as-is.
    """
    producer = re.sub(r"\s+", " ", producer).strip()
    m = _PRODUCER_NOISE_RE.search(producer)
    if m:
        token = m.group(1)
        if token not in _PRODUCER_PARTICLES:
            before     = producer[:m.start()]
            last_word  = before.split()[-1].lower() if before.split() else ""
            if (last_word, token) in _REJOIN_SUFFIXES:
                producer = before + token          # rejoin: "Navera" + "n"
            else:
                producer = before.strip()          # drop artefact
    return producer


def clean_wine_name(name: str) -> str:
    """Normalise whitespace and strip punctuation artefacts from wine name."""
    if name in ("CL KR", "KR", "CL"):
        return ""
    name = re.sub(r"\s+", " ", name).strip()
    name = name.replace(",", "").strip()
    return name


def wine_searcher_query(wine: dict) -> Optional[float]:
    """
    Returns lowest EU price in EUR from Wine-Searcher, or None.
    Uses a simple web scrape — Wine-Searcher doesn't have a free API.
    """
    query_parts = [wine["producer"], wine["name"], str(wine["vintage"]) if wine["vintage"] else "NV"]
    query = "+".join(p.replace(" ", "+") for p in query_parts if p)
    url = f"https://www.wine-searcher.com/find/{query}/1/europe"

    try:
        r = requests.get(url, headers={
            **HEADERS,
            "Accept": "text/html",
            "Accept-Language": "en-US,en;q=0.9",
        }, timeout=20)
        if r.status_code != 200:
            return None

        # Extract lowest price from page
        # Wine-Searcher shows prices in pattern like "€ 45.00" or "EUR 45"
        prices = re.findall(r"€\s*(\d+(?:[.,]\d+)?)", r.text)
        if not prices:
            prices = re.findall(r"EUR\s*(\d+(?:[.,]\d+)?)", r.text)
        if prices:
            floats = []
            for p in prices[:10]:
                try:
                    floats.append(float(p.replace(",", ".")))
                except ValueError:
                    pass
            if floats:
                lowest = min(f for f in floats if f > 5)  # exclude obviously wrong
                return round(lowest, 2)
    except Exception as e:
        log.debug(f"Wine-Searcher error for {wine['name']}: {e}")

    return None


def build_wine_searcher_url(wine: dict) -> str:
    query_parts = [wine["producer"], wine["name"], str(wine["vintage"]) if wine["vintage"] else "NV"]
    query = "+".join(p.replace(" ", "+") for p in query_parts if p)
    return f"https://www.wine-searcher.com/find/{query}/1/europe"


# ─────────────────────────────────────────────
# Supabase helpers
# ─────────────────────────────────────────────

def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def upsert_wine(sb: Client, wine: dict) -> tuple[str, bool]:
    """
    Insert or find a wine. Returns (wine_id, is_new).
    NV wines have vintage=None — PostgREST requires .is_() for NULL comparisons,
    not .eq() which serialises Python None as the string "None".
    """
    is_nv = wine["vintage"] is None

    q = (
        sb.table("wines")
        .select("id")
        .eq("name", wine["name"])
        .eq("producer", wine["producer"])
        .eq("volume_cl", wine["volume_cl"])
    )
    if is_nv:
        q = q.is_("vintage", "null")
    else:
        q = q.eq("vintage", wine["vintage"])

    existing = q.execute()

    if existing.data:
        return existing.data[0]["id"], False

    result = (
        sb.table("wines")
        .insert({
            "name":        wine["name"],
            "producer":    wine["producer"],
            "vintage":     wine["vintage"],   # Python None → SQL NULL
            "is_nv":       is_nv,
            "region":      wine["region"],
            "country":     wine["country"],
            "category":    wine["category"],
            "subcategory": wine["subcategory"],
            "volume_cl":   wine["volume_cl"],
        })
        .execute()
    )
    return result.data[0]["id"], True


def get_latest_price(sb: Client, wine_id: str) -> Optional[int]:
    result = (
        sb.table("wine_prices")
        .select("price_dkk")
        .eq("wine_id", wine_id)
        .order("observed_at", desc=True)
        .limit(1)
        .execute()
    )
    if result.data:
        return result.data[0]["price_dkk"]
    return None


def insert_price(sb: Client, wine_id: str, price: int, source_pdf: str):
    sb.table("wine_prices").insert({
        "wine_id":    wine_id,
        "price_dkk":  price,
        "source_pdf": source_pdf,
    }).execute()


def log_change(sb: Client, run_id: str, wine_id: str,
               change_type: str, old_val: str, new_val: str, description: str):
    sb.table("change_log").insert({
        "run_id":      run_id,
        "wine_id":     wine_id,
        "change_type": change_type,
        "old_value":   old_val,
        "new_value":   new_val,
        "description": description,
    }).execute()


# ─────────────────────────────────────────────
# Main scrape logic
# ─────────────────────────────────────────────

def run_scrape():
    sb = get_supabase()

    # Start scrape run
    run = sb.table("scrape_runs").insert({
        "status":   "running",
        "pdf_urls": json.dumps(PDF_URLS),
    }).execute()
    run_id = run.data[0]["id"]
    log.info(f"Started scrape run {run_id}")

    total = added = removed = price_changes = 0
    all_seen_wine_ids = set()

    try:
        live_urls = fetch_live_pdf_urls()

        for category, url in live_urls.items():
            log.info(f"Downloading PDF: {category}")
            try:
                pdf_bytes = download_pdf(url)
            except Exception as e:
                log.error(f"Failed to download {category}: {e}")
                continue

            wines = parse_pdf(pdf_bytes, category)

            for wine in wines:
                if not wine["name"] or not wine["producer"]:
                    continue

                total += 1
                wine_id, is_new = upsert_wine(sb, wine)
                all_seen_wine_ids.add(wine_id)

                if is_new:
                    added += 1
                    insert_price(sb, wine_id, wine["price_dkk"], category)
                    desc = (f"Ny vin tilføjet: {wine['vintage'] or 'NV'} {wine['name']} "
                            f"— {wine['producer']} ({wine['price_dkk']} DKK)")
                    log_change(sb, run_id, wine_id, "added", None,
                               str(wine["price_dkk"]), desc)
                    log.info(f"NEW: {desc}")

                    # Wine-Searcher lookup for new wines (rate-limited)
                    time.sleep(2)
                    ws_price = wine_searcher_query(wine)
                    if ws_price:
                        sb.table("wines").update({
                            "ws_price_eur":  ws_price,
                            "ws_url":        build_wine_searcher_url(wine),
                            "ws_checked_at": datetime.now(timezone.utc).isoformat(),
                        }).eq("id", wine_id).execute()
                        log.info(f"Wine-Searcher: {wine['name']} → €{ws_price}")

                else:
                    # Check for price change
                    old_price = get_latest_price(sb, wine_id)
                    if old_price is not None and old_price != wine["price_dkk"]:
                        price_changes += 1
                        insert_price(sb, wine_id, wine["price_dkk"], category)
                        direction = "price_up" if wine["price_dkk"] > old_price else "price_down"
                        arrow = "↑" if direction == "price_up" else "↓"
                        desc = (f"{wine['vintage'] or 'NV'} {wine['name']} ({wine['producer']}) "
                                f"{arrow} {old_price} → {wine['price_dkk']} DKK")
                        log_change(sb, run_id, wine_id, direction,
                                   str(old_price), str(wine["price_dkk"]), desc)
                        log.info(f"PRICE CHANGE: {desc}")
                    elif old_price is None:
                        insert_price(sb, wine_id, wine["price_dkk"], category)

        # Detect removed wines: wines that were in last run but not this one
        # (only flag if they haven't been seen in 2+ runs to avoid false positives)
        last_run = (
            sb.table("scrape_runs")
            .select("id")
            .eq("status", "success")
            .order("finished_at", desc=True)
            .limit(1)
            .execute()
        )
        if last_run.data:
            prev_run_id = last_run.data[0]["id"]
            prev_wines = (
                sb.table("change_log")
                .select("wine_id")
                .eq("run_id", prev_run_id)
                .execute()
            )
            prev_ids = {r["wine_id"] for r in prev_wines.data}
            newly_missing = prev_ids - all_seen_wine_ids
            for wine_id in newly_missing:
                wine_info = sb.table("wines").select("name,producer,vintage").eq("id", wine_id).execute()
                if wine_info.data:
                    w = wine_info.data[0]
                    desc = f"Vin fjernet fra kortet: {w['vintage'] or 'NV'} {w['name']} — {w['producer']}"
                    log_change(sb, run_id, wine_id, "removed", None, None, desc)
                    removed += 1
                    log.info(f"REMOVED: {desc}")

        # Finalize run
        sb.table("scrape_runs").update({
            "status":        "success",
            "finished_at":   datetime.now(timezone.utc).isoformat(),
            "wines_total":   total,
            "wines_added":   added,
            "wines_removed": removed,
            "price_changes": price_changes,
        }).eq("id", run_id).execute()

        log.info(f"Scrape complete: {total} wines, +{added} new, -{removed} removed, {price_changes} price changes")

    except Exception as e:
        log.error(f"Scrape failed: {e}", exc_info=True)
        sb.table("scrape_runs").update({
            "status":      "error",
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "error_msg":   str(e),
        }).eq("id", run_id).execute()
        raise


if __name__ == "__main__":
    run_scrape()
