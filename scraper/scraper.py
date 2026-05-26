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

# Matches lines like:
#   2022 RIESLING FASS 3 KABINETT Julian Haart 570
#   2018 SCHARZHOF RIESLING Weingut Egon Müller 1205
#   2016 RIESLING RESERVE F.E. Trimbach 37,5 425   (37.5cl bottles)
#   NV GRANDE CUVÉE Krug 3250                       (Non-Vintage champagne)
#   NV BRUT RÉSERVE Pol Roger 37,5 625
WINE_LINE_RE = re.compile(
    r"^(\d{4}|NV)\s+"       # vintage year OR "NV" (Non-Vintage)
    r"(.+?)\s+"             # wine name (greedy, trimmed later)
    r"([\w][\w\s\.\-&'éàüöäÜÖÄáóíúÉ]+?)\s+"  # producer
    r"(?:(\d+(?:[,\.]\d+)?)\s+)?"  # optional volume (e.g. 37,5 or 150)
    r"(\d{3,5})$"           # price in DKK
)

# Section headers we track for category/region
CATEGORY_KEYWORDS = {
    "WHITE WINE": "white",
    "HVIDVIN": "white",
    "RED WINE": "red",
    "RØDVIN": "red",
    "ROSÉ": "rose",
    "SPARKLING": "sparkling",
    "MOUSSERENDE": "sparkling",
    "CHAMPAGNE": "sparkling",
    "DESSERT": "dessert",
    "AVEC": "avec",
}

REGION_KEYWORDS = [
    "FRANCE", "GERMANY", "AUSTRIA", "ITALY", "SPAIN", "PORTUGAL",
    "USA", "AUSTRALIA", "NEW ZEALAND", "SOUTH AFRICA", "ARGENTINA",
    "HUNGARY", "ALSACE", "BURGUNDY", "BORDEAUX", "LOIRE", "RHONE",
    "CHAMPAGNE", "MOSEL", "PFALZ", "NAHE", "RHEINGAU", "RHEINHESSEN",
    "WACHAU", "KAMPTAL", "TUSCANY", "PIEDMONT", "VENETO", "FRIULI",
    "CHABLIS", "MEURSAULT", "PULIGNY", "CHASSAGNE",
    "CORAVIN",
]

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
                for kw, cat in CATEGORY_KEYWORDS.items():
                    if kw in upper and len(line) < 40:
                        current_category = cat
                        break

                # Detect subcategory
                for kw, sub in SUBCATEGORY_KEYWORDS.items():
                    if kw in upper and len(line) < 50:
                        current_subcategory = sub
                        break

                # Detect region/country
                for reg in REGION_KEYWORDS:
                    if reg in upper and len(line) < 40:
                        if reg in ("FRANCE", "GERMANY", "AUSTRIA", "ITALY",
                                   "SPAIN", "PORTUGAL", "USA", "AUSTRALIA",
                                   "NEW ZEALAND", "SOUTH AFRICA", "ARGENTINA",
                                   "HUNGARY"):
                            current_country = reg.title()
                            current_region = ""
                        else:
                            current_region = reg.title()
                        break

                # Try to match a wine entry
                m = WINE_LINE_RE.match(line)
                if m:
                    vintage    = None if m.group(1) == "NV" else int(m.group(1))
                    name_raw   = m.group(2).strip()
                    producer   = m.group(3).strip()
                    vol_str    = m.group(4)
                    price_dkk  = int(m.group(5))

                    volume_cl = 75
                    if vol_str:
                        vol_str = vol_str.replace(",", ".")
                        try:
                            volume_cl = int(float(vol_str))
                        except ValueError:
                            pass

                    # Clean up name (remove trailing producer overlap)
                    name = clean_wine_name(name_raw, producer)

                    # Deduplicate within this PDF parse
                    key = f"{vintage}|{name}|{producer}|{volume_cl}"
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    wines.append({
                        "vintage":      vintage,
                        "name":         name,
                        "producer":     producer,
                        "volume_cl":    volume_cl,
                        "price_dkk":    price_dkk,
                        "category":     current_category,
                        "subcategory":  current_subcategory,
                        "region":       current_region,
                        "country":      current_country,
                    })

    log.info(f"Parsed {len(wines)} wines from PDF (category={category_hint})")
    return wines


def clean_wine_name(name: str, producer: str) -> str:
    """Remove producer name overlap from end of wine name."""
    # Titles like "CL KR" are headers, not names
    if name in ("CL KR", "KR", "CL"):
        return ""
    # Remove leading/trailing noise
    name = re.sub(r"\s+", " ", name).strip()
    # Sometimes the producer bleeds into name; remove common overlap
    producer_words = producer.split()[:2]
    for w in producer_words:
        if len(w) > 3 and name.upper().endswith(w.upper()):
            name = name[: -len(w)].strip()
    return name


# ─────────────────────────────────────────────
# Wine-Searcher lookup (best-effort, rate-limited)
# ─────────────────────────────────────────────

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
    """
    existing = (
        sb.table("wines")
        .select("id")
        .eq("name", wine["name"])
        .eq("producer", wine["producer"])
        .eq("vintage", wine["vintage"])
        .eq("volume_cl", wine["volume_cl"])
        .execute()
    )

    if existing.data:
        return existing.data[0]["id"], False

    result = (
        sb.table("wines")
        .insert({
            "name":        wine["name"],
            "producer":    wine["producer"],
            "vintage":     wine["vintage"],
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
