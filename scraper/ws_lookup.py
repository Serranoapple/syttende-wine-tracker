#!/usr/bin/env python3
"""
Wine-Searcher EU price lookup for wines in the database.
Runs as a separate job — not part of the daily scrape.

Usage:
    python ws_lookup.py                    # all wines missing ws_price_eur
    python ws_lookup.py --category sparkling  # only sparkling wines
    python ws_lookup.py --limit 20         # max N wines per run
    python ws_lookup.py --refresh-days 30  # re-check prices older than 30 days

Rate limiting: 8 seconds between requests to avoid blocks.
Wine-Searcher's free tier allows ~100 calls/day, so run with --limit 80
to stay within that if you have a key. Without a key, web scraping is used.

GitHub Actions: schedule this separately from the main scrape,
e.g. every Sunday at 09:00 UTC.
"""

import os, re, time, json, logging, argparse
import requests
from supabase import create_client
from datetime import datetime, timezone, timedelta
from urllib.parse import quote_plus

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# Wine-Searcher API key (optional — get a trial at wine-searcher.com/trade/api)
# If not set, falls back to web scraping (slower, less reliable)
WS_API_KEY = os.environ.get("WINE_SEARCHER_API_KEY", "")

RATE_LIMIT_SECONDS = 8   # between requests
EUR_TO_DKK = 7.46

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


# ─── Wine-Searcher lookup ──────────────────────────────────────────────────────

def build_query(wine: dict) -> str:
    """Build a Wine-Searcher search query from wine dict."""
    parts = []
    if wine.get("producer"):
        parts.append(wine["producer"])
    if wine.get("name"):
        parts.append(wine["name"])
    return " ".join(parts)


def lookup_via_api(query: str, vintage: int | None) -> dict | None:
    """
    Use the official Wine-Searcher Wine Check API.
    Returns dict with keys: price_eur, score, url — or None on failure.
    Requires WS_API_KEY env var.
    """
    vintage_str = str(vintage) if vintage else "NV"
    url = (
        f"https://www.wine-searcher.com/api/v1/wine_check"
        f"?api_key={WS_API_KEY}"
        f"&name={quote_plus(query)}"
        f"&vintage={vintage_str}"
        f"&location=europe"
        f"&format=json"
    )
    try:
        r = requests.get(url, timeout=20)
        if r.status_code != 200:
            log.warning(f"API returned {r.status_code} for {query!r}")
            return None
        data = r.json()
        price = data.get("min_price") or data.get("avg_price")
        if price:
            return {
                "price_eur": round(float(price), 2),
                "score":     data.get("score"),
                "url":       f"https://www.wine-searcher.com/find/{quote_plus(query)}/{vintage_str}/europe",
            }
    except Exception as e:
        log.warning(f"API error for {query!r}: {e}")
    return None


def lookup_via_scrape(query: str, vintage: int | None) -> dict | None:
    """
    Scrape Wine-Searcher search results page for EU lowest price.
    Falls back when no API key is configured.
    """
    vintage_str = str(vintage) if vintage else "NV"
    search_q = quote_plus(f"{query} {vintage_str}".strip())
    url = f"https://www.wine-searcher.com/find/{search_q}/1/europe"

    try:
        r = requests.get(url, headers=HEADERS, timeout=25, allow_redirects=True)
        if r.status_code != 200:
            log.debug(f"Scrape HTTP {r.status_code} for {query!r}")
            return None

        text = r.text

        # Extract lowest price — Wine-Searcher shows "€ 45.00" or "from €45"
        price_patterns = [
            r'(?:from\s+)?€\s*(\d+(?:[.,]\d+)?)',
            r'EUR\s*(\d+(?:[.,]\d+)?)',
            r'"min_price"\s*:\s*"(\d+(?:\.\d+)?)"',
            r'"price"\s*:\s*"(\d+(?:\.\d+)?)"',
        ]
        prices = []
        for pat in price_patterns:
            for m in re.finditer(pat, text):
                try:
                    val = float(m.group(1).replace(",", "."))
                    if 5 < val < 50000:  # sanity range
                        prices.append(val)
                except ValueError:
                    pass
            if prices:
                break

        if not prices:
            log.debug(f"No price found on page for {query!r}")
            return None

        lowest = min(prices)

        # Extract critic score if present
        score = None
        score_m = re.search(r'"score"\s*:\s*(\d+)', text)
        if score_m:
            score = int(score_m.group(1))

        return {
            "price_eur": round(lowest, 2),
            "score":     score,
            "url":       url,
        }

    except Exception as e:
        log.warning(f"Scrape error for {query!r}: {e}")
        return None


def lookup_wine(wine: dict) -> dict | None:
    """Try API first (if key available), then scraping."""
    query = build_query(wine)
    if not query.strip():
        return None

    log.info(f"Looking up: {query!r} ({wine.get('vintage') or 'NV'})")

    result = None
    if WS_API_KEY:
        result = lookup_via_api(query, wine.get("vintage"))

    if not result:
        result = lookup_via_scrape(query, wine.get("vintage"))

    if result:
        log.info(f"  → €{result['price_eur']}" +
                 (f" | score={result['score']}" if result.get("score") else "") +
                 (f" | ~{round(result['price_eur'] * EUR_TO_DKK)} DKK" if result.get("price_eur") else ""))
    else:
        log.info(f"  → not found")

    return result


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Wine-Searcher EU price lookup")
    parser.add_argument("--category", default="sparkling",
                        help="Category to look up (default: sparkling)")
    parser.add_argument("--limit", type=int, default=80,
                        help="Max wines to process per run (default: 80)")
    parser.add_argument("--refresh-days", type=int, default=30,
                        help="Re-check prices older than N days (default: 30)")
    parser.add_argument("--all-categories", action="store_true",
                        help="Process all categories, not just --category")
    args = parser.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Build query: wines missing ws_price_eur OR with stale prices
    stale_cutoff = (datetime.now(timezone.utc) - timedelta(days=args.refresh_days)).isoformat()

    q = sb.table("wines").select(
        "id, name, producer, vintage, category, ws_price_eur, ws_checked_at"
    )

    if not args.all_categories:
        q = q.eq("category", args.category)

    # Fetch wines that need lookup: never checked OR stale
    result = q.or_(
        f"ws_checked_at.is.null,ws_checked_at.lt.{stale_cutoff}"
    ).order("ws_checked_at", desc=False, nullsfirst=True).limit(args.limit).execute()

    wines = result.data or []
    log.info(f"Found {len(wines)} wines to look up "
             f"(category={'all' if args.all_categories else args.category}, limit={args.limit})")

    found = not_found = errors = 0

    for i, wine in enumerate(wines):
        try:
            result = lookup_wine(wine)

            now = datetime.now(timezone.utc).isoformat()
            update = {"ws_checked_at": now}

            if result:
                update["ws_price_eur"] = result["price_eur"]
                update["ws_url"] = result["url"]
                if result.get("score"):
                    update["ws_score"] = result["score"]
                found += 1
            else:
                # Mark as checked even if not found, to avoid re-checking every run
                not_found += 1

            sb.table("wines").update(update).eq("id", wine["id"]).execute()

        except Exception as e:
            log.error(f"Error processing {wine.get('name')!r}: {e}")
            errors += 1

        # Rate limit between requests
        if i < len(wines) - 1:
            time.sleep(RATE_LIMIT_SECONDS)

    log.info(f"Done: {found} found, {not_found} not found, {errors} errors")


if __name__ == "__main__":
    main()
