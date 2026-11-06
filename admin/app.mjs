// Admin d'Échos des siècles : https://echosdessiecles.fr/admin/
// Lit l'état chiffré du dépôt GitHub, le déchiffre dans le navigateur avec la
// phrase secrète, et envoie chaque action comme un petit fichier chiffré
// (data/inbox/) que le moteur applique au cycle suivant (lancé tout de suite).

import { applyCommand, normalize, emptyState, LIVRAISONS, CANAUX, STATUTS_COMMANDE } from '../engine/src/model.mjs';
import { propositions, marteauMax, fraisLot, coutRevient, prixConseille } from '../engine/src/pricing.mjs';
import { encryptJSON, decryptJSON } from '../engine/src/crypto.mjs';
import { demoState } from './demo.mjs';

/* ================= configuration ================= */
const LS = 'echos-admin-v1';
const DEFAULT_REPO = 'u8tscared/echos-des-siecles';
const WORKFLOW = 'moteur.yml';
let cfg = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
const saveCfg = () => { try { localStorage.setItem(LS, JSON.stringify(cfg.remember ? cfg : { repo: cfg.repo })); } catch {} };

let S = null;        // état courant (déchiffré)
let mode = null;     // 'live' | 'demo'
let syncState = { k: 'ok', t: '' };
const f = { veille: 'nouveau', kind: 'tous', tag: 'tous', q: '', stock: 'actifs', ventes: 'ouvertes' };

/* ================= utilitaires ================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => (n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('fr-FR') + ' €');
const TZ = 'Europe/Paris';
const fdate = (iso, o = { weekday: 'short', day: 'numeric', month: 'short' }) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, ...o }) : '—');
const fheure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '');
function dans(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!isFinite(ms)) return '';
  const a = Math.abs(ms), d = Math.floor(a / 864e5), h = Math.floor((a % 864e5) / 36e5), m = Math.floor((a % 36e5) / 6e4);
  const s = d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  return ms >= 0 ? 'dans ' + s : 'il y a ' + s;
}
const depuis = (iso) => (iso ? dans(iso) : 'jamais');
const icon = (id, s = 20) => `<svg width="${s}" height="${s}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const KIND = { live: ['Live', 'live'], online: ['Chrono', 'online'], classic: ['Catalogue', ''] };
const kindTag = (k) => `<span class="tag ${KIND[k]?.[1] || ''}">${KIND[k]?.[0] || k}</span>`;
const pic = (p) => (p ? esc(p.startsWith('http') || p.startsWith('../') ? p : '../' + p) : '');
const thumb = (p, cls = 'th') => (p ? `<img class="${cls}" src="${pic(p)}" alt="" loading="lazy">` : `<div class="${cls} ph0">${icon('img', 26)}</div>`);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }
const STAT_ITEM = { prix: ['Prix à fixer', 'warn'], pret: ['Prête', 'ok'], en_ligne: ['En ligne', 'ok'], reserve: ['Réservée', 'warn'], vendu: ['Vendue', 'ink'], archive: ['Retirée', ''] };
const STAT_CANAL = { en_ligne: ['En ligne', 'ok'], a_publier: ['En cours', 'warn'], a_coller: ['À coller', 'warn'], erreur: ['Erreur', 'bad'], non_configure: ['Non configuré', ''], vendu: ['Vendu', 'ink'], retire: ['Retiré', ''] };
const STAT_CMD = { nouvelle: 'Nouvelle', livraison_a_choisir: 'Livraison à choisir', a_preparer: 'À préparer', expediee: 'Expédiée', remise: 'Remise', terminee: 'Terminée', annulee: 'Annulée' };

/* ================= GitHub ================= */
async function gh(p, opt = {}) {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/${p}`, {
    ...opt,
    cache: 'no-store',
    headers: { authorization: `Bearer ${cfg.token}`, accept: opt.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(opt.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw new Error('Jeton GitHub refusé');
  return res;
}

async function loadRemote() {
  setSync('wait', 'Chargement…');
  const r = await gh('contents/data/state.enc?ref=main', { raw: true });
  let st;
  if (r.status === 404) st = emptyState();
  else if (!r.ok) throw new Error('Lecture impossible (' + r.status + ')');
  else st = normalize(await decryptJSON(await r.text(), cfg.pass));
  // Actions déjà envoyées mais pas encore appliquées par le moteur.
  const ib = await gh('contents/data/inbox?ref=main');
  let enAttente = 0;
  if (ib.ok) {
    for (const file of (await ib.json()).filter((x) => x.name.endsWith('.enc')).sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        const t = await (await gh('contents/' + file.path + '?ref=main', { raw: true })).text();
        for (const c of [].concat(await decryptJSON(t, cfg.pass))) { try { applyCommand(st, c); } catch {} }
        enAttente++;
      } catch {}
    }
  }
  S = st;
  setSync(enAttente ? 'wait' : 'ok', enAttente ? `${enAttente} action(s) en cours` : 'À jour');
}

let dispatchT;
async function dispatch(veille = false) {
  const r = await gh(`actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { veille } }) });
  if (!r.ok && r.status !== 204) throw new Error('Lancement du moteur impossible (' + r.status + ')');
}

/** Applique une action tout de suite à l'écran, puis l'envoie au moteur. */
async function act(cmds, okMsg) {
  cmds = [].concat(cmds);
  try { for (const c of cmds) applyCommand(S, { ...c, source: 'admin' }); }
  catch (e) { toast(e.message); return false; }
  S.jobs = S.jobs.filter((j) => j.type !== 'notify'); // les notifications partent du moteur
  render();
  if (mode === 'demo') { toast((okMsg || 'Fait') + ' · démo, rien n\'est envoyé'); return true; }
  try {
    setSync('wait', 'Envoi…');
    const name = `data/inbox/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.enc`;
    const content = btoa(await encryptJSON(cmds, cfg.pass));
    const r = await gh('contents/' + name, { method: 'PUT', body: JSON.stringify({ message: 'Admin : ' + cmds.map((c) => c.type).join(', '), content, branch: 'main' }) });
    if (!r.ok) throw new Error('Envoi refusé (' + r.status + ')');
    clearTimeout(dispatchT);
    dispatchT = setTimeout(() => dispatch().catch(() => {}), 2500);
    setSync('wait', 'Envoyé, le moteur applique…');
    toast(okMsg || 'Envoyé');
    return true;
  } catch (e) { setSync('err', e.message); toast(e.message); return false; }
}

function setSync(k, t) { syncState = { k, t }; const el = $('#sync'); if (el) { el.className = 'sync ' + k; el.lastChild.textContent = t; } }

