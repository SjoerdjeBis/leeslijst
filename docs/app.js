"use strict";

// Repo afleiden uit de GitHub Pages-URL (eigenaar.github.io/repo); lokaal valt het terug op deze waarden.
const REPO = (() => {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const pad = location.pathname.split("/").filter(Boolean)[0];
  return { eigenaar: m ? m[1] : "", naam: m && pad ? pad : "", workflow: "vernieuw.yml", tak: "main" };
})();

const STATUS = {
  westervoort:            { groep: "wes",    rang: 0 },
  westervoort_uitgeleend: { groep: "uit",    rang: 2 },
  elders:                 { groep: "elders", rang: 1 },
  elders_uitgeleend:      { groep: "uit",    rang: 3 },
  niet:                   { groep: "niet",   rang: 4 },
};
const SEGMENTEN = [
  ["alle",   "Alle boeken",        null],
  ["wes",    "Nu in Westervoort",  "var(--groen)"],
  ["elders", "Aanwezig elders",    "var(--blauw)"],
  ["uit",    "Uitgeleend",         "var(--violet)"],
  ["niet",   "Niet in collectie",  "var(--grijs)"],
  ["nieuw",  "Nieuw in collectie", "var(--stift)"],
];
const VESTIGINGEN = ["Westervoort", "Duiven", "Zevenaar", "Giesbeek", "Lobith", "Pannerden", "Provinciaal depot"];
const BOEKLINNEN = [
  ["#2F5D50", "#F2EEE4"], ["#7A2E2E", "#F4E9E2"], ["#263F66", "#EDEFF5"], ["#C49A3A", "#231A06"],
  ["#4F5B66", "#EEF1F3"], ["#A4532B", "#FBEDE4"], ["#2E6E73", "#E9F4F4"], ["#5D3A5E", "#F4EAF4"],
  ["#4A5A30", "#F0F2E4"], ["#B9A27E", "#2A2114"], ["#3B4E63", "#E3E8EE"], ["#8E3B54", "#F8E8EE"],
];
const BLZ_MAX = 800;
const CATALOGUS = "https://www.sambis.nl/iguana/www.main.cls?surl=search&p=5f70b4fe-5f5f-11e9-a84f-0050568697e6#recordId=";
const MAAND = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
const MAAND_JAAR = new Intl.DateTimeFormat("nl-NL", { month: "short", year: "numeric" });
const DAG_TIJD = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const $ = (s) => document.querySelector(s);
const st = { q: "", sort: "toegevoegd", seg: "alle", min: 0, max: BLZ_MAX, periode: "", vest: [] };
let data = null;
let boeken = [];

