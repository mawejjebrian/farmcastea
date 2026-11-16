# FARMCAST EA Regional Foundation

This is the first regional platform foundation, kept separate from the original Wakiso prototype.

## Included in this release
- Regional country selector covering 12 countries (coverage framework only; not a claim of operational deployments).
- User-entered locality and coordinates, with approximate country-centre defaults.
- Live current weather retrieval from Open-Meteo when the network and service are available.
- Transparent rule-based weather prompts, not AI-generated agronomy or official warnings.
- Local field observations stored in the browser only, with explicit consent and JSON export.
- Installable PWA manifest and a small offline application shell.

## Not yet connected
- Supabase authentication, central database, server-side access policies and backups.
- WhatsApp Business Cloud API or SMS provider.
- Gemini AI assistant or image-based pest/disease analysis.
- Verified administrative boundary datasets, crop calendars, local-language translations, national extension sources or official alert feeds.

Do not enter sensitive personal information in this prototype. Local notes remain in the current browser/device and are not synced. The 12-country list is a planning framework; country availability and local services require validation before public launch.

## Test
Open /regional/, select a country, enter a known town and coordinates, then choose Get local weather. Save a field note only after checking the local-storage consent box. Export notes to keep a copy.