/* ================= calculs ================= */
const items = () => Object.values(S.items);
const lots = () => Object.values(S.lots);
const orders = () => Object.values(S.orders).sort((a, b) => b.creeLe.localeCompare(a.creeLe));
const moisCourant = (iso) => iso && iso.slice(0, 7) === new Date().toISOString().slice(0, 7);
function kpis() {
  const vendus = items().filter((i) => i.vendu && moisCourant(i.vendu.le));
  const ca = vendus.reduce((a, i) => a + (i.vendu.prix || 0), 0);
  const mg = vendus.reduce((a, i) => a + (i.vendu.prix || 0) - (i.cout || 0), 0);
  const enLigne = items().filter((i) => i.statut === 'en_ligne');
  return { ca, mg, nv: vendus.length, enLigne: enLigne.length, valeur: enLigne.reduce((a, i) => a + (i.prix || 0), 0) };
}
function todos() {
  const t = [];
  for (const i of items().filter((i) => i.statut === 'prix')) t.push({ k: 'hot', ico: 'euro', titre: 'Fixer le prix', txt: `${i.titre} · conseillé ${eur(i.prixConseille)}`, act: `data-open="item" data-id="${i.id}"` });
  for (const i of items().filter((i) => i.statut === 'pret')) t.push({ k: 'new', ico: 'bolt', titre: 'Prête à publier', txt: `${i.titre} · ${eur(i.prix)}`, act: `data-open="item" data-id="${i.id}"` });
  for (const o of orders().filter((o) => o.statut === 'livraison_a_choisir')) t.push({ k: 'hot', ico: 'truck', titre: 'Choisir la livraison', txt: `${S.items[o.itemId]?.titre || ''} · ${eur(o.prix)} · ${CANAUX[o.canal] || o.canal}`, act: `data-open="order" data-id="${o.id}"` });
  for (const i of items().filter((i) => i.canaux?.leboncoin?.statut === 'a_coller' && i.statut === 'en_ligne')) t.push({ k: 'new', ico: 'bag', titre: 'Coller sur Leboncoin', txt: i.titre, act: `data-open="item" data-id="${i.id}"` });
  for (const i of items().filter((i) => Object.values(i.canaux || {}).some((c) => c.statut === 'erreur'))) t.push({ k: 'hot', ico: 'x', titre: 'Publication en erreur', txt: i.titre, act: `data-open="item" data-id="${i.id}"` });
  for (const l of lots().filter((l) => l.statut === 'suivi' && Date.parse(l.date) < Date.now() && !l.itemId)) t.push({ k: 'new', ico: 'hammer', titre: 'Vente passée : gagné ?', txt: l.titre, act: `data-open="lot" data-id="${l.id}"` });
  return t;
}

/* ================= vues ================= */
const VIEWS = {
  accueil: { t: 'Accueil', i: 'home', r: vAccueil },
  veille: { t: 'Veille', i: 'eye', r: vVeille },
  agenda: { t: 'Agenda', i: 'cal', r: vAgenda },
  stock: { t: 'Stock', i: 'box', r: vStock },
  ventes: { t: 'Ventes', i: 'bag', r: vVentes },
  reglages: { t: 'Réglages', i: 'gear', r: vReglages, side: true },
};
const curView = () => { const v = (location.hash.slice(1) || 'accueil').split('/')[0]; return VIEWS[v] ? v : 'accueil'; };

function badge(v) {
  if (v === 'accueil') return todos().length;
  if (v === 'veille') return lots().filter((l) => l.statut === 'nouveau').length;
  if (v === 'ventes') return orders().filter((o) => o.statut === 'livraison_a_choisir').length;
  return 0;
}

function shell(inner) {
  const v = curView();
  const nav = Object.entries(VIEWS).map(([k, x]) => { const b = badge(k); return `<a href="#${k}" class="${k === v ? 'on' : ''} ${x.side ? 'side-only' : ''}" ${k === v ? 'aria-current="page"' : ''}>${icon(x.i, 23)}<span>${x.t}</span>${b ? `<b>${b > 99 ? '99+' : b}</b>` : ''}</a>`; }).join('');
  return `<div class="app">
    <nav class="nav" aria-label="Navigation"><a class="logo side-only" href="#accueil"><svg width="26" height="26"><use href="#m-plate"/></svg><span>échos des siècles</span></a>${nav}</nav>
    <div>
      <header class="top">
        <a class="logo" href="#accueil"><svg width="26" height="26"><use href="#m-plate"/></svg><span>échos</span><small>admin</small></a>
        <span class="sp"></span>
        <button class="sync ${syncState.k}" id="sync" data-act="reload" title="Recharger"><i></i>${esc(mode === 'demo' ? 'Démo' : syncState.t)}</button>
        <a class="ib" href="#reglages" aria-label="Réglages">${icon('gear', 19)}</a>
      </header>
      <main>${mode === 'demo' ? `<div class="banner">${icon('bolt', 18)}<span>Mode démo : données d'exemple, rien n'est envoyé. <a href="#" data-act="logout">Se connecter</a></span></div>` : ''}${inner}</main>
    </div>
  </div>`;
}

function salut() {
  const h = +new Date().toLocaleString('fr-FR', { timeZone: TZ, hour: 'numeric', hour12: false });
  return h < 6 ? 'Bonne nuit' : h < 18 ? 'Bonjour' : 'Bonsoir';
}

function vAccueil() {
  const k = kpis(), t = todos();
  const prochains = lots().filter((l) => l.statut === 'suivi' && Date.parse(l.date) > Date.now()).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).slice(0, 4);
  return `<p class="mono dim">${esc(fdate(new Date().toISOString(), { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
  <h1 class="h1">${salut()}${S.tg.nom ? ', ' + esc(S.tg.nom.split(' ')[0]) : ''}<br><em>la maison tourne.</em></h1>
  <p class="lead">Moteur passé ${esc(depuis(S.status.lastRun))} · veille ${esc(depuis(S.status.lastVeille))}</p>
  <div class="kpis">
    <div class="kpi dark"><span class="mono">Ventes du mois</span><b>${eur(k.ca)}</b><span>${k.nv} pièce${k.nv > 1 ? 's' : ''}</span></div>
    <div class="kpi"><span class="mono">Marge du mois</span><b>${eur(k.mg)}</b><span>après frais d'achat</span></div>
    <div class="kpi"><span class="mono">En ligne</span><b>${k.enLigne}</b><span>${eur(k.valeur)} en vitrine</span></div>
    <div class="kpi"><span class="mono">Veille</span><b>${lots().filter((l) => l.statut === 'nouveau').length}</b><span>nouveaux lots</span></div>
  </div>
  <section class="sec"><div class="sech"><h2>À <em>faire</em></h2><span class="dim">${t.length}</span></div>
    <div class="list g2">${t.length ? t.map((x) => `<button class="todo ${x.k}" ${x.act}><span class="ico">${icon(x.ico)}</span><div><b>${esc(x.titre)}</b><span>${esc(x.txt)}</span></div><span class="dim">›</span></button>`).join('') : '<div class="empty">Rien à faire. Le bot te prévient dès qu\'il faut fixer un prix ou choisir une livraison.</div>'}</div>
  </section>
  <section class="sec"><div class="sech"><h2>Prochaines <em>ventes</em></h2><a href="#agenda">Agenda ›</a></div>
    <div class="list g2">${prochains.length ? prochains.map(lotCard).join('') : '<div class="empty">Aucun lot suivi. Ouvre la veille et appuie sur « Suivre ».</div>'}</div>
  </section>
  <section class="sec"><div class="sech"><h2>Ajouter un <em>achat</em></h2></div>
    <button class="btn o full" data-open="new">${icon('hammer', 18)} Saisir un achat à la main</button>
  </section>`;
}