/* ---------- hulpjes ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plat = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const korteTitel = (t) => t.replace(/\(.*?\)/g, "").split(/[:;]/)[0].trim();
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const linnen = (b) => BOEKLINNEN[hash(b.id) % BOEKLINNEN.length];
const achternaam = (a) => plat(a.split(" ").pop());
const dagenGeleden = (iso) => (Date.now() - new Date(iso)) / 864e5;

function markeer(tekst, q) {
  const t = esc(tekst);
  if (!q) return t;
  const i = plat(tekst).indexOf(plat(q));
  if (i < 0) return t;
  return esc(tekst.slice(0, i)) + "<mark>" + esc(tekst.slice(i, i + q.length)) + "</mark>" + esc(tekst.slice(i + q.length));
}

function verrijk(b) {
  const ed = b.edities || [];
  const ex = ed.flatMap((e) => e.exemplaren.map((x) => ({ ...x, editie: e })));
  const nl = ed[0];
  const toonTitel = nl ? nl.titel : korteTitel(b.titel);
  const terug = ex.filter((x) => x.terug).map((x) => x.terug).sort()[0] || null;
  const terugWes = ex.filter((x) => x.westervoort && x.terug).map((x) => x.terug).sort()[0] || null;
  const aanwezigIn = [...new Set(ex.filter((x) => x.aanwezig).map((x) => x.vestiging))];
  return {
    ...b, ex, toonTitel,
    origineel: nl && plat(korteTitel(b.titel)) !== plat(nl.titel) ? korteTitel(b.titel) : null,
    groep: STATUS[b.status]?.groep || "niet",
    rang: STATUS[b.status]?.rang ?? 9,
    terug: b.status === "westervoort_uitgeleend" ? terugWes || terug : terug,
    aanwezigIn,
    omslag: ed.find((e) => e.omslag)?.omslag || null,
    catalogus: (() => {
      const e = ed.find((e) => e.exemplaren.some((x) => x.westervoort && x.aanwezig))
        || ed.find((e) => e.exemplaren.some((x) => x.aanwezig)) || ed[0];
      return e?.id ? CATALOGUS + e.id : null;
    })(),
    nieuw: !!b.nieuw_sinds,
    zoektekst: plat([b.titel, b.auteur, ...ed.map((e) => e.titel)].join(" ")),
  };
}

/* ---------- filteren ---------- */
function past(b, zonder) {
  if (st.q && !b.zoektekst.includes(plat(st.q))) return false;
  if (zonder !== "seg" && st.seg !== "alle") {
    if (st.seg === "nieuw" ? !b.nieuw : b.groep !== st.seg) return false;
  }
  const volledigeRange = st.min === 0 && st.max === BLZ_MAX;
  if (!volledigeRange) {
    if (b.paginas == null) return false;
    if (b.paginas < st.min || (st.max < BLZ_MAX && b.paginas > st.max)) return false;
  }
  if (st.periode) {
    const p = +st.periode, d = b.toegevoegd ? dagenGeleden(b.toegevoegd) : Infinity;
    if (p > 0 ? d > p : d < -p) return false;
  }
  if (st.vest.length && !st.vest.some((v) => b.aanwezigIn.includes(v))) return false;
  return true;
}

const SORTEER = {
  "toegevoegd":     (a, b) => (b.toegevoegd || "").localeCompare(a.toegevoegd || ""),
  "toegevoegd-oud": (a, b) => (a.toegevoegd || "").localeCompare(b.toegevoegd || ""),
  "beschikbaar":    (a, b) => a.rang - b.rang || (a.terug || "").localeCompare(b.terug || ""),
  "dun":            (a, b) => (a.paginas ?? 1e9) - (b.paginas ?? 1e9),
  "dik":            (a, b) => (b.paginas ?? -1) - (a.paginas ?? -1),
  "titel":          (a, b) => a.toonTitel.localeCompare(b.toonTitel, "nl"),
  "auteur":         (a, b) => achternaam(a.auteur).localeCompare(achternaam(b.auteur), "nl"),
  "jaar":           (a, b) => (b.jaar ?? 0) - (a.jaar ?? 0),
};

/* ---------- render ---------- */
function stempel(b) {
  const datum = b.terug ? `<small>terug ${MAAND.format(new Date(b.terug))}</small>` : "";
  switch (b.status) {
    case "westervoort": return `<div class="stempel wes">In Wester&shy;voort</div>`;
    case "westervoort_uitgeleend": return `<div class="stempel uit">Uitgeleend${datum}</div>`;
    case "elders": {
      const v = b.aanwezigIn.find((x) => x !== "Provinciaal depot");
      return v ? `<div class="stempel elders">In ${esc(v)}</div>`
               : `<div class="stempel elders">Depot<small>reserveren</small></div>`;
    }
    case "elders_uitgeleend": return `<div class="stempel uit">Uitgeleend${datum}</div>`;
    default: return `<div class="stempel niet">Niet in collectie</div>`;
  }
}

function omslag(b) {
  const [k, o] = linnen(b);
  const img = b.omslag ? `<img src="${esc(b.omslag)}" alt="" loading="lazy" onerror="this.remove()">` : "";
  return `<div class="omslag" style="--kleur:${k};--op:${o}" aria-hidden="true">${esc(b.toonTitel)}${img}</div>`;
}

