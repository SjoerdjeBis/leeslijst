"""Houdt docs/data/boeken.json bij: de to-read-lijst met beschikbaarheid in Bibliotheek Liemers.

  python3 scripts/update.py export pad/naar/goodreads_library_export.csv
      Verwerkt een nieuwe Goodreads-export: nieuwe boeken erbij (en meteen opgezocht),
      boeken die niet meer op to-read staan eruit. Bestaande gegevens blijven bewaard.

  python3 scripts/update.py beschikbaarheid
      Zoekt alle boeken opnieuw op en noteert statuswijzigingen. Een boek dat eerst
      niet in de collectie zat en nu wel, wordt gemarkeerd als nieuw in de collectie.
"""
import csv
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path

from bieb import Catalogus
import zoeken
from zoeken import LIEMERS, WESTERVOORT, samenvatting, zoek_boek

DATA = Path(__file__).parent.parent / "docs/data/boeken.json"
NIEUW_DAGEN = 30  # zo lang blijft "nieuw in de collectie" zichtbaar
ORIG_CACHE = DATA.parent / "originele_titels.json"
TEGELIJK = 5  # zoveel boeken tegelijk opzoeken; elk met een eigen catalogussessie


def nu():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def laad():
    if DATA.exists():
        return json.loads(DATA.read_text())
    return {"bijgewerkt": None, "export": None, "boeken": []}


def bewaar(data):
    data["boeken"].sort(key=lambda b: b["toegevoegd"] or "", reverse=True)
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")


def _int(s):
    return int(s) if s and s.strip().isdigit() else None


def _export_regels(pad):
    """Regels van de export. Herstelt het formaat dat Excel/Numbers maakt na opslaan:
    elke regel tussen aanhalingstekens met een ';' erachter."""
    regels = open(pad, encoding="utf-8-sig").read().splitlines()
    if regels and regels[0].rstrip().endswith(";"):
        hersteld = []
        for r in regels:
            r = r.rstrip().removesuffix(";")
            if len(r) >= 2 and r[0] == '"' and r[-1] == '"':
                r = r[1:-1].replace('""', '"')
            hersteld.append(r)
        regels = hersteld
    return regels


def lees_export(pad):
    boeken = []
    for r in csv.DictReader(_export_regels(pad)):
        if r["Exclusive Shelf"] != "to-read":
            continue
        boeken.append({
            "id": r["Book Id"],
            "titel": r["Title"],
            "auteur": re.sub(r"\s+", " ", r["Author"]).strip(),
            "isbn": re.sub(r"\D", "", r["ISBN13"]),
            "paginas": _int(r["Number of Pages"]),
            "jaar": _int(r["Original Publication Year"]) or _int(r["Year Published"]),
            "toegevoegd": r["Date Added"].replace("/", "-") or None,
        })
    return boeken


def terugdatum(status):
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", status)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def edities(records):
    """Catalogusrecords omzetten naar wat de site nodig heeft (alleen Liemers-locaties)."""
    uit = []
    for r in records:
        ex = [{
            "vestiging": LIEMERS[e["scope"]],
            "westervoort": e["scope"] == WESTERVOORT,
            "status": e["status"].split(":")[0].strip(),
            "aanwezig": e["status"] == "Aanwezig",
            "terug": terugdatum(e["status"]),
            "plek": e["plaats"].split(" : ")[-1],
        } for e in r["exemplaren"] if e["scope"] in LIEMERS]
        if not ex:
            continue
        uit.append({
            "id": r["id"],  # catalogusnummer, voor de link naar de titelpagina
            "titel": r["titel"], "type": r["type"], "info": r["info"],
            "omslag": r.get("omslag") or None,
            "vertaling_van": r.get("vertaling_van") or None,
            "exemplaren": sorted(ex, key=lambda e: (not e["westervoort"], not e["aanwezig"])),
        })
    return uit


