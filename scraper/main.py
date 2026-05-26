#!/usr/bin/env python3
"""
Entry point for Render.com deployment.
Runs the scraper once immediately, then on schedule (daily at 08:00 CET).
"""
import schedule
import time
import logging
from scraper import run_scrape

log = logging.getLogger(__name__)

def job():
    log.info("Starting scheduled scrape...")
    try:
        run_scrape()
    except Exception as e:
        log.error(f"Scheduled scrape failed: {e}")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    log.info("Wine tracker starting — running initial scrape...")
    job()  # Run immediately on startup

    # Schedule daily at 08:00 UTC (10:00 CET)
    schedule.every().day.at("08:00").do(job)
    log.info("Scheduled daily scrape at 08:00 UTC. Waiting...")

    while True:
        schedule.run_pending()
        time.sleep(60)