function exemplaren(b) {
  if (!b.ex.length) return `<p class="geen">Geen Nederlandstalig exemplaar in Liemers</p>`;
  const rijen = b.ex.map((x) => {
    const st = x.aanwezig ? "aanwezig"
      : x.terug && new Date(x.terug) < new Date().setHours(0, 0, 0, 0) ? `uitgeleend, verwacht ${MAAND.format(new Date(x.terug))}`
      : x.terug ? `terug ${MAAND.format(new Date(x.terug))}` : x.status.toLowerCase();
    return `<li class="${x.aanwezig ? "ja" : ""} ${x.westervoort ? "wes" : ""}"><span class="bol"></span>` +
      `<span><span class="naam">${esc(x.vestiging)}</span> <span class="st">${esc(st)}</span></span>` +
      `<span class="plek" title="Plaats in de bibliotheek">${esc(x.plek.replace(/[[\]]/g, "").slice(0, 24))}</span></li>`;
  });
  const MAX = 3;
  const zichtbaar = rijen.slice(0, MAX).join("");
  const rest = rijen.length > MAX
    ? `<li class="meer"><button class="link" type="button" data-meer>+ ${rijen.length - MAX} andere exemplaren</button></li><template>${rijen.slice(MAX).join("")}</template>`
    : "";
  return `<ul class="ex">${zichtbaar}${rest}</ul>`;
}

function kaart(b) {
  const meta = [
    b.paginas ? `${b.paginas} blz` : null,
    b.jaar ? `${b.jaar}` : null,
    b.toegevoegd ? `op lijst sinds ${MAAND_JAAR.format(new Date(b.toegevoegd))}` : null,
  ].filter(Boolean).join(" · ");
  const nieuw = b.nieuw ? `<span class="stempel-nieuw">Nieuw in collectie · ${MAAND.format(new Date(b.nieuw_sinds))}</span>` : "";
  return `<article class="kaart ${b.nieuw ? "is-nieuw" : ""}" id="b${b.id}" style="view-transition-name:b${b.id}">
    ${nieuw}${omslag(b)}
    <div>
      <h3><a href="https://www.goodreads.com/book/show/${esc(b.id)}" target="_blank" rel="noopener"><span>${markeer(b.toonTitel, st.q)}</span></a></h3>
      <p class="auteur">${markeer(b.auteur, st.q)}</p>
      ${b.origineel ? `<p class="vert">vertaling van ${markeer(b.origineel, st.q)}</p>` : ""}
      <p class="meta">${esc(meta)}</p>
    </div>
    ${stempel(b)}
    ${exemplaren(b)}
    ${b.catalogus ? `<a class="reserveer" href="${esc(b.catalogus)}" target="_blank" rel="noopener">${b.status === "westervoort" ? "Bekijk in de catalogus" : "Reserveren in de catalogus"}<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>` : ""}
  </article>`;
}

function renderPlank() {
  const op = boeken.filter((b) => b.status === "westervoort")
    .sort((a, b) => (b.nieuw - a.nieuw) || (a.toegevoegd || "").localeCompare(b.toegevoegd || ""));
  $("#kop-titel").innerHTML = op.length === 1
    ? `<span class="getal">1</span> boek van je leeslijst staat nu in&nbsp;Westervoort`
    : `<span class="getal">${op.length || "Geen"}</span> boeken van je leeslijst staan nu in&nbsp;Westervoort`;
  $("#plank").innerHTML = op.length ? op.map((b, i) => {
    const [k, o] = linnen(b);
    const breed = Math.round(Math.min(56, Math.max(22, (b.paginas || 300) / 13)));
    const hoog = 150 + (hash(b.id + "h") % 46);
    const plek = (b.ex.find((x) => x.westervoort)?.plek || "").replace(/^\[.*?\]\s*/, "").split(" ").pop().slice(0, 5);
    return `<button class="rug ${b.nieuw ? "nieuw" : ""}" role="listitem" data-naar="b${b.id}" style="--kleur:${k};--op:${o};--i:${i};width:${breed}px;height:${hoog}px" title="${esc(b.toonTitel)} — ${esc(b.auteur)}${b.paginas ? ` (${b.paginas} blz)` : ""}">
      <span class="rt">${esc(b.toonTitel)}</span><span class="etiket">${esc(plek)}</span></button>`;
  }).join("") + `<span class="steun" aria-hidden="true"></span>` : `<p class="plank-leeg">De plank is leeg. Kijk bij "Aanwezig elders" wat je kunt reserveren.</p>`;
}

