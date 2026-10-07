# Leeslijst × Bibliotheek Westervoort

Mijn Goodreads to-read-lijst naast de collectie van Bibliotheek Liemers, met de nadruk op vestiging Westervoort.
Alleen Nederlandstalige edities tellen mee; vertalingen van Engelse (of andere) boeken worden herkend.

**Site:** https://sjoerdjebis.github.io/leeslijst/

## Hoe het werkt

- `docs/` is de website (GitHub Pages), `docs/data/boeken.json` de data.
- `scripts/update.py` zoekt elk boek op in de catalogus van Bibliotheek Liemers (Iguana op sambis.nl):
  eerst op ISBN, dan op titel en auteur, en zo nodig via de Nederlandse edities die Goodreads van het werk kent.
- Een GitHub Action (`vernieuw.yml`) draait dit elke nacht en via de knop op de site.
- Gaat een boek van "niet in collectie" naar gevonden, dan krijgt het 30 dagen het label *nieuw in collectie*.

## Bijwerken

Nieuwe Goodreads-export (My Books → Import and export → Export library):

```bash
python3 scripts/update.py export ~/Downloads/goodreads_library_export.csv
git add docs/data && git commit -m "Nieuwe Goodreads-export" && git push
```

Beschikbaarheid handmatig vernieuwen:

```bash
python3 scripts/update.py beschikbaarheid
```

## Vernieuwknop op de site

De knop start de Action via de GitHub API. Daarvoor bewaart je browser eenmalig een
fine-grained token met alleen **Actions: read and write** op deze repo (zie "GitHub koppelen" onderaan de site).
