"""Een boek van de Goodreads-lijst vinden in de catalogus van Bibliotheek Liemers.

Alleen Nederlandstalige edities tellen: dezelfde titel, of een vertaling van het boek.
"""
import re
import time
import unicodedata

from goodreads import nederlandse_edities

WESTERVOORT = "LIE/WES"
LIEMERS = {"LIE/ZEV": "Zevenaar", "LIE/DUI": "Duiven", "LIE/GIE": "Giesbeek",
           "LIE/WES": "Westervoort", "LIE/LOB": "Lobith", "LIE/PAN": "Pannerden",
           "BSG/BSA": "Provinciaal depot", "BA/ALT": "Rozet Arnhem"}


def plat(s):
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def korte_titel(t):
    t = re.sub(r"\(.*?\)", "", t)          # "(Dutch Edition)", "(Beartown, #3)"
    return re.split(r"[:;]", t)[0].strip()


def achternaam(a):
    return plat(a.split()[-1]) if a.split() else ""


def norm(t):
    t = re.sub(r"[^\w ]", " ", plat(korte_titel(t)))
    t = re.sub(r"^(de|het|een|the|a|an|la|le|les|el|der|die|das) ", "", t.strip())
    return re.sub(r"\s+", " ", t).strip()


def zelfde_titel(a, b):
    a, b = norm(a), norm(b)
    kort, lang = sorted([a, b], key=len)
    return a == b or (len(kort) >= 6 and lang.startswith(kort))


def vertaald_uit(cat, r):
    """Originele titel volgens de catalogus ('Vertaling van: ...'), of ''."""
    if "_orig" not in r:
        noot = cat.details(r["id"]).get("FullNote", "")
        m = re.search(r"Vertaling van: ?(.+?)(?: [-/.] |\.$|$)", noot)
        r["_orig"] = m.group(1).strip(" .") if m else ""
        time.sleep(0.2)
    return r["_orig"]


def zoek_boek(cat, boek):
    """Alleen Nederlandstalige edities: dezelfde titel, of een vertaling van het boek.

    Eerst op de editie uit Goodreads (ISBN, titel, auteur). Lukt dat niet, dan
    op de titels en ISBN's van de Nederlandse edities die Goodreads kent.
    """
    gevonden = _zoek(cat, boek["auteur"], [(boek["titel"], boek["isbn"])], op_auteur=True)
    if not gevonden:
        nl = [(e["titel"], e["isbn"]) for e in nederlandse_edities(boek["goodreads_id"])]
        if nl:
            gevonden = _zoek(cat, boek["auteur"], nl)
            for r in gevonden:
                r.setdefault("vertaling_van", korte_titel(boek["titel"]))
    for r in gevonden:
        r.pop("_orig", None)
    return gevonden


def _zoek(cat, auteur, edities, op_auteur=False):
    naam = achternaam(auteur)
    titels = list(dict.fromkeys(korte_titel(t) for t, _ in edities))
    isbns = list(dict.fromkeys(i for _, i in edities if i))
    zoekvragen = isbns + [f"{t} {naam}" for t in titels] + \
        [f"{plat(t)} {naam}" for t in titels] + titels + ([naam] if op_auteur else [])
    gezien, gevonden = set(), []
    for q in dict.fromkeys(zoekvragen):
        for r in cat.zoek(q, aantal=50 if q == naam else 10):
            if r["id"] in gezien or "Nederlands" not in r["info"]:
                continue
            gezien.add(r["id"])
            # auteur moet kloppen (begin achternaam, zodat Tolstoy/Tolstoj matcht)
            if q not in isbns and naam[:5] not in plat(r["auteur"]):
                continue
            if q in isbns or any(zelfde_titel(r["titel"], t) for t in titels):
                gevonden.append(r)
            elif any(zelfde_titel(vertaald_uit(cat, r), t) for t in titels):
                r["vertaling_van"] = r["_orig"]
                gevonden.append(r)
        time.sleep(0.3)
        if gevonden:
            break
    return gevonden


def samenvatting(records):
    wes = [e for r in records for e in r["exemplaren"] if e["scope"] == WESTERVOORT]
    elders = [e for r in records for e in r["exemplaren"]
              if e["scope"] in LIEMERS and e["scope"] != WESTERVOORT]
    if any(e["status"] == "Aanwezig" for e in wes):
        return "westervoort"
    if wes:
        return "westervoort_uitgeleend"
    if any(e["status"] == "Aanwezig" for e in elders):
        return "elders"
    if records:
        return "elders_uitgeleend"
    return "niet"