function renderSegmenten() {
  const basis = boeken.filter((b) => past(b, "seg"));
  $("#status").innerHTML = SEGMENTEN.map(([k, label, kleur]) => {
    const n = k === "alle" ? basis.length : k === "nieuw" ? basis.filter((b) => b.nieuw).length : basis.filter((b) => b.groep === k).length;
    if (k === "nieuw" && !boeken.some((b) => b.nieuw)) return "";
    return `<button class="seg ${k === "nieuw" ? "seg-nieuw" : ""}" role="radio" aria-checked="${st.seg === k}" data-seg="${k}" data-leeg="${n === 0}">
      ${kleur ? `<span class="stip" style="--c:${kleur}"></span>` : ""}${label}<span class="n">${n}</span></button>`;
  }).join("");
}

function renderHisto() {
  const bak = 50, n = BLZ_MAX / bak;
  const tel = Array(n).fill(0);
  boeken.forEach((b) => { if (b.paginas) tel[Math.min(n - 1, Math.floor(b.paginas / bak))]++; });
  const top = Math.max(...tel, 1);
  $("#histo").innerHTML = tel.map((c, i) => {
    const binnen = i * bak + bak > st.min && (st.max >= BLZ_MAX || i * bak < st.max);
    return `<span class="${binnen ? "" : "uit"}" style="height:${(c / top) * 100}%" title="${i * bak}–${i * bak + bak} blz: ${c}"></span>`;
  }).join("");
  $("#blz-uit").textContent = st.min === 0 && st.max === BLZ_MAX ? "alle"
    : `${st.min}–${st.max >= BLZ_MAX ? BLZ_MAX + "+" : st.max}`;
}

