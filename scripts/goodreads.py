"""Nederlandse edities van een boek opzoeken via de edities-pagina van Goodreads."""
import html
import json
import re
import time
import urllib.request
from pathlib import Path

CACHE = Path(__file__).parent.parent / "docs/data/goodreads_cache.json"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130 Safari/537.36")


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for poging in range(3):
        try:
            return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
        except OSError:
            if poging == 2:
                raise
            time.sleep(5)


def _laad():
    try:
        return json.loads(CACHE.read_text())
    except (OSError, ValueError):
        return {}


def nederlandse_edities(book_id):
    """[{titel, isbn}] van Nederlandstalige edities van hetzelfde werk."""
    cache = _laad()
    if book_id in cache:
        return cache[book_id]
    pagina = _get(f"https://www.goodreads.com/book/show/{book_id}")
    m = re.search(r"/work/editions/(\d+)", pagina)
    edities = []
    if m:
        time.sleep(1)
        lijst = _get(f"https://www.goodreads.com/work/editions/{m.group(1)}"
                     "?sort=num_ratings&per_page=100")
        for blok in lijst.split('<div class="elementList clearFix">')[1:]:
            tekst = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", blok)))
            taal = re.search(r"Edition language: (\w+)", tekst)
            titel = re.search(r'class="bookTitle"[^>]*>(.*?)</a>', blok, re.S)
            if not (taal and taal.group(1) == "Dutch" and titel):
                continue
            isbn = re.search(r"ISBN13:\s*(\d{13})", tekst)
            edities.append({
                "titel": re.sub(r"\s*\(.*?\)\s*$", "", html.unescape(titel.group(1).strip())),
                "isbn": isbn.group(1) if isbn else "",
            })
        time.sleep(1)
    cache[book_id] = edities
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    return edities
