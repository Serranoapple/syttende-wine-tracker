# Syttende Wine Tracker

Automatisk overvågning af [Restaurant 17.](https://www.syttende.dk/vinen)s vinkort i Sønderborg.

## Hvad systemet gør

- Henter vinkortet dagligt (4 PDF-filer) og parser alle vine
- Gemmer vine, priser og ændringer i Supabase
- Detekterer nye vine, fjernede vine og prisændringer
- Slår Wine-Searcher EU-priser op på nye vine
- Viser alt i et dashboard på render.com

## Struktur

```
.github/workflows/scrape.yml   ← GitHub Actions: daglig scrape kl. 10:00
scraper/
  scraper.py                   ← Parser PDF-vinkort og gemmer i database
  main.py                      ← Scheduler til Render Worker (alternativ)
  requirements.txt
frontend/
  src/pages/
    Dashboard.js               ← Forside med stats og seneste ændringer
    WineList.js                 ← Søgbar/filtrerbar vinliste
    WineDetail.js               ← Vin-side med prishistorik-graf
    ChangeLog.js                ← Fuld historik grupperet per dato
    Watchlist.js                ← Personlig watchlist
    AIInsights.js               ← AI-analyse af vinkortet
supabase_schema.sql             ← Kør i Supabase SQL Editor ved opstart
render.yaml                     ← Render.com deployment config
```

## Installation

Se `docs/INSTALLATION.md` for komplet trin-for-trin guide.

### Kort version

1. Kør `supabase_schema.sql` i Supabase SQL Editor
2. Sæt GitHub Secrets: `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
3. Deploy frontend på Render.com (Static Site) med env vars
4. GitHub Actions kører scraperen dagligt automatisk

## Environment variables

| Variable | Bruges af | Beskrivelse |
|----------|-----------|-------------|
| `SUPABASE_URL` | Scraper + GitHub Actions | Supabase projekt-URL |
| `SUPABASE_SERVICE_KEY` | Scraper + GitHub Actions | Service role nøgle (hemmelig) |
| `REACT_APP_SUPABASE_URL` | Frontend | Supabase projekt-URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Frontend | Anon/public nøgle |
| `REACT_APP_ANTHROPIC_API_KEY` | Frontend (valgfri) | Til AI-analyse siden |