function renderFilters() {
  document.querySelectorAll("#periode button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === st.periode));
  $("#vestigingen").innerHTML = VESTIGINGEN.map((v) =>
    `<button type="button" data-vest="${v}" aria-pressed="${st.vest.includes(v)}">${v === "Provinciaal depot" ? "Depot (reserveren)" : v}</button>`).join("");
  $("#blz-min").value = st.min; $("#blz-max").value = st.max;
  const actief = (st.min > 0 || st.max < BLZ_MAX) + !!st.periode + (st.vest.length > 0);
  $("#filter-aantal").hidden = !actief; $("#filter-aantal").textContent = actief;
  renderHisto();
}

function renderLijst() {
  const lijst = boeken.filter((b) => past(b)).sort(SORTEER[st.sort]);
  const iets = st.q || st.seg !== "alle" || st.min > 0 || st.max < BLZ_MAX || st.periode || st.vest.length;
  $("#aantal").textContent = lijst.length === boeken.length ? `${boeken.length} boeken op je leeslijst`
    : `${lijst.length} van ${boeken.length} boeken`;
  $("#wis").hidden = !iets;
  $("#lijst").innerHTML = lijst.length ? lijst.map(kaart).join("")
    : `<div class="leeg"><strong>Geen boeken gevonden</strong>Pas je zoekopdracht of filters aan. <button class="link" type="button" data-wis>Wis filters</button></div>`;
}

function render(animeer = true) {
  schrijfUrl();
  const doe = () => { renderSegmenten(); renderFilters(); renderLijst(); };
  if (animeer && document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.startViewTransition(doe);
  } else doe();
}

/* ---------- url-status ---------- */
function schrijfUrl() {
  const p = new URLSearchParams();
  if (st.q) p.set("q", st.q);
  if (st.sort !== "toegevoegd") p.set("sort", st.sort);
  if (st.seg !== "alle") p.set("status", st.seg);
  if (st.min) p.set("min", st.min);
  if (st.max < BLZ_MAX) p.set("max", st.max);
  if (st.periode) p.set("periode", st.periode);
  if (st.vest.length) p.set("in", st.vest.join(","));
  history.replaceState(null, "", p.toString() ? "#" + p : location.pathname);
}
function leesUrl() {
  const p = new URLSearchParams(location.hash.slice(1));
  st.q = p.get("q") || "";
  st.sort = SORTEER[p.get("sort")] ? p.get("sort") : "toegevoegd";
  st.seg = p.get("status") || "alle";
  st.min = +p.get("min") || 0;
  st.max = +p.get("max") || BLZ_MAX;
  st.periode = p.get("periode") || "";
  st.vest = (p.get("in") || "").split(",").filter((v) => VESTIGINGEN.includes(v));
  $("#zoek").value = st.q; $("#sorteer").value = st.sort;
  if (st.min || st.max < BLZ_MAX || st.periode || st.vest.length) toonFilters(true);
}

/* ---------- interactie ---------- */
function toonFilters(open) {
  $("#filters").classList.toggle("open", open);
  $("#filter-knop").setAttribute("aria-expanded", open);
}

let zoekTimer;
$("#zoek").addEventListener("input", (e) => {
  clearTimeout(zoekTimer);
  zoekTimer = setTimeout(() => { st.q = e.target.value.trim(); render(false); }, 120);
});
$("#sorteer").addEventListener("change", (e) => { st.sort = e.target.value; render(); });
$("#filter-knop").addEventListener("click", () => toonFilters(!$("#filters").classList.contains("open")));

function wisFilters() {
  Object.assign(st, { q: "", seg: "alle", min: 0, max: BLZ_MAX, periode: "", vest: [] });
  $("#zoek").value = "";
  render();
}
$("#wis").addEventListener("click", wisFilters);

["#blz-min", "#blz-max"].forEach((id) => $(id).addEventListener("input", () => {
  let lo = +$("#blz-min").value, hi = +$("#blz-max").value;
  if (lo > hi - 50) { if (id === "#blz-min") lo = hi - 50; else hi = lo + 50; }
  st.min = Math.max(0, lo); st.max = Math.min(BLZ_MAX, hi);
  renderHisto(); renderSegmenten(); renderLijst(); schrijfUrl();
  $("#blz-min").value = st.min; $("#blz-max").value = st.max;
}));

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-seg],[data-v],[data-vest],[data-naar],[data-meer],[data-wis]");
  if (!t) return;
  if (t.dataset.seg) { st.seg = st.seg === t.dataset.seg ? "alle" : t.dataset.seg; render(); }
  else if (t.dataset.v !== undefined) { st.periode = t.dataset.v; render(); }
  else if (t.dataset.vest) {
    const v = t.dataset.vest;
    st.vest = st.vest.includes(v) ? st.vest.filter((x) => x !== v) : [...st.vest, v];
    render();
  } else if (t.dataset.naar) {
    let el = document.getElementById(t.dataset.naar);
    if (!el) { wisFilters(); el = document.getElementById(t.dataset.naar); }
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      el.classList.remove("flits"); void el.offsetWidth; el.classList.add("flits");
    });
  } else if (t.hasAttribute("data-meer")) {
    const li = t.closest("li"), tpl = li.nextElementSibling;
    li.insertAdjacentHTML("afterend", tpl.innerHTML); tpl.remove(); li.remove();
  } else if (t.hasAttribute("data-wis")) wisFilters();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
    e.preventDefault(); $("#zoek").focus();
  } else if (e.key === "Escape" && document.activeElement === $("#zoek") && st.q) {
    $("#zoek").value = ""; st.q = ""; render(false);
  }
});

new IntersectionObserver(([e]) => $("#balk").classList.toggle("vast", e.intersectionRatio < 1), { threshold: [1], rootMargin: "-1px 0px 0px 0px" })
  .observe($("#balk"));

/* ---------- vernieuwen via GitHub Actions ---------- */
const TOKEN_KEY = "leeslijst-gh-token";
const token = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } },
  set(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch {} },
};

function toast(tekst, ms = 4500) {
  const t = $("#toast"); t.textContent = tekst; t.classList.add("aan");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("aan"), ms);
}

function knopStatus(tekst, bezig) {
  const k = $("#vernieuw-knop");
  k.querySelector("span").textContent = tekst;
  k.classList.toggle("bezig", bezig);
}

async function gh(pad, opties = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO.eigenaar}/${REPO.naam}${pad}`, {
    ...opties,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token.get()}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}`), { status: r.status });
  return r.status === 204 ? null : r.json();
}

