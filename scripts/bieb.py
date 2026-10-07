"""Zoek boeken in de catalogus van Bibliotheek Liemers (Iguana op sambis.nl)."""
import http.cookiejar
import re
import time
import urllib.parse
import urllib.request

BASE = "https://www.sambis.nl/iguana/"
HOLDINGS = "LIE/ZEV,LIE/DUI,LIE/GIE,LIE/WES,LIE/LOB,LIE/PAN,BSG/BSA,BA/ALT"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/130",
    "Origin": "https://www.sambis.nl",
    "Referer": BASE + "www.main.cls?surl=LIE_Search_App",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
}


def _cdata(t):
    t = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", t, flags=re.S)
    return re.sub(r"</?q>", "", t)  # zoekwoord-markering van de site


def _field(xml, tag):
    m = re.search(rf"<{tag}>(.*?)</{tag}>", xml, re.S)
    return m.group(1).strip() if m else ""


class Catalogus:
    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        html = self._get(BASE + "www.main.cls?surl=LIE_Search_App")
        self.sid = re.search(r"sessionID = '([^']+)'", html).group(1)

    def _get(self, url):
        req = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
        return self.opener.open(req, timeout=30).read().decode("utf-8", "replace")

    def _post(self, params):
        params.update(CspSessionId=self.sid, SIDTKN=self.sid)
        data = urllib.parse.urlencode(params).encode()
        req = urllib.request.Request(BASE + "Proxy.SearchRequest.cls", data=data, headers=HEADERS)
        for poging in range(4):
            try:
                return self.opener.open(req, timeout=30).read().decode("utf-8", "replace")
            except OSError:
                if poging == 3:
                    raise
                time.sleep(5 * (poging + 1))

    def details(self, record_id):
        """Volledige titelbeschrijving als dict, bv. FullNote, LanguagePub, LanguageOrg."""
        db, nr = record_id.split(".")
        xml = _cdata(self._post({
            "fu": "BibSearch", "Application": "Bib", "RequestType": "RecordNumber",
            "Database": f"{db}_LIE", "Request": nr, "TemplateId": "Iguana_Full",
            "ExportByTemplate": "Full", "Language": "dut", "Profile": "DeLiemers", "Namespace": 0,
        }))
        return {m.group(1): re.sub(r"<[^>]+>", "", m.group(2)).strip()
                for m in re.finditer(r"<Label>(.*?)</Label><Data>(.*?)</Data>", xml, re.S)}

    def zoek(self, query, aantal=10):
        """Geeft lijst van records: id, titel, auteur, type, taal/jaar, exemplaren (samenvatting)."""
        xml = self._post({
            "fu": "BibSearch", "RequestType": "ResultSet_DisplayList",
            "NumberToRetrieve": aantal, "StartValue": 1, "SearchTechnique": "Find",
            "Language": "dut", "Profile": "DeLiemers", "ExportByTemplate": "Brief",
            "TemplateId": "Iguana_Brief", "FacetedSearch": "No", "Cluster": 1,
            "Namespace": 0, "BestMatch": 99, "AlsoBarcode": "Yes", "Sort": "Relevancy",
            "SortDirection": -1, "WithoutRestrictions": "Yes", "Associations": "Also",
            "SummaryHoldings": HOLDINGS, "Request1": query, "Index1": "Index1",
            "Application": "Bib", "Database": "2_LIE", "Partial": "CombineAlso",
            "SearchMode": "NBC_LIE",
        })
        xml = _cdata(xml)
        # "bestMatch" = de site vond niets en zocht op iets anders; dat zijn geen echte treffers
        if "<bestMatch>" in xml:
            return []
        records = []
        for rec in re.findall(r"<BibDocument>(.*?)</BibDocument>", xml, re.S):
            def label(name):
                m = re.search(rf"<Label>{name}</Label><Data>(.*?)</Data>", rec, re.S)
                return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
            records.append({
                "id": _field(rec, "Id"),
                "titel": label("BriefMainTitle"),
                "auteur": label("BriefAuthor"),
                "type": label("BriefMaterialType"),
                "info": label("BriefSummary").strip(" |"),
                "omslag": label("BriefCoverA"),
                "exemplaren": [{
                    "scope": _field(s, "Scope"),
                    "locatie": _field(s, "LocationWording"),
                    "plaats": _field(s, "Shelfmark"),
                    "status": _field(s, "StatusSummary"),
                    "beschikbaar": _field(s, "Available") == "1",
                } for s in re.findall(r"<ShelfmarkData>(.*?)</ShelfmarkData>", rec, re.S)],
            })
        return records


if __name__ == "__main__":
    import sys
    c = Catalogus()
    for r in c.zoek(" ".join(sys.argv[1:])):
        print(r["id"], r["titel"], "|", r["auteur"], "|", r["type"], "|", r["info"])
        for e in r["exemplaren"]:
            print("    ", e["scope"], e["locatie"], "|", e["plaats"], "|", e["status"])