def controleer(cat, boek, vandaag):
    records = zoek_boek(cat, {"titel": boek["titel"], "auteur": boek["auteur"],
                              "isbn": boek["isbn"], "goodreads_id": boek["id"]})
    # handmatig uitgesloten catalogusrecords (verkeerde treffers)
    records = [r for r in records if r["id"] not in boek.get("uitgesloten", [])]
    nieuw = samenvatting(records)
    oud = boek.get("status")
    boek["edities"] = edities(records)
    boek["gecontroleerd"] = nu()
    if nieuw != oud:
        boek.setdefault("historie", []).append({"datum": vandaag, "status": nieuw})
        if oud == "niet":
            boek["nieuw_sinds"] = vandaag
    boek["status"] = nieuw
    # "nieuw" verloopt na NIEUW_DAGEN
    if boek.get("nieuw_sinds") and \
            (date.fromisoformat(vandaag) - date.fromisoformat(boek["nieuw_sinds"])).days > NIEUW_DAGEN:
        boek["nieuw_sinds"] = None
    return oud, nieuw


def run_beschikbaarheid(data, alleen=None):
    vandaag = date.today().isoformat()
    boeken = [b for b in data["boeken"] if alleen is None or b["id"] in alleen]
    try:
        zoeken.ORIGINELE_TITELS.update(json.loads(ORIG_CACHE.read_text()))
    except (OSError, ValueError):
        pass
    sessie = threading.local()
    slot = threading.Lock()
    wijzigingen, klaar = [], 0

    def een(b):
        if not hasattr(sessie, "cat"):
            sessie.cat = Catalogus()
        return b, *controleer(sessie.cat, b, vandaag)

    with ThreadPoolExecutor(TEGELIJK) as pool:
        for f in as_completed([pool.submit(een, b) for b in boeken]):
            b, oud, nieuw = f.result()
            with slot:
                klaar += 1
                teken = " " if oud == nieuw else "*"
                print(f"[{klaar}/{len(boeken)}]{teken}{nieuw:24} {b['titel'][:60]}", flush=True)
                if oud and oud != nieuw:
                    wijzigingen.append(f"{b['titel']}: {oud} -> {nieuw}")
    data["bijgewerkt"] = nu()
    bewaar(data)
    ORIG_CACHE.write_text(json.dumps(dict(sorted(zoeken.ORIGINELE_TITELS.items())),
                                     ensure_ascii=False, indent=1) + "\n")
    print(f"\n{len(wijzigingen)} wijziging(en)")
    for w in wijzigingen:
        print("  " + w)


def run_export(data, pad):
    nieuwe_lijst = lees_export(pad)
    # vangnet: een kapotte of verkeerde export mag de lijst niet leegmaken
    if data["boeken"] and len(nieuwe_lijst) < len(data["boeken"]) / 2:
        sys.exit(f"Export bevat maar {len(nieuwe_lijst)} to-read-boeken (nu {len(data['boeken'])}). "
                 "Klopt het bestand wel? Er is niets aangepast.")
    oud = {b["id"]: b for b in data["boeken"]}
    nieuw_ids = {b["id"] for b in nieuwe_lijst}
    weg = [b["titel"] for b in data["boeken"] if b["id"] not in nieuw_ids]
    boeken = []
    for b in nieuwe_lijst:
        boeken.append({**oud.get(b["id"], {}), **b})  # metadata uit export, status behouden
    toegevoegd = [b["id"] for b in nieuwe_lijst if b["id"] not in oud]
    data["boeken"] = boeken
    data["export"] = datetime.fromtimestamp(Path(pad).stat().st_mtime).date().isoformat()
    bewaar(data)
    print(f"{len(toegevoegd)} nieuw op de lijst, {len(weg)} eraf ({', '.join(weg) or '-'})")
    if toegevoegd:
        run_beschikbaarheid(data, alleen=set(toegevoegd))


if __name__ == "__main__":
    data = laad()
    if len(sys.argv) >= 3 and sys.argv[1] == "export":
        run_export(data, sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == "beschikbaarheid":
        run_beschikbaarheid(data)
    else:
        print(__doc__)
        sys.exit(1)