async function vernieuw() {
  if (!REPO.eigenaar) { toast("Vernieuwen werkt op de gepubliceerde site, niet lokaal."); return; }
  if (!token.get()) { openDialoog(); return; }
  const start = new Date();
  knopStatus("Starten…", true);
  try {
    await gh(`/actions/workflows/${REPO.workflow}/dispatches`, { method: "POST", body: JSON.stringify({ ref: REPO.tak }) });
  } catch (e) {
    knopStatus("Vernieuw beschikbaarheid", false);
    if (e.status === 401 || e.status === 403 || e.status === 404) { toast("Het token werkt niet (meer). Koppel GitHub opnieuw."); openDialoog(); }
    else toast("Vernieuwen kon niet starten. Probeer het later opnieuw.");
    return;
  }
  knopStatus("Bibliotheek wordt gecontroleerd…", true);
  toast("Gestart. Dit duurt ongeveer 10 minuten; je kunt deze pagina open laten.", 6000);
  const vorige = data.bijgewerkt;
  // eerst wachten tot de run klaar is, daarna tot de nieuwe data online staat
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    try {
      const runs = await gh(`/actions/workflows/${REPO.workflow}/runs?per_page=3&event=workflow_dispatch`);
      const run = runs.workflow_runs.find((r) => new Date(r.created_at) >= new Date(start - 60000));
      if (run && run.status === "completed" && run.conclusion !== "success") {
        knopStatus("Vernieuw beschikbaarheid", false);
        toast("De controle is mislukt. Bekijk de details op GitHub.");
        return;
      }
      if (run && run.status === "completed") knopStatus("Bijna klaar…", true);
    } catch { /* tijdelijk geen verbinding: gewoon opnieuw proberen */ }
    const nieuw = await laadData().catch(() => null);
    if (nieuw && nieuw.bijgewerkt !== vorige) {
      zetData(nieuw); render();
      knopStatus("Vernieuw beschikbaarheid", false);
      const n = boeken.filter((b) => b.nieuw_sinds === new Date().toISOString().slice(0, 10)).length;
      toast(n ? `Bijgewerkt. ${n} boek${n > 1 ? "en" : ""} nieuw in de collectie.` : "Bijgewerkt.");
      return;
    }
  }
  knopStatus("Vernieuw beschikbaarheid", false);
}
$("#vernieuw-knop").addEventListener("click", vernieuw);

function openDialoog() {
  $("#token").value = token.get();
  $("#token-wis").hidden = !token.get();
  $("#dlg").showModal();
}
$("#koppel").addEventListener("click", openDialoog);
$("#dlg").addEventListener("close", () => {
  const v = $("#dlg").returnValue;
  if (v === "ok" && $("#token").value.trim()) { token.set($("#token").value.trim()); toast("GitHub gekoppeld."); }
  if (v === "wis") { token.set(""); toast("Token verwijderd uit deze browser."); }
  $("#koppel").textContent = token.get() ? "GitHub-koppeling wijzigen" : "GitHub koppelen";
});

/* ---------- start ---------- */
async function laadData() {
  const r = await fetch(`data/boeken.json?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
function zetData(d) {
  data = d;
  boeken = d.boeken.map(verrijk);
  $("#gecontroleerd").textContent = d.bijgewerkt ? `Gecontroleerd ${DAG_TIJD.format(new Date(d.bijgewerkt))}` : "";
  $("#voet-tekst").textContent = `${boeken.length} boeken van je Goodreads-lijst (export van ${d.export ? MAAND_JAAR.format(new Date(d.export)).replace(".", "") : "onbekend"}). ` +
    `Beschikbaarheid uit de catalogus van Bibliotheek Liemers, elke nacht automatisch bijgewerkt. Alleen Nederlandstalige edities tellen mee.`;
  renderPlank();
}

(async () => {
  $("#koppel").textContent = token.get() ? "GitHub-koppeling wijzigen" : "GitHub koppelen";
  try {
    zetData(await laadData());
    leesUrl();
    render(false);
  } catch {
    $("#lijst").innerHTML = `<div class="leeg"><strong>De leeslijst kon niet laden</strong>Ververs de pagina om het opnieuw te proberen.</div>`;
  }
})();