function lotCard(l) {
  const passe = Date.parse(l.date) < Date.now();
  return `<article class="card">
    <div class="row" data-open="lot" data-id="${l.id}" role="button" tabindex="0">${thumb(l.photos[0])}<div class="body"><small>${esc(l.tag)} · ${esc(l.ville || l.etude)}</small><b>${esc(l.titre)}</b>
      <div class="meta">${kindTag(l.kind)}<span>${esc(fdate(l.date))} ${esc(fheure(l.date))}</span><span>${passe ? 'terminée' : esc(dans(l.date))}</span></div>
      <div class="meta"><span>Estim. ${l.estMin || l.estMax ? eur(l.estMin) + ' – ' + eur(l.estMax) : '—'}</span>${l.statut === 'suivi' ? '<span class="tag ok">Suivi</span>' : l.statut === 'invendu' ? '<span class="tag warn">Invendu ?</span>' : ''}</div></div></div>
    <div class="target"><span>🎯 Marteau max <b>${l.marteauMax ? eur(l.marteauMax) : '—'}</b></span><label>revente <input inputmode="numeric" placeholder="€" value="${l.revente || ''}" data-revente="${l.id}" aria-label="Prix de revente visé"></label></div>
    ${l.statut === 'nouveau' || l.statut === 'invendu' ? `<div class="acts"><button class="btn sm" data-act="lot.suivre" data-id="${l.id}">Suivre</button><button class="btn sm o" data-act="lot.ignorer" data-id="${l.id}">Ignorer</button><a class="btn sm o" href="${esc(l.url)}" target="_blank" rel="noopener">Voir ↗</a></div>` : ''}
    ${l.statut === 'suivi' && passe && !l.itemId ? `<div class="acts"><button class="btn sm ok" data-open="lot" data-id="${l.id}">J'ai gagné</button><button class="btn sm o" data-act="lot.perdu" data-id="${l.id}">Perdu</button></div>` : ''}
  </article>`;
}

function vVeille() {
  const all = lots();
  const cnt = (st) => all.filter((l) => (st === 'tous' ? !['ignore', 'perdu'].includes(l.statut) : l.statut === st)).length;
  const tags = [...new Set(all.map((l) => l.tag))];
  const q = f.q.toLowerCase();
  const list = all.filter((l) => (f.veille === 'tous' ? !['ignore', 'perdu'].includes(l.statut) : l.statut === f.veille))
    .filter((l) => f.kind === 'tous' || l.kind === f.kind).filter((l) => f.tag === 'tous' || l.tag === f.tag)
    .filter((l) => !q || (l.titre + l.etude + l.ville + l.marque).toLowerCase().includes(q))
    .sort((a, b) => (Date.parse(a.date) || 9e15) - (Date.parse(b.date) || 9e15));
  const chip = (key, val, label, n) => `<button class="chip ${f[key] === val ? 'on' : ''}" data-f="${key}" data-v="${esc(val)}">${esc(label)}${n != null ? `<sup>${n}</sup>` : ''}</button>`;
  return `<h1 class="h1">La <em>veille</em></h1><p class="lead">Interenchères, toutes les heures : art de la table et tableaux russes, en live, chrono et sur catalogue. Le marteau max applique ta règle (× ${S.settings.pricing.multHaut} au-dessus de ${S.settings.pricing.seuil} €, × ${S.settings.pricing.multBas} en dessous, frais compris).</p>
  <label class="srch">${icon('eye', 18)}<input type="search" placeholder="Baccarat, Sèvres, Lyon…" value="${esc(f.q)}" data-q></label>
  <div class="chips">${chip('veille', 'nouveau', 'Nouveaux', cnt('nouveau'))}${chip('veille', 'suivi', 'Suivis', cnt('suivi'))}${chip('veille', 'invendu', 'Invendus', cnt('invendu'))}${chip('veille', 'tous', 'Tous', cnt('tous'))}${chip('veille', 'ignore', 'Ignorés')}</div>
  <div class="chips" style="margin-top:8px">${chip('kind', 'tous', 'Tous types')}${chip('kind', 'live', 'Live')}${chip('kind', 'online', 'Chrono')}${chip('kind', 'classic', 'Catalogue')}${tags.map((t) => chip('tag', t, t)).join('')}${f.tag !== 'tous' ? chip('tag', 'tous', 'Toutes catégories') : ''}</div>
  <div class="list g2 sec" style="margin-top:16px">${list.length ? list.map(lotCard).join('') : '<div class="empty">Aucun lot ici pour l\'instant.</div>'}</div>`;
}

function vAgenda() {
  const l = lots().filter((x) => x.statut === 'suivi' && Date.parse(x.date) > Date.now() - 864e5).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const days = {};
  for (const x of l) (days[new Date(x.date).toLocaleDateString('fr-CA', { timeZone: TZ })] ||= []).push(x);
  const today = new Date().toLocaleDateString('fr-CA', { timeZone: TZ });
  return `<h1 class="h1">L'<em>agenda</em></h1><p class="lead">Les ventes de tes lots suivis. Le bot te rappelle ${S.settings.rappels.heures.map((h) => h + ' h').join(' et ')} avant, puis te demande si tu as gagné.</p>
  <div class="acts" style="padding:14px 0 0"><button class="btn sm o" data-act="ics">${icon('cal', 16)} Ajouter à mon calendrier (.ics)</button></div>
  <div class="sec">${Object.keys(days).length ? Object.entries(days).map(([d, xs]) => `<div class="day ${d === today ? 'today' : ''}"><div class="d"><b>${new Date(d + 'T12:00').getDate()}</b><span>${new Date(d + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', month: 'short' })}</span></div><div>${xs.map((x) => `<div class="slot" data-open="lot" data-id="${x.id}" role="button" tabindex="0"><time>${fheure(x.date)}</time>${x.photos[0] ? `<img src="${pic(x.photos[0])}" alt="">` : ''}<div class="body"><b style="-webkit-line-clamp:1">${esc(x.titre)}</b><div class="meta">${kindTag(x.kind)}<span>${esc(x.ville)}</span><span>max ${eur(x.marteauMax)}</span></div></div></div>`).join('')}</div></div>`).join('') : '<div class="empty">Aucune vente suivie à venir.</div>'}</div>`;
}

function itemCard(i) {
  const st = STAT_ITEM[i.statut] || [i.statut, ''];
  const ch = Object.entries(i.canaux || {}).map(([c, v]) => `<span class="tag ${STAT_CANAL[v.statut]?.[1] || ''}">${CANAUX[c]} · ${STAT_CANAL[v.statut]?.[0] || v.statut}</span>`).join('');
  return `<article class="card"><div class="row" data-open="item" data-id="${i.id}" role="button" tabindex="0">${thumb(i.photos[0])}<div class="body"><small>${esc(i.id)} · ${esc(i.marque || i.categorie)}</small><b>${esc(i.titre)}</b>
    <div class="meta"><span class="tag ${st[1]}">${st[0]}</span><span>coût ${eur(i.cout)}</span></div></div><span class="price">${i.vendu ? eur(i.vendu.prix) : i.prix ? eur(i.prix) : '—'}</span></div>
    ${i.statut === 'prix' ? `<div class="acts" style="display:block">${priceChips(i)}</div>` : ch ? `<div class="acts">${ch}</div>` : ''}</article>`;
}

function priceChips(i) {
  return `<div class="pchips">${propositions(i.cout, S.settings.pricing).map((p) => `<button class="pchip ${p.regle ? 'rule' : ''}" data-act="item.prix" data-id="${i.id}" data-prix="${p.prix}"><b>${eur(p.prix)}</b><span>× ${p.mult}${p.regle ? ' · règle' : ''}</span></button>`).join('')}</div>`;
}

function vStock() {
  const groups = { actifs: (i) => !['vendu', 'archive'].includes(i.statut), prix: (i) => i.statut === 'prix', en_ligne: (i) => i.statut === 'en_ligne', vendu: (i) => i.statut === 'vendu', archive: (i) => i.statut === 'archive' };
  const lab = { actifs: 'En stock', prix: 'Prix à fixer', en_ligne: 'En ligne', vendu: 'Vendues', archive: 'Retirées' };
  const all = items().sort((a, b) => b.creeLe.localeCompare(a.creeLe));
  const list = all.filter(groups[f.stock]);
  return `<h1 class="h1">Le <em>stock</em></h1><p class="lead">Chaque pièce achetée, son coût, son prix et où elle est publiée. Tu gardes la main sur le prix : rien ne part sans ton choix.</p>
  <div class="chips" style="margin-top:14px">${Object.keys(groups).map((k) => `<button class="chip ${f.stock === k ? 'on' : ''}" data-f="stock" data-v="${k}">${lab[k]}<sup>${all.filter(groups[k]).length}</sup></button>`).join('')}</div>
  <div class="acts" style="padding:12px 0 0"><button class="btn sm" data-open="new">+ Ajouter un achat</button></div>
  <div class="list g2 sec" style="margin-top:14px">${list.length ? list.map(itemCard).join('') : '<div class="empty">Aucune pièce ici.</div>'}</div>`;
}

function orderCard(o) {
  const i = S.items[o.itemId] || {};
  const idx = ['livraison_a_choisir', 'a_preparer', 'expediee', 'terminee'].indexOf(o.statut === 'remise' ? 'terminee' : o.statut);
  return `<article class="card"><div class="row" data-open="order" data-id="${o.id}" role="button" tabindex="0">${thumb(i.photos?.[0])}<div class="body"><small>${esc(o.id)} · ${esc(CANAUX[o.canal] || o.canal)} · ${esc(fdate(o.creeLe))}</small><b>${esc(i.titre)}</b>
    <div class="meta"><span>${esc(o.acheteur || 'Acheteur')}${o.ville ? ', ' + esc(o.ville) : ''}</span><span>${o.livraison ? esc(LIVRAISONS[o.livraison]) : ''}</span></div>
    <div class="steps">${[0, 1, 2, 3].map((n) => `<i class="${n <= idx ? 'on' : ''}"></i>`).join('')}</div><div class="meta"><span class="tag ${o.statut === 'livraison_a_choisir' ? 'warn' : o.statut === 'terminee' || o.statut === 'remise' ? 'ok' : ''}">${STAT_CMD[o.statut]}</span><span>marge ${eur(o.prix - (i.cout || 0))}</span></div></div><span class="price">${eur(o.prix)}</span></div>
    ${o.statut === 'livraison_a_choisir' ? `<div class="acts">${livraisonBtns(o)}</div>` : ''}</article>`;
}
const livraisonBtns = (o) => Object.entries(LIVRAISONS).filter(([k]) => k !== 'ebay' || o.canal === 'ebay').map(([k, v]) => `<button class="btn sm ${k === 'cocolis' ? '' : 'o'}" data-act="commande.livraison" data-id="${o.id}" data-livraison="${k}">${esc(v)}</button>`).join('');

function vVentes() {
  const open = (o) => !['terminee', 'remise', 'annulee'].includes(o.statut);
  const list = orders().filter((o) => (f.ventes === 'ouvertes' ? open(o) : !open(o)));
  return `<h1 class="h1">Les <em>ventes</em></h1><p class="lead">Chaque vente (site, eBay, Leboncoin) arrive ici et sur Telegram. Les autres annonces sont retirées aussitôt. C'est toi qui choisis la livraison : Cocolis, colis, retrait à Lyon ou Annecy, ou remise en main propre.</p>
  <div class="chips" style="margin-top:14px"><button class="chip ${f.ventes === 'ouvertes' ? 'on' : ''}" data-f="ventes" data-v="ouvertes">En cours<sup>${orders().filter(open).length}</sup></button><button class="chip ${f.ventes === 'faites' ? 'on' : ''}" data-f="ventes" data-v="faites">Terminées<sup>${orders().filter((o) => !open(o)).length}</sup></button></div>
  <div class="list g2 sec" style="margin-top:14px">${list.length ? list.map(orderCard).join('') : '<div class="empty">Aucune vente ici. Pour une vente hors ligne, ouvre la pièce dans le stock puis « Vendue ».</div>'}</div>`;
}

function vReglages() {
  const p = S.settings.pricing, v = S.settings.veille, c = S.status.services.config || {};
  const svc = (ok, nom, txt) => `<div class="chan"><span><b>${nom}</b><br><small class="dim">${txt}</small></span><span class="tag ${ok ? 'ok' : 'warn'}">${ok ? 'Connecté' : 'À configurer'}</span></div>`;
  return `<h1 class="h1"><em>Réglages</em></h1>
  <section class="sec card" style="padding:4px 16px">
    ${svc(S.status.services.interencheres?.ok, 'Interenchères', S.status.services.interencheres ? `${S.status.services.interencheres.vus ?? 0} lots vus au dernier passage` : 'Pas encore lancée')}
    ${svc(c.telegram && S.tg.chatId, 'Telegram', S.tg.chatId ? 'Relié à ' + esc(S.tg.nom || 'ton compte') : c.telegram ? 'Envoie /start au bot pour le relier' : 'Ajoute TELEGRAM_BOT_TOKEN dans les secrets GitHub')}
    ${svc(c.ebay, 'eBay', c.ebay ? 'Publication et ventes synchronisées' : 'Clés eBay à ajouter (voir le guide)')}
    ${svc(true, 'Site', 'echosdessiecles.fr, mis à jour à chaque publication')}
    ${svc(c.leboncoin, 'Leboncoin', 'Mode assisté : annonce prête à coller envoyée sur Telegram')}
    ${svc(c.ia, 'Rédaction IA', c.ia ? 'Annonces rédigées par Claude' : 'Facultatif : ajoute ANTHROPIC_API_KEY')}
    <div class="acts" style="padding:12px 0"><button class="btn sm" data-act="run">${icon('bolt', 16)} Lancer le moteur maintenant</button><a class="btn sm o" href="https://github.com/${esc(cfg.repo || DEFAULT_REPO)}/actions" target="_blank" rel="noopener">Historique ↗</a></div>
  </section>
  <section class="sec"><div class="sech"><h2>Règle de <em>prix</em></h2></div>
    <form class="card stack" style="padding:16px" data-form="pricing">
      <div class="inrow"><label class="f">Seuil<div class="eur"><input class="in" name="seuil" inputmode="numeric" value="${p.seuil}"></div></label><label class="f">Au-dessus ×<input class="in" name="multHaut" inputmode="decimal" value="${p.multHaut}"></label><label class="f">En dessous ×<input class="in" name="multBas" inputmode="decimal" value="${p.multBas}"></label></div>
      <div class="inrow"><label class="f">Frais acheteur par défaut (%)<input class="in" name="fraisDefaut" inputmode="decimal" value="${p.fraisDefaut}"></label><label class="f">Supplément Live (%)<input class="in" name="fraisLive" inputmode="decimal" value="${p.fraisLive}"></label></div>
      <p class="dim" style="font-size:13px">Exemple : marteau 1 000 € → coût ${eur(coutRevient(1000, p.fraisDefaut + p.fraisLive))} → prix conseillé ${eur(prixConseille(coutRevient(1000, p.fraisDefaut + p.fraisLive), p))}. Marteau 30 € → ${eur(prixConseille(coutRevient(30, p.fraisDefaut), p))}.</p>
      <button class="btn">Enregistrer</button>
    </form>
  </section>
  <section class="sec"><div class="sech"><h2>Recherches de la <em>veille</em></h2></div>
    <div class="card" style="padding:4px 16px">${v.requetes.map((r) => `<div class="tog"><span>${esc(r.q)}<small>${esc(r.tag)}</small></span><span style="display:flex;gap:10px;align-items:center"><button class="ib" data-act="req.del" data-id="${r.id}" aria-label="Supprimer">${icon('x', 14)}</button><input type="checkbox" class="sw" data-act="req.toggle" data-id="${r.id}" ${r.actif ? 'checked' : ''} aria-label="Active"></span></div>`).join('')}</div>
    <form class="inrow" style="margin-top:10px" data-form="req"><input class="in" name="q" placeholder="ex. Haviland service" required><select class="in" name="tag" style="max-width:42%"><option>Art de la table</option><option>Tableaux russes</option><option>Autre</option></select><button class="btn">+</button></form>
    <form class="stack" style="margin-top:14px" data-form="veille">
      <label class="f">Mots exclus (séparés par des virgules)<input class="in" name="exclus" value="${esc(v.exclus.join(', '))}"></label>
      <div class="card" style="padding:4px 16px">
        ${['live', 'online', 'classic'].map((k) => `<label class="tog"><span>${KIND[k][0]}<small>${k === 'live' ? 'enchères en direct' : k === 'online' ? 'enchères chronométrées' : 'vente en salle, ordre d\'achat'}</small></span><input type="checkbox" class="sw" name="t_${k}" ${v.types[k] ? 'checked' : ''}></label>`).join('')}
        <label class="tog"><span>Alerte Telegram pour chaque nouveau lot</span><input type="checkbox" class="sw" name="alerteNouveaux" ${v.alerteNouveaux ? 'checked' : ''}></label>
      </div>
      <div class="inrow"><label class="f">Estimation mini (€)<input class="in" name="estimationMin" inputmode="numeric" value="${v.estimationMin || 0}"></label><label class="f">Horizon (jours)<input class="in" name="joursMax" inputmode="numeric" value="${v.joursMax}"></label><label class="f">Rappels (h avant)<input class="in" name="rappels" value="${S.settings.rappels.heures.join(', ')}"></label></div>
      <button class="btn">Enregistrer la veille</button>
    </form>
  </section>
  <section class="sec"><div class="sech"><h2>Où <em>publier</em></h2></div>
    <form class="card" style="padding:4px 16px" data-form="canaux">${Object.entries(CANAUX).map(([k, n]) => `<label class="tog"><span>${n}</span><input type="checkbox" class="sw" name="${k}" ${S.settings.canaux[k] ? 'checked' : ''}></label>`).join('')}<div style="padding:12px 0"><button class="btn sm">Enregistrer</button></div></form>
  </section>
  <section class="sec"><div class="sech"><h2><em>Journal</em></h2></div>
    <div class="card log" style="padding:14px">${S.log.slice(0, 40).map((l) => `<div class="${l.level}"><span class="dim">${esc(fdate(l.t, { day: '2-digit', month: '2-digit' }))} ${fheure(l.t)}</span><span>${esc(l.msg)}</span></div>`).join('') || '<span class="dim">Vide</span>'}</div>
  </section>
  <section class="sec acts" style="padding:0"><button class="btn o sm" data-act="theme">Thème clair / sombre</button><button class="btn o sm" data-act="logout">Se déconnecter</button></section>`;
}

/* ================= tiroirs ================= */
function openSheet(html) { $('#sheet').innerHTML = `<div class="grab"></div><button class="ib x" data-act="close" aria-label="Fermer">${icon('x', 16)}</button>${html}`; document.body.classList.add('open'); $('#sheet').scrollTop = 0; }
function closeSheet() { document.body.classList.remove('open'); }
const gal = (ph) => (ph?.length ? `<div class="gal">${ph.map((p) => `<img src="${pic(p)}" alt="">`).join('')}</div>` : '');

function sheetLot(id) {
  const l = S.lots[id]; if (!l) return;
  const frais = fraisLot(l, S.settings.pricing);
  const passe = Date.parse(l.date) < Date.now();
  openSheet(`${gal(l.photos)}<small class="mono" style="color:var(--acc)">${esc(l.tag)} · lot ${l.numero ?? '—'}</small><h2 style="font-size:22px;letter-spacing:-.02em;margin:6px 0">${esc(l.titre)}</h2>
    <div class="meta">${kindTag(l.kind)}<span>${esc(l.etude)}</span><span>${esc(l.ville)} ${esc(l.cp)}</span></div>
    <dl class="kv"><dt>Vente</dt><dd>${esc(fdate(l.date, { weekday: 'long', day: 'numeric', month: 'long' }))} à ${fheure(l.date)} (${esc(dans(l.date))})</dd><dt>Estimation</dt><dd>${eur(l.estMin)} – ${eur(l.estMax)}</dd><dt>Frais acheteur</dt><dd>${frais.toFixed(1)} %</dd>${l.depart ? `<dt>Mise à prix</dt><dd>${eur(l.depart)}</dd>` : ''}<dt>Livraison par l'étude</dt><dd>${l.livraison ? 'oui' : 'non / à voir'}</dd></dl>
    <div class="card" style="padding:14px;background:var(--acc-soft);border:0;color:var(--acc)"><b>🎯 Marteau max : ${l.marteauMax ? eur(l.marteauMax) : 'indique la revente visée'}</b>
      <label class="f" style="margin-top:10px;color:inherit">Je pense revendre<div class="eur"><input class="in" inputmode="numeric" value="${l.revente || ''}" data-revente="${l.id}"></div></label></div>
    <p class="dim" style="font-size:14px;margin:12px 0;white-space:pre-line">${esc(l.description)}</p>
    ${l.statut === 'invendu' ? `<div class="card" style="padding:14px;margin-bottom:12px"><b>Lot peut-être invendu</b><p class="dim" style="font-size:14px">Appelle l'étude pour faire une offre après-vente.</p><div class="acts" style="padding:10px 0 0">${l.contact?.tel ? `<a class="btn sm" href="tel:${esc(l.contact.tel)}">Appeler</a>` : ''}${l.contact?.email ? `<a class="btn sm o" href="mailto:${esc(l.contact.email)}">Écrire</a>` : ''}</div></div>` : ''}
    <div class="stack">
      ${l.itemId ? `<button class="btn full" data-open="item" data-id="${l.itemId}">Voir la pièce en stock ›</button>` : `
      <form class="card" style="padding:14px" data-form="gagne" data-id="${l.id}"><b>${passe ? 'Tu l\'as remporté ?' : 'Déjà remporté ?'}</b><p class="dim" style="font-size:13.5px;margin:4px 0 10px">Indique le prix au marteau : la pièce part en stock avec ses photos et je te propose un prix de vente.</p><div class="inrow"><div class="eur" style="flex:1"><input class="in" name="marteau" inputmode="numeric" placeholder="Prix au marteau" required></div><button class="btn ok">Gagné</button></div></form>`}
      <div class="acts" style="padding:0">${l.statut !== 'suivi' ? `<button class="btn" data-act="lot.suivre" data-id="${l.id}">Suivre</button>` : ''}${l.statut !== 'ignore' ? `<button class="btn o" data-act="lot.ignorer" data-id="${l.id}">Ignorer</button>` : ''}${passe && !l.itemId ? `<button class="btn o" data-act="lot.perdu" data-id="${l.id}">Perdu</button>` : ''}<a class="btn o" href="${esc(l.url)}" target="_blank" rel="noopener">Voir sur Interenchères ↗</a></div>
    </div>`);
}

function sheetItem(id) {
  const i = S.items[id]; if (!i) return;
  const st = STAT_ITEM[i.statut];
  const a = i.annonce || {};
  const lbc = i.canaux?.leboncoin;
  openSheet(`${gal(i.photos)}<small class="mono" style="color:var(--acc)">${esc(i.id)} · ${esc(i.marque || i.categorie)}</small><h2 style="font-size:22px;letter-spacing:-.02em;margin:6px 0">${esc(a.titre || i.titre)}</h2>
    <div class="meta"><span class="tag ${st[1]}">${st[0]}</span>${i.lotId ? '<span>Interenchères</span>' : ''}<span>ajoutée ${esc(fdate(i.creeLe))}</span></div>
    <dl class="kv"><dt>Marteau</dt><dd>${eur(i.marteau)}</dd><dt>Frais</dt><dd>${i.frais} %</dd><dt>Coût de revient</dt><dd><b>${eur(i.cout)}</b></dd><dt>Prix conseillé</dt><dd>${eur(i.prixConseille)}</dd>${i.prix ? `<dt>Prix de vente</dt><dd><b>${eur(i.prix)}</b> (marge ${eur(i.prix - i.cout)})</dd>` : ''}${i.vendu ? `<dt>Vendue</dt><dd>${eur(i.vendu.prix)} · ${esc(CANAUX[i.vendu.canal] || i.vendu.canal)} · ${esc(fdate(i.vendu.le))}</dd>` : ''}</dl>
    ${i.statut !== 'vendu' && i.statut !== 'archive' ? `
    <section class="stack"><b>Prix</b>${priceChips(i)}
      <form class="inrow" data-form="prix" data-id="${i.id}"><div class="eur" style="flex:1"><input class="in" name="prix" inputmode="numeric" placeholder="Autre prix" value="${i.prix || ''}"></div><button class="btn">Valider</button></form>
      <label class="tog card" style="padding:12px 14px"><span>Retrait possible à Lyon / Annecy<small>sinon : envoi uniquement</small></span><input type="checkbox" class="sw" data-act="item.retrait" data-id="${i.id}" ${i.retrait ? 'checked' : ''}></label>
      ${i.prix && i.statut !== 'en_ligne' ? `<button class="btn acc full" data-act="item.publier" data-id="${i.id}">${icon('bolt', 18)} Publier sur ${Object.keys(CANAUX).filter((c) => S.settings.canaux[c]).map((c) => CANAUX[c]).join(', ')}</button>` : ''}
    </section>` : ''}
    ${Object.keys(i.canaux || {}).length ? `<section class="sec" style="margin-top:20px"><b>Annonces</b>${Object.entries(i.canaux).map(([c, v]) => `<div class="chan"><span>${CANAUX[c]}${v.err ? `<br><small class="err">${esc(v.err)}</small>` : ''}</span><span style="display:flex;gap:8px;align-items:center">${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener" class="dim">voir ↗</a>` : ''}<span class="tag ${STAT_CANAL[v.statut]?.[1] || ''}">${STAT_CANAL[v.statut]?.[0] || v.statut}</span></span></div>`).join('')}</section>` : ''}
    ${lbc && lbc.statut !== 'en_ligne' && i.statut === 'en_ligne' ? `<section class="card sec" style="padding:14px;margin-top:16px"><b>Leboncoin, prêt à coller</b><p class="dim" style="font-size:13.5px;margin:4px 0 10px">Ouvre l'app Leboncoin › Déposer une annonce, copie, colle, puis confirme ici.</p><div class="acts" style="padding:0"><button class="btn sm o" data-copy="titre">Copier le titre</button><button class="btn sm o" data-copy="desc">Copier la description</button><button class="btn sm o" data-copy="prix">Copier le prix</button><a class="btn sm o" href="https://www.leboncoin.fr/deposer-une-annonce" target="_blank" rel="noopener">Leboncoin ↗</a></div><button class="btn ok full" style="margin-top:10px" data-act="item.canal" data-id="${i.id}">C'est publié sur Leboncoin</button></section>` : ''}
    <details class="sec" style="margin-top:20px"><summary style="cursor:pointer;font-weight:600">Modifier le texte</summary>
      <form class="stack" style="margin-top:12px" data-form="texte" data-id="${i.id}"><label class="f">Titre<input class="in" name="titre" value="${esc(a.titre || i.titre)}"></label><label class="f">Marque / manufacture<input class="in" name="marque" value="${esc(i.marque)}"></label><label class="f">Catégorie<select class="in" name="categorie">${['Cristal', 'Porcelaine', 'Argenterie', 'Objets', 'Tableaux'].map((c) => `<option ${c === (a.categorie || i.categorie) ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label class="f">Description<textarea class="in" name="description">${esc(a.description || i.description)}</textarea></label><button class="btn">Enregistrer</button></form>
    </details>
    ${i.statut !== 'vendu' && i.statut !== 'archive' ? `<section class="sec stack" style="margin-top:20px"><b>Vendue ?</b><p class="dim" style="font-size:13.5px">Je retire aussitôt les autres annonces.</p><div class="acts" style="padding:0">${Object.entries({ ...CANAUX, autre: 'Autre / en direct' }).map(([k, n]) => `<button class="btn sm o" data-act="item.vendu" data-id="${i.id}" data-canal="${k}">${n}</button>`).join('')}</div>
      ${i.statut === 'en_ligne' ? `<button class="btn o sm" style="justify-self:start" data-act="item.retirer" data-id="${i.id}">Retirer de la vente</button>` : ''}</section>` : ''}`);
}

function sheetOrder(id) {
  const o = S.orders[id]; if (!o) return;
  const i = S.items[o.itemId] || {};
  openSheet(`${gal(i.photos?.slice(0, 2))}<small class="mono" style="color:var(--acc)">${esc(o.id)} · ${esc(CANAUX[o.canal] || o.canal)}</small><h2 style="font-size:22px;letter-spacing:-.02em;margin:6px 0">${esc(i.titre)}</h2>
    <dl class="kv"><dt>Prix</dt><dd><b>${eur(o.prix)}</b></dd><dt>Marge</dt><dd>${eur(o.prix - (i.cout || 0))}</dd><dt>Acheteur</dt><dd>${esc(o.acheteur || '—')}${o.ville ? ', ' + esc(o.ville) : ''}</dd><dt>Date</dt><dd>${esc(fdate(o.creeLe))} ${fheure(o.creeLe)}</dd><dt>Statut</dt><dd>${STAT_CMD[o.statut]}</dd>${o.livraison ? `<dt>Livraison</dt><dd>${esc(LIVRAISONS[o.livraison])}</dd>` : ''}${o.suivi ? `<dt>Suivi</dt><dd>${esc(o.suivi)}</dd>` : ''}</dl>
    <section class="stack"><b>Livraison</b><div class="acts" style="padding:0">${livraisonBtns(o)}</div>
    ${o.livraison === 'cocolis' ? `<a class="btn o" href="https://www.cocolis.fr/" target="_blank" rel="noopener">Créer l'envoi sur Cocolis ↗</a>` : ''}</section>
    <form class="stack sec" style="margin-top:20px" data-form="commande" data-id="${o.id}"><b>Suivi</b>
      <label class="f">Statut<select class="in" name="statut">${STATUTS_COMMANDE.map((s) => `<option value="${s}" ${s === o.statut ? 'selected' : ''}>${STAT_CMD[s]}</option>`).join('')}</select></label>
      <label class="f">N° de suivi ou rendez-vous<input class="in" name="suivi" value="${esc(o.suivi || '')}"></label>
      <label class="f">Note (échanges avec l'acheteur)<textarea class="in" name="note" style="min-height:80px">${esc(o.note || '')}</textarea></label>
      <button class="btn">Enregistrer</button></form>`);
}

function sheetNew() {
  openSheet(`<h2 class="h1" style="font-size:34px">Un <em>achat</em></h2><p class="lead">Pour un achat hors veille (autre salle, brocante). Tu peux aussi envoyer au bot : /achat 120 Verres de Sèvres, avec les photos.</p>
    <form class="stack sec" data-form="new"><label class="f">Titre<input class="in" name="titre" required placeholder="Verres à cognac de Sèvres"></label><div class="inrow"><label class="f">Prix au marteau<div class="eur"><input class="in" name="marteau" inputmode="numeric" required></div></label><label class="f">Frais (%)<input class="in" name="frais" inputmode="decimal" value="${S.settings.pricing.fraisDefaut}"></label></div>
    <label class="f">Marque / manufacture<input class="in" name="marque"></label><label class="f">Catégorie<select class="in" name="categorie"><option>Cristal</option><option>Porcelaine</option><option>Argenterie</option><option>Objets</option><option>Tableaux</option></select></label>
    <label class="f">Description<textarea class="in" name="description"></textarea></label><p class="dim" style="font-size:13px">Photos : envoie-les au bot Telegram avec la référence de la pièce en légende.</p><button class="btn">Ajouter au stock</button></form>`);
}

/* ================= événements ================= */
function render() {
  if (!S) return;
  const v = curView();
  $('#root').innerHTML = shell(VIEWS[v].r());
  document.title = `${VIEWS[v].t} · Échos admin`;
}

function ics() {
  const l = lots().filter((x) => x.statut === 'suivi' && Date.parse(x.date) > Date.now());
  const d = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const e = (s) => String(s).replace(/[,;\\]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Echos des siecles//Admin//FR', ...l.flatMap((x) => ['BEGIN:VEVENT', `UID:${x.id}@echosdessiecles.fr`, `DTSTAMP:${d(new Date().toISOString())}`, `DTSTART:${d(x.date)}`, `DTEND:${d(new Date(Date.parse(x.date) + 3600e3).toISOString())}`, `SUMMARY:${e('Enchère · ' + x.titre.slice(0, 60))}`, `LOCATION:${e(x.etude + ' ' + x.ville)}`, `DESCRIPTION:${e(`Marteau max ${x.marteauMax || '?'} €\n${x.url}`)}`, 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Vente dans 2 h', 'END:VALARM', 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  a.download = 'echos-ventes.ics';
  a.click();
}

const num = (v) => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-open],[data-f],[data-copy]');
  if (!t || t.matches('input[type=checkbox]')) return;
  if (t.dataset.f) { f[t.dataset.f] = t.dataset.v; render(); return; }
  if (t.dataset.copy) {
    const i = S.items[$('#sheet [data-form=texte]')?.dataset.id];
    const a = i?.annonce || {};
    const txt = { titre: a.titre || i?.titre, desc: (a.description || i?.description || '') + (i?.retrait ? '\n\nRemise en main propre possible à Lyon et Annecy.' : ''), prix: String(i?.prix || '') }[t.dataset.copy];
    try { await navigator.clipboard.writeText(txt); toast('Copié'); } catch { toast('Copie impossible'); }
    return;
  }
  if (t.dataset.open) {
    e.preventDefault();
    ({ lot: sheetLot, item: sheetItem, order: sheetOrder, new: sheetNew })[t.dataset.open](t.dataset.id);
    return;
  }
  const a = t.dataset.act, id = t.dataset.id;
  if (a === 'close') return closeSheet();
  if (a === 'logout') { e.preventDefault(); cfg = { repo: cfg.repo }; saveCfg(); S = null; mode = null; closeSheet(); return showLogin(); }
  if (a === 'reload') { if (mode === 'live') { try { await loadRemote(); render(); toast('À jour'); } catch (err) { setSync('err', err.message); } } return; }
  if (a === 'theme') { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(LS + '-theme', r.dataset.theme); } catch {} return; }
  if (a === 'ics') return ics();
  if (a === 'run') { if (mode === 'demo') return toast('Démo : rien n\'est lancé'); try { await dispatch(true); toast('Moteur lancé, veille comprise'); } catch (err) { toast(err.message); } return; }
  if (a === 'req.del') return act({ type: 'reglages', patch: { veille: { requetes: S.settings.veille.requetes.filter((r) => r.id !== id) } } }, 'Recherche supprimée');
  const map = {
    'lot.suivre': [{ type: a, id }, 'Lot suivi, rappel avant la vente'],
    'lot.ignorer': [{ type: a, id }, 'Lot ignoré'],
    'lot.perdu': [{ type: a, id }, 'Noté'],
    'item.prix': [{ type: a, id, prix: +t.dataset.prix }, `Prix fixé à ${eur(+t.dataset.prix)}`],
    'item.publier': [{ type: a, id }, 'Publication lancée'],
    'item.retirer': [{ type: a, id }, 'Retirée de la vente'],
    'item.vendu': [{ type: a, id, canal: t.dataset.canal }, 'Vente enregistrée, annonces retirées'],
    'item.canal': [{ type: a, id, channel: 'leboncoin', statut: 'en_ligne' }, 'Leboncoin marqué publié'],
    'commande.livraison': [{ type: a, id, livraison: t.dataset.livraison }, LIVRAISONS[t.dataset.livraison]],
  };
  if (map[a]) {
    const ok = await act(map[a][0], map[a][1]);
    if (ok && document.body.classList.contains('open')) {
      if (a.startsWith('item.')) { a === 'item.vendu' ? sheetOrder(Object.keys(S.orders).at(-1)) : sheetItem(id); }
      else if (a.startsWith('lot.')) closeSheet();
      else if (a.startsWith('commande.')) sheetOrder(id);
    }
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.revente) { const r = num(t.value); act({ type: 'lot.revente', id: t.dataset.revente, revente: r }, r ? 'Marteau max recalculé' : 'Revente effacée').then(() => { if (document.body.classList.contains('open')) sheetLot(t.dataset.revente); }); }
  if (t.dataset.act === 'item.retrait') act({ type: 'item.retrait', id: t.dataset.id, retrait: t.checked }, t.checked ? 'Retrait possible' : 'Envoi uniquement');
  if (t.dataset.act === 'req.toggle') act({ type: 'reglages', patch: { veille: { requetes: S.settings.veille.requetes.map((r) => (r.id === t.dataset.id ? { ...r, actif: t.checked } : r)) } } }, t.checked ? 'Recherche active' : 'Recherche en pause');
});
document.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { f.q = e.target.value; clearTimeout(f.t); f.t = setTimeout(() => { render(); const i = $('[data-q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); if (e.key === 'Enter' && e.target.matches('[role=button]')) e.target.click(); });
$('#scrim').addEventListener('click', closeSheet);

document.addEventListener('submit', async (e) => {
  const form = e.target; if (!form.dataset.form) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form));
  const id = form.dataset.id;
  switch (form.dataset.form) {
    case 'login': return doLogin(fd, form);
    case 'gagne': if (await act({ type: 'lot.gagne', id, marteau: num(fd.marteau) }, 'Bravo ! Pièce ajoutée au stock')) { const it = S.lots[id]?.itemId; it ? sheetItem(it) : closeSheet(); } return;
    case 'prix': if (await act({ type: 'item.prix', id, prix: num(fd.prix) }, `Prix fixé à ${eur(num(fd.prix))}`)) sheetItem(id); return;
    case 'texte': if (await act({ type: 'item.modifier', id, titre: fd.titre, marque: fd.marque, categorie: fd.categorie, description: fd.description, annonce: { ...(S.items[id].annonce || {}), titre: fd.titre, description: fd.description, categorie: fd.categorie, marque: fd.marque } }, 'Texte enregistré')) sheetItem(id); return;
    case 'commande': if (await act({ type: 'commande.statut', id, statut: fd.statut, suivi: fd.suivi, note: fd.note }, 'Commande mise à jour')) sheetOrder(id); return;
    case 'new': if (await act({ type: 'item.creer', titre: fd.titre, marteau: num(fd.marteau), frais: num(fd.frais), marque: fd.marque, categorie: fd.categorie, description: fd.description }, 'Achat ajouté')) { closeSheet(); location.hash = '#stock'; } return;
    case 'pricing': return act({ type: 'reglages', patch: { pricing: Object.fromEntries(Object.entries(fd).map(([k, v]) => [k, num(v)])) } }, 'Règle de prix enregistrée');
    case 'req': form.reset(); return act({ type: 'reglages', patch: { veille: { requetes: [...S.settings.veille.requetes, { id: 'r' + Date.now().toString(36), q: fd.q.trim(), tag: fd.tag, actif: true }] } } }, 'Recherche ajoutée');
    case 'veille': return act({ type: 'reglages', patch: { veille: { exclus: fd.exclus.split(',').map((s) => s.trim()).filter(Boolean), types: { live: !!fd.t_live, online: !!fd.t_online, classic: !!fd.t_classic }, alerteNouveaux: !!fd.alerteNouveaux, estimationMin: num(fd.estimationMin) || 0, joursMax: num(fd.joursMax) || 45 }, rappels: { heures: fd.rappels.split(',').map(num).filter((n) => n > 0) } } }, 'Veille enregistrée');
    case 'canaux': return act({ type: 'reglages', patch: { canaux: { site: !!fd.site, ebay: !!fd.ebay, leboncoin: !!fd.leboncoin } } }, 'Canaux enregistrés');
  }
});

addEventListener('hashchange', () => { closeSheet(); render(); scrollTo(0, 0); });

/* ================= connexion ================= */
function showLogin(err = '') {
  $('#root').innerHTML = `<div class="login"><div class="box">
    <a class="logo"><svg width="34" height="34"><use href="#m-plate"/></svg><span>échos des siècles</span></a>
    <h1 class="h1">L'<em>atelier</em>,<br>en coulisses.</h1>
    <p class="lead">Veille Interenchères, prix, annonces, ventes et livraisons. Accès réservé.</p>
    <form data-form="login">
      <label class="f">Phrase secrète<input class="in" name="pass" type="password" autocomplete="current-password" required minlength="12"></label>
      <label class="f">Jeton GitHub<input class="in" name="token" type="password" autocomplete="off" required value="${esc(cfg.token || '')}" placeholder="github_pat_…"></label>
      <details><summary class="dim" style="font-size:13.5px;cursor:pointer">Options</summary><label class="f" style="margin-top:10px">Dépôt<input class="in" name="repo" value="${esc(cfg.repo || DEFAULT_REPO)}"></label></details>
      <label class="tog" style="border:0;padding:4px 0"><span>Rester connecté sur cet appareil</span><input type="checkbox" class="sw" name="remember" checked></label>
      ${err ? `<p class="err">${esc(err)}</p>` : ''}
      <button class="btn full">Entrer</button>
    </form>
    <div class="alt"><button class="btn o full" data-demo>Voir la démo</button></div>
    <p class="dim" style="font-size:12.5px;margin-top:16px">Tes données restent chiffrées : seule ta phrase secrète permet de les lire, et elle ne quitte jamais cet appareil.</p>
  </div></div>`;
  $('[data-demo]').onclick = () => { mode = 'demo'; S = demoState(); render(); };
}

async function doLogin(fd, form) {
  cfg = { repo: (fd.repo || DEFAULT_REPO).trim(), token: fd.token.trim(), pass: fd.pass, remember: !!fd.remember };
  form.querySelector('button').disabled = true;
  try { await loadRemote(); mode = 'live'; saveCfg(); render(); }
  catch (e) { form.querySelector('button').disabled = false; showLogin(e.message); }
}

/* ================= démarrage ================= */
try { const th = localStorage.getItem(LS + '-theme'); if (th) document.documentElement.dataset.theme = th; } catch {}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  if (new URLSearchParams(location.search).has('demo')) { mode = 'demo'; S = demoState(); return render(); }
  if (cfg.token && cfg.pass) {
    try { await loadRemote(); mode = 'live'; return render(); } catch (e) { return showLogin(e.message); }
  }
  showLogin();
})();
// Rafraîchit quand on revient sur l'appli (téléphone).
document.addEventListener('visibilitychange', () => { if (!document.hidden && mode === 'live') loadRemote().then(render).catch(() => {}); });
