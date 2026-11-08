// Échos · Console — l'admin d'Échos des siècles : https://echosdessiecles.fr/admin/
// Lit l'état chiffré du dépôt GitHub, le déchiffre dans le navigateur avec la
// phrase secrète, et envoie chaque action comme un petit fichier chiffré
// (data/inbox/) que le moteur applique au cycle suivant (lancé tout de suite).
// Les secrets du moteur (Telegram, eBay, IA…) se règlent aussi d'ici : ils sont
// chiffrés sur l'appareil (sealed box libsodium) avant d'être envoyés à GitHub.

import { applyCommand, normalize, emptyState, LIVRAISONS, CANAUX, STATUTS_COMMANDE } from '../engine/src/model.mjs';
import { propositions, marteauMax, fraisLot, coutRevient, prixConseille, multiple } from '../engine/src/pricing.mjs';
import { encryptJSON, decryptJSON } from '../engine/src/crypto.mjs';
import { demoState } from './demo.mjs';

/* ================= configuration ================= */
const LS = 'echos-admin-v1';
const THEME = 'echos-console-theme';
const DEFAULT_REPO = 'u8tscared/echos-des-siecles';
const WORKFLOW = 'moteur.yml';
const SITE = 'https://echosdessiecles.fr/';
let cfg = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
const saveCfg = () => { try { localStorage.setItem(LS, JSON.stringify(cfg.remember ? cfg : { repo: cfg.repo })); } catch {} };
const repo = () => cfg.repo || DEFAULT_REPO;

let S = null;          // état courant (déchiffré)
let mode = null;       // 'live' | 'demo'
let SEC = null;        // secrets GitHub : null (inconnu) | 'noperm' | { NOM: date }
let syncState = { k: 'ok', t: 'À jour' };
const f = { ench: 'veille', statut: 'nouveau', kind: 'tous', tag: 'tous', q: '', ventes: 'ouvertes', act: 'journal' };

/* ================= utilitaires ================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => (n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('fr-FR') + ' €');
const keur = (n) => (Math.abs(n) >= 10000 ? (n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k€' : eur(n));
const TZ = 'Europe/Paris';
const fdate = (iso, o = { weekday: 'short', day: 'numeric', month: 'short' }) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, ...o }) : '—');
const fheure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '');
function dans(iso, court = false) {
  const ms = Date.parse(iso) - Date.now();
  if (!isFinite(ms)) return '';
  const a = Math.abs(ms), d = Math.floor(a / 864e5), h = Math.floor((a % 864e5) / 36e5), m = Math.floor((a % 36e5) / 6e4);
  const s = d ? `${d} j${court ? '' : ' ' + h + ' h'}` : h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  return ms >= 0 ? (court ? s : 'dans ' + s) : 'il y a ' + s;
}
const depuis = (iso) => (iso ? dans(iso, true) : 'jamais');
const ago = (iso) => (iso ? dans(iso, true).replace('il y a ', '') : '—');
const minutes = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 6e4 : Infinity);
const icon = (id, s = 20) => `<svg width="${s}" height="${s}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const pill = (t, c = '', x = '') => `<span class="pill ${c} ${x}">${esc(t)}</span>`;
const KIND = { live: ['Live', 'red live'], online: ['Chrono', 'violet'], classic: ['Catalogue', 'blue'] };
const kindPill = (k) => pill(KIND[k]?.[0] || k, KIND[k]?.[1] || '');
const pic = (p) => (p ? esc(p.startsWith('http') || p.startsWith('../') ? p : '../' + p) : '');
const thumb = (p, cls = 'th') => (p ? `<img class="${cls}" src="${pic(p)}" alt="" loading="lazy">` : `<div class="${cls} ph0">${icon('img', 22)}</div>`);
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
function toast(msg, ok = true) { const t = $('#toast'); t.innerHTML = `${icon(ok ? 'check' : 'x', 16)}<span>${esc(msg)}</span>`; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2800); }

const STAT_ITEM = { prix: ['Prix à fixer', 'amber'], pret: ['Prête', 'blue'], en_ligne: ['En ligne', 'green'], reserve: ['Réservée', 'amber'], vendu: ['Vendue', 'gold'], archive: ['Retirée', ''] };
const STAT_CANAL = { en_ligne: ['En ligne', 'green'], a_publier: ['En cours', 'amber'], a_coller: ['À coller', 'amber'], file_claude: ['File Claude', 'violet'], erreur: ['Erreur', 'red'], non_configure: ['Non configuré', ''], vendu: ['Vendu', 'gold'], retire: ['Retiré', ''] };
const CH_CLS = { en_ligne: 'ok', vendu: 'ok', a_publier: 'wait', a_coller: 'wait', file_claude: 'wait', erreur: 'err' };
const STAT_CMD = { nouvelle: ['Nouvelle', 'blue'], livraison_a_choisir: ['Livraison à choisir', 'amber'], a_preparer: ['À préparer', 'violet'], expediee: ['Expédiée', 'blue'], remise: ['Remise', 'green'], terminee: ['Terminée', 'green'], annulee: ['Annulée', ''] };
const STAT_LOT = { nouveau: ['Nouveau', 'blue'], suivi: ['Suivi', 'violet'], ignore: ['Ignoré', ''], gagne: ['Gagné', 'green'], perdu: ['Perdu', ''], invendu: ['Invendu', 'gold'] };
const CATS = ['Cristal', 'Porcelaine', 'Argenterie', 'Objets', 'Tableaux'];

/* ================= GitHub ================= */
async function gh(p, opt = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo()}/${p}`, {
    ...opt,
    cache: 'no-store',
    headers: { authorization: `Bearer ${cfg.token}`, accept: opt.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(opt.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw new Error('Jeton GitHub refusé');
  return res;
}

async function loadRemote() {
  setSync('wait', 'Synchronisation…');
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
  setSync(enAttente ? 'wait' : 'ok', enAttente ? `${enAttente} action(s) en cours` : 'Synchronisé');
  loadSecrets().then(() => { if (curView() === 'connexions') render(); });
}

async function loadSecrets() {
  if (mode === 'demo') { SEC = { ECHOS_DATA_KEY: 1, TELEGRAM_BOT_TOKEN: 1, ANTHROPIC_API_KEY: 1, EBAY_CLIENT_ID: 1, EBAY_CLIENT_SECRET: 1, EBAY_REFRESH_TOKEN: 1 }; return; }
  try {
    const r = await gh('actions/secrets?per_page=100');
    if (r.status === 403 || r.status === 404) { SEC = 'noperm'; return; }
    if (!r.ok) return;
    SEC = Object.fromEntries((await r.json()).secrets.map((s) => [s.name, s.updated_at]));
  } catch {}
}

async function setSecret(name, value) {
  if (mode === 'demo') { SEC = { ...(SEC || {}), [name]: new Date().toISOString() }; return; }
  const k = await gh('actions/secrets/public-key');
  if (k.status === 403 || k.status === 404) throw new Error('Ton jeton n\'a pas la permission « Secrets » (lecture et écriture)');
  if (!k.ok) throw new Error('Clé GitHub introuvable (' + k.status + ')');
  const { key, key_id } = await k.json();
  const { sealBase64 } = await import('./vendor/sealbox.mjs');
  const r = await gh('actions/secrets/' + name, { method: 'PUT', body: JSON.stringify({ encrypted_value: sealBase64(value, key), key_id }) });
  if (!r.ok) throw new Error('GitHub a refusé le secret (' + r.status + ')');
  SEC = { ...(SEC && SEC !== 'noperm' ? SEC : {}), [name]: new Date().toISOString() };
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
  catch (e) { toast(e.message, false); return false; }
  S.jobs = S.jobs.filter((j) => j.type !== 'notify' || j.done); // les notifications partent du moteur
  render();
  if (mode === 'demo') { toast((okMsg || 'Fait') + ' · démo'); return true; }
  try {
    setSync('wait', 'Envoi…');
    const name = `data/inbox/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.enc`;
    const content = btoa(await encryptJSON(cmds, cfg.pass));
    const r = await gh('contents/' + name, { method: 'PUT', body: JSON.stringify({ message: 'Admin : ' + cmds.map((c) => c.type).join(', '), content, branch: 'main' }) });
    if (!r.ok) throw new Error('Envoi refusé (' + r.status + ')');
    clearTimeout(dispatchT);
    dispatchT = setTimeout(() => dispatch().catch(() => {}), 2500);
    setSync('wait', 'Le moteur applique…');
    toast(okMsg || 'Envoyé');
    return true;
  } catch (e) { setSync('err', e.message); toast(e.message, false); return false; }
}

function setSync(k, t) {
  syncState = { k, t };
  for (const el of document.querySelectorAll('[data-sync]')) el.innerHTML = syncHtml();
}
const syncHtml = () => `<i class="dot ${{ ok: '', wait: 'amber', err: 'red' }[syncState.k] || ''}"></i><span>${esc(mode === 'demo' ? 'Démo · ' + syncState.t : syncState.t)}</span>`;

/* ================= calculs ================= */
const items = () => Object.values(S.items);
const lots = () => Object.values(S.lots);
const orders = () => Object.values(S.orders).sort((a, b) => b.creeLe.localeCompare(a.creeLe));
const D = 864e5;
const ventesEntre = (a, b) => items().filter((i) => i.vendu && Date.parse(i.vendu.le) >= a && Date.parse(i.vendu.le) < b);
function kpis() {
  const t = Date.now();
  const cur = ventesEntre(t - 30 * D, t + D), prev = ventesEntre(t - 60 * D, t - 30 * D);
  const ca = cur.reduce((a, i) => a + (i.vendu.prix || 0), 0), caPrev = prev.reduce((a, i) => a + (i.vendu.prix || 0), 0);
  const mg = cur.reduce((a, i) => a + (i.vendu.prix || 0) - (i.cout || 0), 0);
  const enLigne = items().filter((i) => i.statut === 'en_ligne');
  const suivis = lots().filter((l) => l.statut === 'suivi' && Date.parse(l.date) > t).sort((a, b) => a.date.localeCompare(b.date));
  return { ca, caPrev, mg, nv: cur.length, enLigne: enLigne.length, valeur: enLigne.reduce((a, i) => a + (i.prix || 0), 0), suivis, nouveaux: lots().filter((l) => l.statut === 'nouveau').length };
}
/** Chiffre d'affaires et marge cumulés, jour par jour, sur `n` jours. */
function serie(n = 30) {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const start = t0.getTime() - (n - 1) * D;
  const ca = Array(n).fill(0), mg = Array(n).fill(0);
  for (const i of items()) {
    if (!i.vendu) continue;
    const k = Math.floor((Date.parse(i.vendu.le) - start) / D);
    if (k >= 0 && k < n) { ca[k] += i.vendu.prix || 0; mg[k] += (i.vendu.prix || 0) - (i.cout || 0); }
  }
  for (let k = 1; k < n; k++) { ca[k] += ca[k - 1]; mg[k] += mg[k - 1]; }
  return { ca, mg, start };
}
const lbcQueue = () => items().filter((i) => i.statut === 'en_ligne' && ['a_coller', 'file_claude'].includes(i.canaux?.leboncoin?.statut));
const lbcDelete = () => items().filter((i) => i.canaux?.leboncoin?.aSupprimer);
const jobsErr = () => S.jobs.filter((j) => !j.done && (j.err || j.tries >= 3));

function todos() {
  const t = [];
  const go = (k, id) => `data-open="${k}" data-id="${id}"`;
  for (const o of orders().filter((o) => o.statut === 'livraison_a_choisir')) t.push({ c: 'red', ico: 'truck', titre: 'Choisir la livraison', txt: `${S.items[o.itemId]?.titre || ''} · ${eur(o.prix)} · ${CANAUX[o.canal] || o.canal}`, a: go('order', o.id) });
  for (const i of items().filter((i) => i.statut === 'prix')) t.push({ c: 'amber', ico: 'euro', titre: 'Fixer le prix', txt: `${i.titre} · conseillé ${eur(i.prixConseille)}`, a: go('item', i.id) });
  for (const i of items().filter((i) => i.statut === 'pret')) t.push({ c: 'blue', ico: 'bolt', titre: 'Prête à publier', txt: `${i.titre} · ${eur(i.prix)}`, a: go('item', i.id) });
  for (const i of lbcQueue()) t.push({ c: 'violet', ico: 'box', titre: i.canaux.leboncoin.statut === 'file_claude' ? 'Leboncoin : en file pour Claude' : 'Leboncoin : à coller', txt: i.titre, a: go('item', i.id) });
  for (const i of lbcDelete()) t.push({ c: 'violet', ico: 'x', titre: 'Leboncoin : annonce à supprimer', txt: i.titre, a: go('item', i.id) });
  for (const i of items().filter((i) => Object.values(i.canaux || {}).some((c) => c.statut === 'erreur'))) t.push({ c: 'red', ico: 'x', titre: 'Publication en erreur', txt: i.titre, a: go('item', i.id) });
  for (const l of lots().filter((l) => l.statut === 'suivi' && Date.parse(l.date) < Date.now() && !l.itemId)) t.push({ c: 'blue', ico: 'hammer', titre: 'Vente passée : gagné ?', txt: l.titre, a: go('lot', l.id) });
  for (const l of lots().filter((l) => l.statut === 'invendu')) t.push({ c: 'gold', ico: 'hammer', titre: 'Invendu : faire une offre', txt: l.titre, a: go('lot', l.id) });
  return t;
}

/* ================= connexions ================= */
const SECRETS = [
  { n: 'ECHOS_DATA_KEY', k: 'github', d: 'Phrase secrète des données : la même que pour entrer ici.', req: true },
  { n: 'TELEGRAM_BOT_TOKEN', k: 'telegram', d: 'Jeton donné par @BotFather à la création du bot.', req: true },
  { n: 'ANTHROPIC_API_KEY', k: 'ia', d: 'Facultatif : rédaction automatique des annonces (console.anthropic.com).' },
  { n: 'EBAY_CLIENT_ID', k: 'ebay', d: 'App ID (developer.ebay.com › Keys).' },
  { n: 'EBAY_CLIENT_SECRET', k: 'ebay', d: 'Cert ID de l\'application eBay.' },
  { n: 'EBAY_REFRESH_TOKEN', k: 'ebay', d: 'Jeton utilisateur (User Token, 18 mois).' },
  { n: 'EBAY_FULFILLMENT_POLICY_ID', k: 'ebay', d: 'Règle d\'expédition (Business policies).' },
  { n: 'EBAY_PAYMENT_POLICY_ID', k: 'ebay', d: 'Règle de paiement.' },
  { n: 'EBAY_RETURN_POLICY_ID', k: 'ebay', d: 'Règle de retour.' },
  { n: 'TELEGRAM_CHAT_ID', k: 'telegram', d: 'Facultatif : se remplit tout seul quand tu envoies /start au bot.' },
];
const INTEG = [
  { k: 'interencheres', n: 'Interenchères', ic: 'hammer', col: '#ff7a6b', dir: 'in', role: 'Veille des ventes', x: 15, y: 25 },
  { k: 'telegram', n: 'Telegram', ic: 'send', col: '#34b4f0', dir: 'in', role: 'Alertes et réponses', x: 50, y: 14 },
  { k: 'site', n: 'Site', ic: 'globe', col: '#e3b860', dir: 'out', role: 'echosdessiecles.fr', x: 85, y: 25 },
  { k: 'ebay', n: 'eBay', ic: 'bag', col: '#6f9bff', dir: 'out', role: 'Annonces et commandes', x: 90, y: 54 },
  { k: 'leboncoin', n: 'Leboncoin', ic: 'box', col: '#ff9549', dir: 'out', role: 'Annonces', x: 77, y: 80 },
  { k: 'cocolis', n: 'Cocolis', ic: 'truck', col: '#3ddc97', dir: 'out', role: 'Livraison', x: 50, y: 87 },
  { k: 'stripe', n: 'Stripe', ic: 'card', col: '#9b7bff', dir: 'in', role: 'Paiement en ligne', x: 23, y: 80 },
  { k: 'ia', n: 'Claude IA', ic: 'spark', col: '#e08a63', dir: 'in', role: 'Rédaction', x: 10, y: 54 },
];
const secretOk = (n) => (SEC && SEC !== 'noperm' ? !!SEC[n] : null);
function conf(k) { // l'intégration a-t-elle ses identifiants ?
  const c = S.status.services?.config || {};
  const bySec = { telegram: secretOk('TELEGRAM_BOT_TOKEN'), ebay: secretOk('EBAY_REFRESH_TOKEN'), ia: secretOk('ANTHROPIC_API_KEY') }[k];
  return bySec ?? c[k] ?? false;
}
function status(k) {
  const sv = S.status.services || {}, st = S.settings, I = st.integrations || {};
  switch (k) {
    case 'interencheres': {
      if (I.veille === false) return { c: 'off', t: 'En pause' };
      const s = sv.interencheres;
      if (!s) return { c: 'wait', t: 'Premier passage à venir' };
      return s.ok ? { c: 'ok', t: `${s.vus ?? 0} lots · ${depuis(s.le || S.status.lastVeille)}` } : { c: 'err', t: s.err || 'Erreur de veille' };
    }
    case 'telegram': {
      if (I.telegram === false) return { c: 'off', t: 'En pause' };
      if (!conf('telegram')) return { c: 'wait', t: 'Jeton du bot à ajouter' };
      if (sv.telegram?.ok === false) return { c: 'err', t: sv.telegram.err || 'Erreur' };
      if (!S.tg.chatId) return { c: 'wait', t: 'Envoie /start au bot' };
      return { c: 'ok', t: 'Relié à ' + (S.tg.nom || 'toi') };
    }
    case 'site': return st.canaux.site === false ? { c: 'off', t: 'En pause' } : { c: 'ok', t: `${items().filter((i) => i.canaux?.site?.statut === 'en_ligne').length} pièces en ligne` };
    case 'ebay': {
      if (st.canaux.ebay === false) return { c: 'off', t: 'En pause' };
      if (!conf('ebay')) return { c: 'wait', t: 'Identifiants à ajouter' };
      if (sv.ebay?.ok === false) return { c: 'err', t: sv.ebay.err || 'Erreur' };
      const e = items().filter((i) => i.canaux?.ebay?.statut === 'erreur').length;
      return e ? { c: 'err', t: `${e} annonce(s) en erreur` } : { c: 'ok', t: `${items().filter((i) => i.canaux?.ebay?.statut === 'en_ligne').length} annonces` };
    }
    case 'leboncoin': {
      if (st.canaux.leboncoin === false) return { c: 'off', t: 'En pause' };
      const q = lbcQueue().length + lbcDelete().length;
      const m = st.leboncoin?.mode === 'claude' ? 'Via Claude' : 'Assisté';
      return q ? { c: 'wait', t: `${m} · ${q} en file` } : { c: 'ok', t: `${m} · à jour` };
    }
    case 'cocolis': return { c: 'ok', t: `${orders().filter((o) => o.livraison === 'cocolis').length} envoi(s)` };
    case 'stripe': return { c: 'off', t: 'Bientôt' };
    case 'ia': {
      if (I.ia === false) return { c: 'off', t: 'En pause' };
      return conf('ia') ? { c: 'ok', t: 'Rédige les annonces' } : { c: 'wait', t: 'Clé facultative' };
    }
    case 'github': {
      if (!S.status.lastRun) return { c: 'wait', t: 'Moteur pas encore lancé' };
      return minutes(S.status.lastRun) < 20 ? { c: 'ok', t: 'Cycle ' + depuis(S.status.lastRun) } : { c: 'wait', t: 'Dernier cycle ' + depuis(S.status.lastRun) };
    }
  }
  return { c: 'off', t: '' };
}
const COLOR = { ok: 'var(--green)', wait: 'var(--amber)', err: 'var(--red)', off: 'var(--dim2)' };
const PCOL = { ok: 'green', wait: 'amber', err: 'red', off: '' };

/* ================= graphiques ================= */
function spark(vals, col = 'var(--blue)', id = 's' + Math.random().toString(36).slice(2, 7)) {
  if (!vals.length) return '';
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0), n = vals.length;
  const pts = vals.map((v, i) => [(i / (n - 1 || 1)) * 100, 30 - ((v - min) / (max - min || 1)) * 26 - 2]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('');
  return `<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="${d}L100 32L0 32Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
function smooth(pts) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; d += `C${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`; }
  return d;
}
function areaChart() {
  const { ca, mg, start } = serie(30);
  const W = 600, H = 190, max = Math.max(...ca, 100) * 1.12;
  const P = (arr) => arr.map((v, i) => [+(i / (arr.length - 1) * W).toFixed(1), +(H - (v / max) * (H - 8)).toFixed(1)]);
  const pc = P(ca), pm = P(mg);
  const grid = [0.25, 0.5, 0.75].map((g) => `<line x1="0" x2="${W}" y1="${H * g}" y2="${H * g}" stroke="var(--line)" vector-effect="non-scaling-stroke"/>`).join('');
  const last = pc.at(-1);
  const labels = [0, 10, 20, 29].map((k) => `<span>${esc(fdate(new Date(start + k * D).toISOString(), { day: 'numeric', month: 'short' }))}</span>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chiffre d'affaires cumulé sur 30 jours : ${eur(ca.at(-1))}">${grid}
    <path d="${smooth(pc)}L${W} ${H}L0 ${H}Z" fill="url(#g-area)"/>
    <path d="${smooth(pc)}" fill="none" stroke="url(#g-brand)" stroke-width="2.4" vector-effect="non-scaling-stroke"/>
    <path d="${smooth(pm)}" fill="none" stroke="var(--gold)" stroke-width="1.6" stroke-dasharray="4 5" vector-effect="non-scaling-stroke" opacity=".9"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="var(--blue)" stroke="var(--bg)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="legend" style="justify-content:space-between;font:10.5px var(--mono);margin-top:6px">${labels}</div>`;
}

/* ================= coque ================= */
const VIEWS = {
  accueil: { t: 'Vue d\'ensemble', i: 'home', r: vAccueil },
  encheres: { t: 'Enchères', i: 'radar', r: vEncheres },
  stock: { t: 'Stock', i: 'box', r: vStock },
  ventes: { t: 'Ventes', i: 'bag', r: vVentes },
  connexions: { t: 'Connexions', i: 'plug', r: vConnexions },
  auto: { t: 'Automatisations', i: 'bolt', r: vAuto },
  activite: { t: 'Activité', i: 'pulse', r: vActivite },
  reglages: { t: 'Réglages', i: 'gear', r: vReglages },
};
const curView = () => { const v = (location.hash.slice(1) || 'accueil').split('/')[0]; return VIEWS[v] ? v : 'accueil'; };

function badge(v) {
  const n = { accueil: todos().length, encheres: lots().filter((l) => l.statut === 'nouveau').length, stock: items().filter((i) => i.statut === 'prix' || i.statut === 'pret').length, ventes: orders().filter((o) => o.statut === 'livraison_a_choisir' || o.statut === 'a_preparer').length, connexions: INTEG.filter((x) => status(x.k).c === 'err').length + (status('github').c === 'err' ? 1 : 0), activite: jobsErr().length }[v];
  return n ? `<b>${n}</b>` : '';
}

function shell(inner) {
  const v = curView();
  const link = (k) => `<a href="#${k}" class="${v === k ? 'on' : ''}">${icon(VIEWS[k].i)}<span>${VIEWS[k].t}</span>${badge(k)}</a>`;
  const tab = (k, label) => `<a href="#${k}" class="${v === k ? 'on' : ''}">${icon(VIEWS[k].i)}<span>${label}</span>${badge(k)}</a>`;
  const brand = `<a class="brand" href="#accueil"><span class="mark"><svg width="20" height="20"><use href="#logo"/></svg></span><span><small>Échos des siècles</small><strong>Console</strong></span></a>`;
  const gst = status('github');
  return `<div class="app">
    <aside class="side">${brand}
      <button class="srch" data-act="pal">${icon('search', 16)}<span>Rechercher…</span><span class="kbd">⌘K</span></button>
      <div class="lbl">Pilotage</div>${['accueil', 'encheres', 'stock', 'ventes'].map(link).join('')}
      <div class="lbl">Système</div>${['connexions', 'auto', 'activite', 'reglages'].map(link).join('')}
      <div class="foot"><div style="display:flex;align-items:center;gap:8px;font-weight:550"><i class="dot ${gst.c === 'ok' ? '' : gst.c === 'err' ? 'red' : 'amber'}"></i>Moteur ${gst.c === 'ok' ? 'actif' : 'en veille'}</div><div class="dim" style="margin-top:4px">${esc(gst.t)} · toutes les 5 min</div>
        <button class="btn sec sm full" style="margin-top:10px" data-act="run">${icon('bolt', 15)} Lancer maintenant</button></div>
    </aside>
    <div class="mainw">
      <header class="top">${brand}<span class="sp"></span><span class="live" data-sync>${syncHtml()}</span>
        <button class="ib" data-act="pal" aria-label="Rechercher">${icon('search', 18)}</button>
        <a class="ib" href="#connexions" aria-label="Connexions">${icon('plug', 18)}</a>
        <button class="ib" data-act="menu" aria-label="Menu">${icon('menu', 18)}</button></header>
      <main>${mode === 'demo' ? `<div class="banner">${icon('spark', 16)}<span>Mode démo : données d'exemple, rien n'est envoyé. <a href="./">Se connecter</a></span></div>` : ''}${inner}</main>
    </div>
    <nav class="tabs">${tab('accueil', 'Accueil')}${tab('encheres', 'Enchères')}<button class="fab" data-act="quick" aria-label="Actions rapides">${icon('plus')}</button>${tab('stock', 'Stock')}${tab('ventes', 'Ventes')}</nav>
  </div>`;
}

const hero = (eyebrow, title, sub, right = '') => `<div class="hero reveal"><div><div class="eyebrow">${eyebrow}</div><h1 class="h1">${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${right ? `<div class="acts">${right}</div>` : ''}</div>`;
const seg = (key, opts) => `<div class="seg" role="tablist">${opts.map(([v, l, n]) => `<button class="${f[key] === v ? 'on' : ''}" data-f="${key}" data-v="${v}">${esc(l)}${n != null ? `<sup>${n}</sup>` : ''}</button>`).join('')}</div>`;
const empty = (t, s) => `<div class="empty"><b>${esc(t)}</b>${esc(s)}</div>`;

/* ================= vues ================= */
function salut() {
  const h = +new Date().toLocaleString('fr-FR', { timeZone: TZ, hour: '2-digit', hour12: false });
  return h < 6 ? 'Bonne nuit' : h < 18 ? 'Bonjour' : 'Bonsoir';
}

function vAccueil() {
  const k = kpis(), s = serie(30), t = todos();
  const delta = k.caPrev ? Math.round(((k.ca - k.caPrev) / k.caPrev) * 100) : null;
  const nom = S.tg?.nom || 'Stéphane';
  const nOk = [...INTEG.map((x) => x.k), 'github'].filter((x) => status(x).c === 'ok').length;
  const funnelData = [
    ['Repérés', lots().filter((l) => l.statut !== 'ignore').length],
    ['Suivis', lots().filter((l) => ['suivi', 'gagne', 'perdu'].includes(l.statut)).length],
    ['Achetés', items().length],
    ['En ligne', items().filter((i) => ['en_ligne', 'vendu'].includes(i.statut)).length],
    ['Vendus', items().filter((i) => i.statut === 'vendu').length],
  ];
  const fmax = Math.max(...funnelData.map((x) => x[1]), 1);
  const prochains = k.suivis.slice(0, 4);
  return hero(`<i class="dot"></i>${esc(fdate(new Date().toISOString(), { weekday: 'long', day: 'numeric', month: 'long' }))}`, `${salut()} ${esc(nom)},<br><span class="serif grad">tout tourne.</span>`,
    `${nOk} connexions actives, ${t.length ? `${t.length} chose${t.length > 1 ? 's' : ''} à décider` : 'rien à décider pour l\'instant'}. Le moteur veille toutes les 5 minutes, tu gardes la main sur le prix et la livraison.`,
    `<button class="btn sec" data-act="pal">${icon('search', 16)} Rechercher</button><button class="btn grd" data-open="new">${icon('plus', 16)} Nouvel achat</button>`) + `
  <section class="bento">
    <a href="#ventes" class="card glow kpi hero-k reveal"><div class="k">Chiffre d'affaires · 30 j ${delta != null ? `<span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)} %</span>` : ''}</div><div class="v">${keur(k.ca)}</div><div class="d">${k.nv} vente${k.nv > 1 ? 's' : ''}</div>${spark(s.ca, 'var(--blue)')}</a>
    <a href="#ventes" class="card glow kpi reveal"><div class="k">Marge · 30 j <span class="dim">${k.ca ? Math.round((k.mg / k.ca) * 100) + ' %' : ''}</span></div><div class="v">${keur(k.mg)}</div><div class="d">après frais d'achat</div>${spark(s.mg, 'var(--gold)')}</a>
    <a href="#stock" class="card glow kpi reveal"><div class="k">En vitrine ${icon('box', 16)}</div><div class="v">${k.enLigne}</div><div class="d">valeur ${keur(k.valeur)}</div>${spark(items().filter((i) => i.publieLe).map((i, n) => n + 1), 'var(--green)')}</a>
    <a href="#encheres" class="card glow kpi reveal"><div class="k">Veille ${icon('radar', 16)}</div><div class="v">${k.nouveaux}<span class="dim" style="font-size:.5em;font-weight:500"> nouveaux</span></div><div class="d">${k.suivis.length} suivi${k.suivis.length > 1 ? 's' : ''}${k.suivis[0] ? ' · prochaine ' + esc(dans(k.suivis[0].date)) : ''}</div>${spark([3, 5, 4, 8, 6, 9, 7, 11, 9, k.nouveaux + 8], 'var(--violet)')}</a>

    <div class="card pad span2 row2 reveal"><div class="sech"><div><div class="h2">Ventes cumulées</div><div class="dim" style="font-size:12.5px">30 derniers jours</div></div><div class="legend"><span><i style="background:var(--blue)"></i>CA</span><span><i style="background:var(--gold)"></i>Marge</span></div></div>${areaChart()}
      <div class="sech" style="margin:18px 0 10px"><div class="h2">Du marteau à la vente</div></div>
      <div class="funnel">${funnelData.map(([l, n]) => `<div class="fstep"><span class="dim">${l}</span><div class="fbar"><i style="width:${Math.max(4, (n / fmax) * 100)}%"></i></div><b class="num" style="text-align:right">${n}</b></div>`).join('')}</div></div>

    <div class="card span2 reveal"><div class="sech pad" style="margin:0;padding-bottom:4px"><div class="h2">À décider ${t.length ? pill(String(t.length), 'red', 'no-dot') : ''}</div></div>
      ${t.length ? t.slice(0, 6).map((x) => `<button class="item" ${x.a}><span class="pill ${x.c} no-dot" style="width:36px;height:36px;padding:0;justify-content:center;border-radius:11px;flex:none">${icon(x.ico, 17)}</span><span class="body"><b>${esc(x.titre)}</b><span class="m">${esc(x.txt)}</span></span><span class="chev">›</span></button>`).join('') : `<div class="pad">${empty('Rien à faire', 'Le moteur s\'occupe du reste. Je te préviens sur Telegram.')}</div>`}</div>

    <div class="card span2 reveal"><div class="sech pad" style="margin:0;padding-bottom:4px"><div class="h2">Prochaines ventes</div><a class="link" href="#encheres" data-f="ench" data-v="agenda">Agenda ›</a></div>
      ${prochains.length ? prochains.map((l) => `<button class="item" data-open="lot" data-id="${esc(l.id)}">${thumb(l.photos?.[0])}<span class="body"><b>${esc(l.titre)}</b><span class="m">${kindPill(l.kind)}<span>${esc(fdate(l.date))} ${fheure(l.date)}</span></span></span><span class="end"><b>${eur(l.marteauMax)}</b><small>max</small></span></button>`).join('') : `<div class="pad">${empty('Aucune vente suivie', 'Suis un lot depuis la veille : je te rappelle avant.')}</div>`}</div>

    <a href="#connexions" class="card pad glow span2 reveal" style="display:grid;gap:12px"><div class="sech" style="margin:0"><div class="h2">${icon('plug', 18)} Connexions</div><span class="link">Tout voir ›</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${[...INTEG, { k: 'github', n: 'Moteur' }].map((x) => { const s2 = status(x.k); return `<span class="pill ${PCOL[s2.c]}">${esc(x.n)}</span>`; }).join('')}</div></a>

    <div class="card span2 reveal"><div class="sech pad" style="margin:0;padding-bottom:4px"><div class="h2">${icon('pulse', 18)} Activité</div><a class="link" href="#activite">Journal ›</a></div><div class="feed">${S.log.slice(0, 5).map(evHtml).join('') || `<div class="pad dim">Rien encore.</div>`}</div></div>
  </section>`;
}

function evHtml(e) {
  const m = e.msg || '';
  const ico = /vente|vendu/i.test(m) ? 'bag' : /prix/i.test(m) ? 'euro' : /veille/i.test(m) ? 'radar' : /leboncoin/i.test(m) ? 'box' : /ebay/i.test(m) ? 'globe' : /pi[eè]ce/i.test(m) ? 'hammer' : 'pulse';
  const cls = e.level === 'error' ? 'error' : e.level === 'warn' ? 'warn' : /vente/i.test(m) ? 'ok' : '';
  return `<div class="ev ${cls}"><span class="ei">${icon(ico, 15)}</span><span>${esc(m)}</span><time title="${esc(fdate(e.t))} ${fheure(e.t)}">${esc(depuis(e.t))}</time></div>`;
}

function lotCard(l) {
  const passe = Date.parse(l.date) < Date.now();
  return `<article class="card glow lot reveal" data-open="lot" data-id="${esc(l.id)}">
    <div class="img">${l.photos?.[0] ? `<img src="${pic(l.photos[0])}" alt="" loading="lazy">` : `<div class="ph0" style="height:100%">${icon('img', 30)}</div>`}<div class="tl">${kindPill(l.kind)}${l.statut !== 'nouveau' ? pill(STAT_LOT[l.statut]?.[0] || l.statut, STAT_LOT[l.statut]?.[1]) : ''}</div><span class="cd" data-cd="${esc(l.date)}">${esc(passe ? 'terminée' : dans(l.date))}</span></div>
    <div class="c"><b>${esc(l.titre)}</b><div class="m"><span>${esc(l.etude)}</span><span>${esc(l.ville)}</span><span>est. ${eur(l.estMin)}–${eur(l.estMax)}</span></div></div>
    <div class="target"><div class="t">Marteau max<b>${l.marteauMax ? eur(l.marteauMax) : '—'}</b></div><div class="eur"><input inputmode="numeric" placeholder="Revente" aria-label="Revente visée" value="${l.revente || ''}" data-revente="${esc(l.id)}" style="padding-right:24px"></div></div>
    <div class="acts">${l.statut === 'nouveau' ? `<button class="btn sec sm" data-act="lot.suivre" data-id="${esc(l.id)}">${icon('check', 15)} Suivre</button><button class="btn ghost sm" data-act="lot.ignorer" data-id="${esc(l.id)}">Ignorer</button>` : ''}<span class="sp"></span><span class="dim" style="font-size:12px;align-self:center">${esc(l.tag || '')}</span></div>
  </article>`;
}

function vEncheres() {
  const L = lots();
  const cnt = (st) => L.filter((l) => l.statut === st).length;
  const tags = [...new Set(L.map((l) => l.tag).filter(Boolean))];
  const head = hero(`${icon('radar', 14)} Interenchères · ${esc(status('interencheres').t)}`, `Les <span class="serif grad">enchères</span>`,
    'Live, chrono et catalogue sur l\'art de la table et la peinture russe. Indique ta revente : je calcule le marteau max avec ta règle.',
    `<button class="btn sec" data-act="ics">${icon('cal', 16)} Agenda .ics</button><button class="btn grd" data-act="veille">${icon('radar', 16)} Lancer une veille</button>`);
  const tabs = `<div class="bar">${seg('ench', [['veille', 'Veille'], ['agenda', 'Agenda', L.filter((l) => l.statut === 'suivi' && Date.parse(l.date) > Date.now()).length]])}</div>`;
  if (f.ench === 'agenda') return head + tabs + vAgenda();
  const q = f.q.toLowerCase();
  const list = L.filter((l) => (f.statut === 'tous' ? l.statut !== 'ignore' : l.statut === f.statut) && (f.kind === 'tous' || l.kind === f.kind) && (f.tag === 'tous' || l.tag === f.tag) && (!q || (l.titre + ' ' + l.etude + ' ' + l.ville).toLowerCase().includes(q)))
    .sort((a, b) => (Date.parse(a.date) < Date.now()) - (Date.parse(b.date) < Date.now()) || a.date.localeCompare(b.date));
  return head + tabs + `<div class="bar">
      ${seg('statut', [['nouveau', 'Nouveaux', cnt('nouveau')], ['suivi', 'Suivis', cnt('suivi')], ['invendu', 'Invendus', cnt('invendu')], ['gagne', 'Gagnés', cnt('gagne')], ['tous', 'Tous']])}
      ${seg('kind', [['tous', 'Tout'], ['live', 'Live'], ['online', 'Chrono'], ['classic', 'Catalogue']])}
      ${tags.length > 1 ? seg('tag', [['tous', 'Tous thèmes'], ...tags.map((t) => [t, t])]) : ''}
      <label class="searchf">${icon('search', 16)}<input data-q placeholder="Filtrer : Baccarat, Lyon…" value="${esc(f.q)}"></label></div>
    ${list.length ? `<div class="grid g3">${list.map(lotCard).join('')}</div>` : empty('Aucun lot ici', 'Change de filtre, ou lance une veille pour chercher maintenant.')}`;
}

function vAgenda() {
  const L = lots().filter((l) => l.statut === 'suivi' && Date.parse(l.date) > Date.now() - 6 * 36e5).sort((a, b) => a.date.localeCompare(b.date));
  if (!L.length) return empty('Rien au programme', 'Suis des lots : ils s\'affichent ici et je te rappelle avant chaque vente.');
  const days = {};
  for (const l of L) (days[fdate(l.date, { weekday: 'long', day: 'numeric', month: 'long' })] ||= []).push(l);
  return `<div class="tline">${Object.entries(days).map(([d, ls]) => `<div class="day">${esc(d)}</div><div class="card">${ls.map((l) => `<button class="item" data-open="lot" data-id="${esc(l.id)}"><span class="mono" style="width:44px;color:var(--ink)">${fheure(l.date)}</span>${thumb(l.photos?.[0])}<span class="body"><b>${esc(l.titre)}</b><span class="m">${kindPill(l.kind)}<span>${esc(l.etude)}</span><span data-cd="${esc(l.date)}">${esc(dans(l.date))}</span></span></span><span class="end"><b>${eur(l.marteauMax)}</b><small>marteau max</small></span></button>`).join('')}</div>`).join('')}</div>
    <p class="dim" style="font-size:13px;margin-top:14px">Rappels Telegram ${S.settings.auto?.rappels === false ? 'désactivés' : (S.settings.rappels?.heures || []).map((h) => h + ' h').join(' et ') + ' avant'}. <a class="link" href="#auto">Régler</a></p>`;
}

function priceChips(i) {
  return `<div class="pchips">${propositions(i.cout, S.settings.pricing).map((p) => `<button class="pchip ${p.regle ? 'rule' : ''}" data-act="item.prix" data-id="${i.id}" data-prix="${p.prix}"><b>${eur(p.prix)}</b><span>${p.regle ? 'règle ' : ''}× ${String(p.mult).replace('.', ',')}</span></button>`).join('')}</div>`;
}
const chans = (i) => `<div class="chs">${Object.keys(CANAUX).map((c) => { const st = i.canaux?.[c]?.statut; return `<span class="ch ${CH_CLS[st] || ''}" title="${esc(STAT_CANAL[st]?.[0] || 'Pas publié')}"><i></i>${CANAUX[c]}</span>`; }).join('')}</div>`;

function kcard(i) {
  const top = `<div class="top2">${thumb(i.photos?.[0])}<div class="body"><b>${esc(i.annonce?.titre || i.titre)}</b><div class="m"><span>${esc(i.id)}</span><span>coût ${eur(i.cout)}</span></div></div>${i.prix ? `<div class="end"><b>${eur(i.prix)}</b><small>${i.statut === 'vendu' ? '+' + eur((i.vendu?.prix || i.prix) - i.cout) : 'x' + (i.prix / (i.cout || 1)).toFixed(1).replace('.', ',')}</small></div>` : ''}</div>`;
  let extra = '';
  if (i.statut === 'prix') extra = priceChips(i);
  else if (i.statut === 'pret') extra = `<button class="btn grd sm full" data-act="item.publier" data-id="${i.id}">${icon('bolt', 15)} Publier partout</button>`;
  else if (i.statut === 'en_ligne') extra = chans(i);
  else if (i.statut === 'vendu') extra = `<div class="m dim" style="font-size:12.5px">${esc(CANAUX[i.vendu?.canal] || i.vendu?.canal || '')} · ${esc(fdate(i.vendu?.le))}</div>`;
  return `<div class="card kcard glow" data-open="item" data-id="${i.id}">${top}${extra}</div>`;
}

function vStock() {
  const q = f.q.toLowerCase();
  const I = items().filter((i) => !q || (i.titre + ' ' + i.marque + ' ' + i.id).toLowerCase().includes(q));
  const cols = [['prix', 'Prix à fixer', 'amber'], ['pret', 'Prêtes', 'blue'], ['en_ligne', 'En ligne', 'green'], ['vendu', 'Vendues', 'gold']];
  const valeur = items().filter((i) => i.statut === 'en_ligne').reduce((a, i) => a + (i.prix || 0), 0);
  return hero(`${icon('box', 14)} ${items().filter((i) => i.statut !== 'archive').length} pièces · ${keur(valeur)} en vitrine`, `Le <span class="serif grad">stock</span>`,
    'Chaque pièce gagnée arrive ici avec ses photos. Tu choisis le prix, je publie sur le site, eBay et Leboncoin, et je retire partout à la vente.',
    `<button class="btn grd" data-open="new">${icon('plus', 16)} Nouvel achat</button>`) + `
    <div class="bar"><label class="searchf">${icon('search', 16)}<input data-q placeholder="Chercher une pièce…" value="${esc(f.q)}"></label></div>
    <div class="kanban">${cols.map(([st, t, c]) => { const L = I.filter((i) => i.statut === st).sort((a, b) => (b.vendu?.le || b.creeLe).localeCompare(a.vendu?.le || a.creeLe)); const shown = st === 'vendu' ? L.slice(0, 8) : L; return `<div class="col"><div class="colh">${pill(t, c)}<span class="n">${L.length}</span></div>${shown.map(kcard).join('') || `<div class="empty" style="padding:22px 12px;font-size:13px">Vide</div>`}</div>`; }).join('')}</div>
    ${items().some((i) => i.statut === 'archive') ? `<p class="dim" style="font-size:13px;margin-top:10px">${items().filter((i) => i.statut === 'archive').length} pièce(s) retirée(s) de la vente.</p>` : ''}`;
}

function orderRow(o) {
  const i = S.items[o.itemId] || {};
  const st = STAT_CMD[o.statut] || [o.statut, ''];
  return `<button class="item" data-open="order" data-id="${o.id}">${thumb(i.photos?.[0], 'th lg')}<span class="body"><b>${esc(i.titre || o.itemId)}</b><span class="m">${pill(st[0], st[1])}<span>${esc(CANAUX[o.canal] || o.canal)}</span><span>${esc(o.acheteur || '')}${o.ville ? ' · ' + esc(o.ville) : ''}</span>${o.livraison ? `<span>${icon('truck', 13)} ${esc(LIVRAISONS[o.livraison])}</span>` : ''}</span></span><span class="end"><b>${eur(o.prix)}</b><small>${esc(fdate(o.creeLe, { day: 'numeric', month: 'short' }))}</small></span></button>`;
}

function vVentes() {
  const O = orders();
  const ouvertes = O.filter((o) => !['terminee', 'annulee'].includes(o.statut));
  const L = f.ventes === 'ouvertes' ? ouvertes : f.ventes === 'terminees' ? O.filter((o) => o.statut === 'terminee') : O;
  const k = kpis();
  const parCanal = Object.keys({ ...CANAUX, autre: 1 }).map((c) => [c, O.filter((o) => o.canal === c).reduce((a, o) => a + o.prix, 0)]).filter((x) => x[1]);
  const tot = parCanal.reduce((a, x) => a + x[1], 0) || 1;
  const colC = { site: 'var(--gold)', ebay: 'var(--blue)', leboncoin: '#ff9549', autre: 'var(--violet)' };
  return hero(`${icon('bag', 14)} ${ouvertes.length} commande(s) en cours`, `Les <span class="serif grad">ventes</span>`, 'Tu choisis la livraison : Cocolis à la main, Colissimo, ou retrait à Lyon ou Annecy. Je préviens l\'acheteur et je retire les annonces ailleurs.') + `
    <section class="bento" style="margin-bottom:16px">
      <div class="card kpi"><div class="k">À expédier</div><div class="v">${O.filter((o) => ['livraison_a_choisir', 'a_preparer'].includes(o.statut)).length}</div><div class="d">livraison à choisir ou à préparer</div></div>
      <div class="card kpi"><div class="k">CA · 30 j</div><div class="v">${keur(k.ca)}</div><div class="d">${k.nv} vente(s)</div></div>
      <div class="card kpi"><div class="k">Panier moyen</div><div class="v">${eur(O.length ? O.reduce((a, o) => a + o.prix, 0) / O.length : 0)}</div><div class="d">sur ${O.length} vente(s)</div></div>
      <div class="card kpi"><div class="k">Par canal</div><div style="display:flex;height:10px;border-radius:99px;overflow:hidden;margin:10px 0 6px;background:var(--panel2)">${parCanal.map(([c, v]) => `<i style="width:${(v / tot) * 100}%;background:${colC[c]}"></i>`).join('')}</div><div class="legend" style="flex-wrap:wrap;gap:6px 12px">${parCanal.map(([c, v]) => `<span><i style="background:${colC[c]}"></i>${esc(CANAUX[c] || 'Autre')} ${Math.round((v / tot) * 100)} %</span>`).join('')}</div></div>
    </section>
    <div class="bar">${seg('ventes', [['ouvertes', 'En cours', ouvertes.length], ['terminees', 'Terminées'], ['toutes', 'Toutes', O.length]])}</div>
    ${L.length ? `<div class="card">${L.map(orderRow).join('')}</div>` : empty('Aucune commande ici', 'Dès qu\'une pièce se vend (site, eBay, Leboncoin ou en direct), elle apparaît ici.')}`;
}

/* ---------- Connexions ---------- */
function netGraph() {
  const hub = { x: 50, y: 50 };
  const wires = INTEG.map((n) => {
    const st = status(n.k);
    const mx = (hub.x + n.x) / 2 + (n.y - hub.y) * 0.18, my = (hub.y + n.y) / 2 - (n.x - hub.x) * 0.18;
    const d = `M${hub.x} ${hub.y} Q${mx.toFixed(1)} ${my.toFixed(1)} ${n.x} ${n.y}`;
    return `<path class="wire" d="${d}" vector-effect="non-scaling-stroke"/>${st.c === 'off' ? '' : `<path class="flow ${n.dir === 'in' ? 'in' : ''}" d="${d}" stroke="${st.c === 'ok' ? n.col : COLOR[st.c]}" vector-effect="non-scaling-stroke" style="animation-duration:${1.1 + (n.x % 7) / 10}s"/>`}`;
  }).join('');
  const g = status('github');
  return `<div class="card net reveal"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${wires}</svg>
    ${INTEG.map((n) => { const st = status(n.k); return `<a class="node ${st.c}" href="#c-${n.k}" data-scroll="c-${n.k}" style="left:${n.x}%;top:${n.y}%"><span class="ic" style="color:${n.col}">${icon(n.ic, 24)}</span><span>${esc(n.n)}</span><small>${esc(st.t)}</small></a>`; }).join('')}
    <a class="node hub ${g.c}" href="#c-github" data-scroll="c-github" style="left:50%;top:50%"><span class="ic"><svg width="38" height="38"><use href="#logo"/></svg></span><span>Moteur Échos</span><small>${esc(g.t)}</small></a></div>`;
}

const secretRow = (s) => { const ok = secretOk(s.n); return `<div class="chan"><span style="min-width:0"><span class="mono" style="color:var(--ink);text-transform:none;letter-spacing:0;font-size:12.5px">${s.n}</span><br><small class="dim">${esc(s.d)}</small></span><span style="display:flex;gap:8px;align-items:center;flex:none">${ok == null ? '' : ok ? pill('Réglé', 'green') : pill(s.req ? 'Manquant' : 'Vide', s.req ? 'red' : '')}<button class="btn sec sm" data-open="secret" data-id="${s.n}">${icon('key', 14)} ${ok ? 'Changer' : 'Définir'}</button></span></div>`; };

function connCard(k, body, { tog, stats = [], steps = [], secrets = true, links = '' } = {}) {
  const meta = INTEG.find((x) => x.k === k) || { n: 'Moteur Échos (GitHub)', ic: 'git', col: 'var(--ink2)', role: 'Automatisation, données chiffrées, site' };
  const st = status(k);
  const sec = secrets ? SECRETS.filter((s) => s.k === k) : [];
  return `<article class="card conn reveal" id="c-${k}">
    <div class="hd"><span class="ic" style="color:${meta.col}">${icon(meta.ic, 22)}</span><div style="flex:1;min-width:0"><b>${esc(meta.n)}</b><small>${esc(meta.role)}</small></div>${tog ? `<input type="checkbox" class="sw" aria-label="Activer ${esc(meta.n)}" data-tog="${tog}" ${getPath(tog) !== false ? 'checked' : ''}>` : ''}</div>
    <div>${pill(st.t, PCOL[st.c])}</div>
    ${stats.length ? `<div class="stats">${stats.map(([v, l]) => `<div><b>${v}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
    ${body || ''}
    ${steps.length ? `<ol class="steps">${steps.map(([t, done]) => `<li class="${done ? 'done' : ''}"><span>${t}</span></li>`).join('')}</ol>` : ''}
    ${sec.length && SEC !== 'noperm' ? `<div>${sec.map(secretRow).join('')}</div>` : ''}
    ${links ? `<div class="acts">${links}</div>` : ''}
  </article>`;
}
function getPath(p) { return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), S.settings); }

function vConnexions() {
  const sv = S.status.services || {};
  const I = items();
  const lbcMode = S.settings.leboncoin?.mode || 'assiste';
  const bot = S.tg.bot || sv.telegram?.bot;
  const ext = (href, t) => `<a class="btn sec sm" href="${esc(href)}" target="_blank" rel="noopener">${esc(t)} ${icon('arrow', 13)}</a>`;
  const nOk = [...INTEG.map((x) => x.k), 'github'].filter((x) => status(x).c === 'ok').length;
  const permBanner = SEC === 'noperm' ? `<div class="banner">${icon('key', 16)}<span>Pour régler les secrets d'ici, ajoute à ton jeton GitHub la permission <b>Secrets : lecture et écriture</b> (<a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">réglages du jeton</a>), puis reconnecte-toi.</span></div>` : '';
  return hero(`<i class="dot"></i>${nOk}/${INTEG.length + 1} opérationnelles`, `Tout est <span class="serif grad">connecté.</span>`,
    'Le moteur tourne seul sur GitHub, 24 h/24, toutes les 5 minutes. Coupe ou rebranche chaque service d\'un geste, et règle ses accès sans quitter l\'admin.',
    `<button class="btn sec" data-act="reload">${icon('pulse', 16)} Actualiser</button><button class="btn grd" data-act="run">${icon('bolt', 16)} Lancer un cycle</button>`) + permBanner + netGraph() + `
  <div class="grid g2 sec">
    ${connCard('github', '', {
      stats: [[ago(S.status.lastRun), 'dernier cycle'], [ago(S.status.saved), 'sauvegarde'], [String(S.jobs.filter((j) => !j.done).length), 'tâches']],
      steps: [['Données chiffrées AES-256 dans le dépôt', true], ['Secret <b>ECHOS_DATA_KEY</b> : ta phrase secrète', secretOk('ECHOS_DATA_KEY') ?? !!S.status.lastRun], ['Cycle automatique toutes les 5 min', !!S.status.lastRun]],
      links: `${ext(`https://github.com/${repo()}/actions`, 'Exécutions')}<button class="btn sec sm" data-act="run">Lancer</button>`,
    })}
    ${connCard('interencheres', `<p class="dim" style="font-size:13px">${S.settings.veille.requetes.filter((r) => r.actif).length} recherches actives, ${Object.entries(S.settings.veille.types).filter(([, v]) => v).map(([k]) => KIND[k][0]).join(', ')}. API publique, aucun compte nécessaire.</p>`, {
      tog: 'integrations.veille', secrets: false,
      stats: [[String(sv.interencheres?.vus ?? '—'), 'lots vus'], [String(lots().filter((l) => l.statut === 'nouveau').length), 'nouveaux'], [String(lots().filter((l) => l.statut === 'suivi').length), 'suivis']],
      links: `<button class="btn sec sm" data-act="veille">${icon('radar', 14)} Veille maintenant</button><a class="btn ghost sm" href="#auto">Recherches ›</a>`,
    })}
    ${connCard('telegram', '', {
      tog: 'integrations.telegram',
      stats: [[S.tg.chatId ? 'Oui' : 'Non', 'relié'], [esc(S.tg.nom || '—'), 'compte'], [ago(sv.telegram?.le), 'dernier échange']],
      steps: [['Crée le bot avec <b>@BotFather</b> (/newbot)', conf('telegram')], ['Colle son jeton ci-dessous', conf('telegram')], [`Envoie <b>/start</b> au bot${bot ? ` <a class="link" href="https://t.me/${esc(bot)}" target="_blank" rel="noopener">@${esc(bot)}</a>` : ''}`, !!S.tg.chatId]],
      links: `${bot ? ext('https://t.me/' + bot, 'Ouvrir le bot') : ext('https://t.me/BotFather', 'BotFather')}`,
    })}
    ${connCard('site', '<p class="dim" style="font-size:13px">Publié par GitHub Pages : chaque pièce mise en ligne apparaît dans la collection, et passe en « vendu » à la vente.</p>', {
      tog: 'canaux.site', secrets: false,
      stats: [[String(I.filter((i) => i.canaux?.site?.statut === 'en_ligne').length), 'en ligne'], [String(I.filter((i) => i.vendu?.canal === 'site').length), 'vendues'], ['HTTPS', 'domaine']],
      links: ext(SITE, 'echosdessiecles.fr'),
    })}
    ${connCard('ebay', '', {
      tog: 'canaux.ebay',
      stats: [[String(I.filter((i) => i.canaux?.ebay?.statut === 'en_ligne').length), 'annonces'], [String(I.filter((i) => i.vendu?.canal === 'ebay').length), 'vendues'], [ago(sv.ebay?.le), 'commandes lues']],
      steps: [['Compte développeur sur developer.ebay.com', conf('ebay')], ['Règles d\'expédition, paiement et retour', secretOk('EBAY_FULFILLMENT_POLICY_ID') ?? conf('ebay')], ['Colle les identifiants ci-dessous', conf('ebay')]],
      links: ext('https://developer.ebay.com/my/keys', 'Clés eBay'),
    })}
    ${connCard('leboncoin', `
      <div class="f">Mode de publication<div class="seg" style="width:100%"><button class="${lbcMode === 'assiste' ? 'on' : ''}" style="flex:1" data-act="lbc.mode" data-v="assiste">Assisté (Telegram)</button><button class="${lbcMode === 'claude' ? 'on' : ''}" style="flex:1" data-act="lbc.mode" data-v="claude">Via Claude</button></div></div>
      <p class="dim" style="font-size:13px">${lbcMode === 'claude' ? 'Les annonces se mettent en file : Claude les dépose et les supprime depuis le Chrome de ton Mac, avec ta session. Leboncoin interdit les robots sur ses serveurs, d\'où ce passage par ton ordinateur.' : 'Je prépare l\'annonce complète et je te l\'envoie sur Telegram : tu la colles dans l\'app en 30 secondes. À la vente, je te rappelle de la supprimer.'}</p>
      ${lbcQueue().length || lbcDelete().length ? `<div>${lbcQueue().map((i) => `<button class="item" style="padding:10px 0" data-open="item" data-id="${i.id}">${thumb(i.photos?.[0])}<span class="body"><b>${esc(i.titre)}</b><span class="m">${pill(STAT_CANAL[i.canaux.leboncoin.statut][0], 'violet')}<span>${eur(i.prix)}</span></span></span><span class="chev">›</span></button>`).join('')}${lbcDelete().map((i) => `<button class="item" style="padding:10px 0" data-open="item" data-id="${i.id}">${thumb(i.photos?.[0])}<span class="body"><b>${esc(i.titre)}</b><span class="m">${pill('À supprimer', 'red')}<span>vendue ailleurs</span></span></span><span class="chev">›</span></button>`).join('')}</div>` : ''}`, {
      tog: 'canaux.leboncoin', secrets: false,
      stats: [[String(I.filter((i) => i.canaux?.leboncoin?.statut === 'en_ligne').length), 'en ligne'], [String(lbcQueue().length), 'en file'], [String(lbcDelete().length), 'à supprimer']],
      links: ext('https://www.leboncoin.fr/deposer-une-annonce', 'Déposer') + ext('https://www.leboncoin.fr/compte/part/mes-annonces', 'Mes annonces'),
    })}
    ${connCard('ia', '<p class="dim" style="font-size:13px">Rédige titre, description et catégories de chaque annonce à partir des infos du lot. Facultatif : sans clé, le texte du lot est repris tel quel.</p>', {
      tog: 'integrations.ia',
      stats: [[String(I.filter((i) => i.annonce?.titre).length), 'annonces rédigées'], ['Haiku', 'modèle'], ['~0,01 €', 'par annonce']],
      links: ext('https://console.anthropic.com/settings/keys', 'Clé API'),
    })}
    ${connCard('cocolis', '<p class="dim" style="font-size:13px">Cocolis n\'a pas d\'API ouverte : quand tu choisis Cocolis pour une commande, je te prépare les infos et un lien direct pour créer l\'envoi.</p>', {
      secrets: false, stats: [[String(orders().filter((o) => o.livraison === 'cocolis').length), 'envois'], [String(orders().filter((o) => o.livraison?.startsWith('retrait')).length), 'retraits'], [String(orders().filter((o) => o.statut === 'a_preparer').length), 'à préparer']],
      links: ext('https://www.cocolis.fr/', 'Cocolis'),
    })}
    ${connCard('stripe', '<p class="dim" style="font-size:13px">Paiement par carte directement sur le site : la prochaine étape. Il faudra un compte Stripe (1,5 % + 0,25 € par paiement, sans abonnement).</p>', { secrets: false, links: pill('Prochaine étape', 'violet') })}
  </div>
  ${SEC !== 'noperm' ? `<section class="sec card pad reveal" id="secrets"><div class="sech"><div class="h2">${icon('key', 18)} Coffre des secrets</div><span class="dim" style="font-size:12.5px">chiffrés sur ton appareil, illisibles ensuite</span></div>${SECRETS.map(secretRow).join('')}</section>` : ''}`;
}

/* ---------- Automatisations ---------- */
function vAuto() {
  const st = S.settings, A = st.auto || {}, p = st.pricing, v = st.veille;
  const tg = (path, t, s) => `<label class="tog"><span class="t"><b>${t}</b><small>${s}</small></span><input type="checkbox" class="sw" data-tog="${path}" ${getPath(path) !== false && getPath(path) != null ? 'checked' : ''}></label>`;
  const groups = {};
  for (const r of v.requetes) (groups[r.tag || 'Autres'] ||= []).push(r);
  return hero(`${icon('bolt', 14)} Règles du moteur`, `Les <span class="serif grad">automatismes</span>`, 'Ce que le moteur fait seul, et ce qu\'il te demande. Tout s\'applique au cycle suivant.') + `
  <div class="grid g2">
    <section class="card reveal"><div class="pad" style="padding-bottom:0"><div class="h2">Flux automatiques</div></div>
      ${tg('auto.publierApresPrix', 'Publier dès que le prix est fixé', 'Sinon je te demande d\'abord « retrait possible ? »')}
      ${tg('auto.retirerAilleurs', 'Retirer partout à la vente', 'Évite la double vente entre site, eBay et Leboncoin')}
      ${tg('auto.rappels', 'Rappels avant les ventes', 'Sur Telegram, pour les lots suivis')}
      ${tg('auto.demanderResultat', 'Demander « gagné ? » après la vente', 'Pour créer la pièce en stock avec le prix au marteau')}
      ${tg('veille.alerteNouveaux', 'Alerte à chaque nouveau lot', 'Sinon un résumé de la veille')}
    </section>
    <form class="card pad reveal" data-form="pricing" style="display:grid;gap:12px"><div class="h2">${icon('euro', 18)} Règle de prix</div>
      <p class="dim" style="font-size:13px">Achat au-dessus de ${eur(p.seuil)} : × ${p.multHaut}. En dessous : × ${p.multBas}. Tu choisis toujours le prix final.</p>
      <div class="inrow"><label class="f">Seuil<div class="eur"><input class="in" name="seuil" inputmode="numeric" value="${p.seuil}" data-sim></div></label><label class="f">× au-dessus<input class="in" name="multHaut" inputmode="decimal" value="${p.multHaut}" data-sim></label><label class="f">× en dessous<input class="in" name="multBas" inputmode="decimal" value="${p.multBas}" data-sim></label></div>
      <div class="inrow"><label class="f">Frais %<input class="in" name="fraisDefaut" inputmode="decimal" value="${p.fraisDefaut}" data-sim></label><label class="f">+ Live %<input class="in" name="fraisLive" inputmode="decimal" value="${p.fraisLive}" data-sim></label><label class="f">Arrondi<div class="eur"><input class="in" name="arrondi" inputmode="numeric" value="${p.arrondi}" data-sim></div></label></div>
      <div style="border-top:1px solid var(--line);padding-top:12px;display:grid;gap:10px"><b style="font-size:13px">Simulateur</b>
        <div class="inrow"><label class="f">Si je l'achète au marteau<div class="eur"><input class="in" id="simH" inputmode="numeric" value="150" data-sim></div></label><label class="f">Si je veux revendre<div class="eur"><input class="in" id="simR" inputmode="numeric" value="600" data-sim></div></label></div>
        <div class="sim" id="simOut">${simHtml()}</div></div>
      <button class="btn pri">Enregistrer la règle</button></form>
  </div>
  <section class="card pad sec reveal" style="display:grid;gap:14px"><div class="sech" style="margin:0"><div class="h2">${icon('radar', 18)} Recherches Interenchères</div><span class="dim" style="font-size:12.5px">${v.requetes.filter((r) => r.actif).length} actives</span></div>
    ${Object.entries(groups).map(([g, rs]) => `<div><div class="mono dim" style="margin-bottom:8px">${esc(g)}</div><div class="chiprow">${rs.map((r) => `<span class="chipx ${r.actif ? '' : 'off'}"><button style="all:unset;cursor:pointer" data-act="req.toggle" data-id="${esc(r.id)}" title="${r.actif ? 'Mettre en pause' : 'Réactiver'}">${esc(r.q)}</button><button data-act="req.del" data-id="${esc(r.id)}" aria-label="Supprimer ${esc(r.q)}">${icon('x', 12)}</button></span>`).join('')}</div></div>`).join('')}
    <form class="inrow" data-form="req"><label class="f" style="flex:2">Nouvelle recherche<input class="in" name="q" required placeholder="ex. service Bernardaud"></label><label class="f">Thème<select class="in" name="tag">${[...new Set(['Art de la table', 'Tableaux russes', ...v.requetes.map((r) => r.tag)])].map((t) => `<option>${esc(t)}</option>`).join('')}</select></label><button class="btn sec" style="flex:none">${icon('plus', 16)}</button></form>
  </section>
  <form class="card pad sec reveal" data-form="veille" style="display:grid;gap:12px"><div class="h2">Filtres de veille</div>
    <div class="acts">${Object.entries(KIND).map(([k, [l]]) => `<label class="btn sec sm"><input type="checkbox" name="t_${k}" ${v.types[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <label class="f">Mots exclus (séparés par des virgules)<textarea class="in" name="exclus" style="min-height:80px">${esc(v.exclus.join(', '))}</textarea></label>
    <div class="inrow"><label class="f">Estimation mini<div class="eur"><input class="in" name="estimationMin" inputmode="numeric" value="${v.estimationMin || 0}"></div></label><label class="f">Horizon (jours)<input class="in" name="joursMax" inputmode="numeric" value="${v.joursMax}"></label><label class="f">Rappels (h avant)<input class="in" name="rappels" value="${esc((st.rappels?.heures || []).join(', '))}"></label></div>
    <button class="btn pri">Enregistrer les filtres</button></form>`;
}
function simHtml(p = S.settings.pricing, H = 150, R = 600) {
  const c = coutRevient(H, p.fraisDefaut);
  return `<div><b>${eur(c)}</b><span>coût frais compris</span></div><div><b class="grad">${eur(prixConseille(c, p))}</b><span>prix conseillé × ${multiple(c, p)}</span></div><div><b>${eur(marteauMax(R, p.fraisDefaut, p))}</b><span>marteau max pour ${eur(R)}</span></div>`;
}

/* ---------- Activité ---------- */
function vActivite() {
  const J = S.jobs.filter((j) => !j.done);
  const err = jobsErr();
  const lbl = { publish: 'Publier', unpublish: 'Retirer', update: 'Mettre à jour', notify: 'Prévenir' };
  return hero(`${icon('pulse', 14)} ${S.log.length} évènements`, `L'<span class="serif grad">activité</span>`, 'Tout ce que le moteur a fait, et ce qu\'il a en file. Une tâche échoue trois fois ? Elle s\'arrête et je te préviens.') + `
    <div class="bar">${seg('act', [['journal', 'Journal'], ['taches', 'Tâches', J.length], ['erreurs', 'Erreurs', err.length]])}</div>
    ${f.act === 'journal' ? `<div class="card feed">${S.log.slice(0, 120).map(evHtml).join('') || '<div class="pad dim">Rien encore.</div>'}</div>`
      : (() => { const L = f.act === 'erreurs' ? err : J; return L.length ? `<div class="card">${L.map((j) => { const it = S.items[j.itemId]; const bad = j.err || j.tries >= 3; return `<div class="ev ${bad ? 'error' : ''}"><span class="ei">${icon(bad ? 'x' : 'bolt', 15)}</span><span><b style="font-weight:550">${esc(lbl[j.type] || j.type)}${j.channel ? ' · ' + esc(CANAUX[j.channel] || j.channel) : ''}${j.kind ? ' · ' + esc(j.kind) : ''}</b><br><small class="dim">${esc(it?.titre || j.orderId || j.lotId || '')}${j.err ? ' — ' + esc(j.err) : ''} · ${j.tries || 0} essai(s)</small></span>${bad ? `<button class="btn sec sm" data-act="job.relancer" data-id="${esc(j.id)}">Relancer</button>` : `<time>${esc(depuis(j.at))}</time>`}</div>`; }).join('')}</div>` : empty('Rien en file', 'Le moteur est à jour.'); })()}`;
}

/* ---------- Réglages ---------- */
function vReglages() {
  const th = document.documentElement.dataset.theme;
  return hero(`${icon('gear', 14)} ${esc(mode === 'demo' ? 'Démo' : repo())}`, `<span class="serif grad">Réglages</span>`, '') + `
  <div class="grid g2">
    <section class="card reveal">
      <label class="tog"><span class="t"><b>Thème clair</b><small>Sombre par défaut</small></span><input type="checkbox" class="sw" data-act="theme" ${th === 'light' ? 'checked' : ''}></label>
      <div class="tog"><span class="t"><b>Installer sur le téléphone</b><small>Safari › Partager › « Sur l'écran d'accueil » : l'admin s'ouvre comme une appli.</small></span></div>
      <div class="tog"><span class="t"><b>Raccourcis</b><small>⌘K ou / : recherche et commandes · Échap : fermer</small></span></div>
    </section>
    <section class="card pad reveal" style="display:grid;gap:12px"><div class="h2">${icon('key', 18)} Accès</div>
      <p class="dim" style="font-size:13.5px">Données chiffrées AES-256 dans le dépôt <b>${esc(repo())}</b>. Ta phrase secrète ne quitte jamais cet appareil. Le jeton GitHub doit avoir les permissions <b>Contents</b>, <b>Actions</b> et <b>Secrets</b> en lecture et écriture, sur ce seul dépôt.</p>
      <div class="acts"><a class="btn sec sm" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Créer un jeton ${icon('arrow', 13)}</a><button class="btn sec sm" data-act="reload">Actualiser</button><button class="btn ghost sm" data-act="logout">Se déconnecter</button></div>
    </section>
  </div>`;
}

/* ================= tiroirs ================= */
function openSheet(html) { $('#sheet').innerHTML = `<div class="grab"></div><button class="ib x" data-act="close" aria-label="Fermer">${icon('x', 16)}</button>${html}`; document.body.classList.add('open'); $('#sheet').scrollTop = 0; }
function closeSheet() { document.body.classList.remove('open'); }
const gal = (ph) => (ph?.length ? `<div class="gal">${ph.map((p) => `<img src="${pic(p)}" alt="">`).join('')}</div>` : '');
const eyebrow = (t) => `<div class="eyebrow" style="margin:0">${t}</div>`;

function sheetLot(id) {
  const l = S.lots[id]; if (!l) return;
  const frais = fraisLot(l, S.settings.pricing);
  const passe = Date.parse(l.date) < Date.now();
  openSheet(`${gal(l.photos)}${eyebrow(`${esc(l.tag)} · lot ${l.numero ?? '—'}`)}<h2 class="st">${esc(l.titre)}</h2>
    <div class="acts">${kindPill(l.kind)}${pill(STAT_LOT[l.statut]?.[0] || l.statut, STAT_LOT[l.statut]?.[1])}<span class="dim" style="font-size:13px;align-self:center">${esc(l.etude)} · ${esc(l.ville)}</span></div>
    <dl class="kv"><dt>Vente</dt><dd>${esc(fdate(l.date, { weekday: 'long', day: 'numeric', month: 'long' }))} à ${fheure(l.date)}<br><small class="dim">${esc(dans(l.date))}</small></dd><dt>Estimation</dt><dd>${eur(l.estMin)} – ${eur(l.estMax)}</dd><dt>Frais acheteur</dt><dd>${frais.toFixed(1).replace('.', ',')} %</dd>${l.depart ? `<dt>Mise à prix</dt><dd>${eur(l.depart)}</dd>` : ''}</dl>
    <div class="target" style="margin:0"><div class="t">🎯 Marteau max<b>${l.marteauMax ? eur(l.marteauMax) : 'indique ta revente'}</b></div><div class="eur"><input inputmode="numeric" placeholder="Revente" value="${l.revente || ''}" data-revente="${esc(l.id)}" style="padding-right:24px"></div></div>
    <p class="dim" style="font-size:14px;margin:14px 0;white-space:pre-line">${esc(l.description)}</p>
    ${l.statut === 'invendu' ? `<div class="card pad" style="margin-bottom:12px"><b>Lot peut-être invendu</b><p class="dim" style="font-size:13.5px;margin:4px 0 10px">Appelle l'étude pour faire une offre après-vente.</p><div class="acts">${l.contact?.tel ? `<a class="btn sec sm" href="tel:${esc(l.contact.tel)}">Appeler</a>` : ''}${l.contact?.email ? `<a class="btn sec sm" href="mailto:${esc(l.contact.email)}">Écrire</a>` : ''}</div></div>` : ''}
    <div class="block">
      ${l.itemId ? `<button class="btn sec full" data-open="item" data-id="${l.itemId}">Voir la pièce en stock ›</button>` : `
      <form class="card pad" style="display:grid;gap:10px" data-form="gagne" data-id="${esc(l.id)}"><b>${passe ? 'Tu l\'as remporté ?' : 'Déjà remporté ?'}</b><p class="dim" style="font-size:13px">Indique le prix au marteau : la pièce part en stock avec ses photos et je te propose un prix.</p><div class="inrow"><div class="eur"><input class="in" name="marteau" inputmode="numeric" placeholder="Prix au marteau" required></div><button class="btn ok" style="flex:none">Gagné</button></div></form>`}
      <div class="acts">${l.statut !== 'suivi' ? `<button class="btn sec" data-act="lot.suivre" data-id="${esc(l.id)}">Suivre</button>` : ''}${l.statut !== 'ignore' ? `<button class="btn ghost" data-act="lot.ignorer" data-id="${esc(l.id)}">Ignorer</button>` : ''}${passe && !l.itemId ? `<button class="btn ghost" data-act="lot.perdu" data-id="${esc(l.id)}">Perdu</button>` : ''}<a class="btn ghost" href="${esc(l.url)}" target="_blank" rel="noopener">Interenchères ${icon('arrow', 14)}</a></div>
    </div>`);
}

function sheetItem(id) {
  const i = S.items[id]; if (!i) return;
  const st = STAT_ITEM[i.statut];
  const a = i.annonce || {};
  const lbc = i.canaux?.leboncoin;
  const claude = S.settings.leboncoin?.mode === 'claude';
  const actif = i.statut !== 'vendu' && i.statut !== 'archive';
  const steps = ['prix', 'pret', 'en_ligne', 'vendu'];
  const si = Math.max(0, steps.indexOf(i.statut === 'reserve' ? 'en_ligne' : i.statut));
  openSheet(`${gal(i.photos)}${eyebrow(`${esc(i.id)} · ${esc(i.marque || i.categorie)}`)}<h2 class="st">${esc(a.titre || i.titre)}</h2>
    <div class="acts">${pill(st[0], st[1])}${i.lotId ? pill('Interenchères', '', 'no-dot') : ''}<span class="dim" style="font-size:13px;align-self:center">ajoutée ${esc(fdate(i.creeLe))}</span></div>
    <div class="track">${steps.map((_, k) => `<i class="${k <= si && i.statut !== 'archive' ? 'on' : ''}"></i>`).join('')}</div>
    <dl class="kv"><dt>Marteau</dt><dd>${eur(i.marteau)}</dd><dt>Frais</dt><dd>${String(i.frais).replace('.', ',')} %</dd><dt>Coût de revient</dt><dd><b>${eur(i.cout)}</b></dd><dt>Prix conseillé</dt><dd>${eur(i.prixConseille)}</dd>${i.prix ? `<dt>Prix de vente</dt><dd><b>${eur(i.prix)}</b> · marge ${eur(i.prix - i.cout)}</dd>` : ''}${i.vendu ? `<dt>Vendue</dt><dd>${eur(i.vendu.prix)} · ${esc(CANAUX[i.vendu.canal] || i.vendu.canal)} · ${esc(fdate(i.vendu.le))}</dd>` : ''}</dl>
    ${actif ? `<div class="block"><b>Prix de vente</b>${priceChips(i)}
      <form class="inrow" data-form="prix" data-id="${i.id}"><div class="eur"><input class="in" name="prix" inputmode="numeric" placeholder="Autre prix" value="${i.prix || ''}"></div><button class="btn sec" style="flex:none">Valider</button></form>
      <label class="tog card" style="padding:12px 14px"><span class="t"><b>Retrait à Lyon / Annecy</b><small>sinon : envoi uniquement</small></span><input type="checkbox" class="sw" data-act="item.retrait" data-id="${i.id}" ${i.retrait ? 'checked' : ''}></label>
      ${i.prix && i.statut !== 'en_ligne' ? `<button class="btn grd full" data-act="item.publier" data-id="${i.id}">${icon('bolt', 17)} Publier sur ${Object.keys(CANAUX).filter((c) => S.settings.canaux[c]).map((c) => CANAUX[c]).join(', ')}</button>` : ''}</div>` : ''}
    ${Object.keys(i.canaux || {}).length ? `<div class="block"><b>Annonces</b><div>${Object.entries(i.canaux).map(([c, v]) => `<div class="chan"><span>${CANAUX[c]}${v.err ? `<br><small class="err">${esc(v.err)}</small>` : ''}</span><span style="display:flex;gap:8px;align-items:center">${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener" class="link">voir ↗</a>` : ''}${pill(STAT_CANAL[v.statut]?.[0] || v.statut, STAT_CANAL[v.statut]?.[1] || '')}</span></div>`).join('')}</div></div>` : ''}
    ${lbc && ['a_coller', 'file_claude'].includes(lbc.statut) && i.statut === 'en_ligne' ? `<div class="card pad block" style="gap:10px"><b style="color:var(--ink)">${lbc.statut === 'file_claude' ? 'Leboncoin : en file pour Claude' : 'Leboncoin : prêt à coller'}</b><p class="dim" style="font-size:13px">${lbc.statut === 'file_claude' ? 'Claude la déposera depuis le Chrome de ton Mac. Tu peux aussi la publier toi-même : copie, colle, puis confirme.' : 'Ouvre l\'app Leboncoin › Déposer une annonce, copie, colle, puis confirme ici.'}</p>
      <div class="acts"><button class="btn sec sm" data-copy="titre" data-id="${i.id}">Titre</button><button class="btn sec sm" data-copy="desc" data-id="${i.id}">Description</button><button class="btn sec sm" data-copy="prix" data-id="${i.id}">Prix</button><a class="btn ghost sm" href="https://www.leboncoin.fr/deposer-une-annonce" target="_blank" rel="noopener">Leboncoin ${icon('arrow', 13)}</a></div>
      <form class="inrow" data-form="lbc" data-id="${i.id}"><input class="in" name="url" placeholder="Lien de l'annonce (facultatif)"><button class="btn ok" style="flex:none">Publiée</button></form></div>` : ''}
    ${lbc?.aSupprimer ? `<div class="card pad block" style="gap:10px"><b style="color:var(--ink)">Leboncoin : annonce à supprimer</b><p class="dim" style="font-size:13px">La pièce est vendue ou retirée ailleurs.${claude ? ' Claude la supprimera depuis ton Mac.' : ''}</p><div class="acts">${lbc.url ? `<a class="btn sec sm" href="${esc(lbc.url)}" target="_blank" rel="noopener">Ouvrir l'annonce</a>` : ''}<button class="btn ok sm" data-act="lbc.supprime" data-id="${i.id}">C'est supprimé</button></div></div>` : ''}
    <details class="block"><summary style="cursor:pointer;font-weight:550">Modifier le texte</summary>
      <form style="display:grid;gap:12px;margin-top:12px" data-form="texte" data-id="${i.id}"><label class="f">Titre<input class="in" name="titre" value="${esc(a.titre || i.titre)}"></label><div class="inrow"><label class="f">Marque<input class="in" name="marque" value="${esc(i.marque)}"></label><label class="f">Catégorie<select class="in" name="categorie">${CATS.map((c) => `<option ${c === (a.categorie || i.categorie) ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div><label class="f">Description<textarea class="in" name="description">${esc(a.description || i.description)}</textarea></label><button class="btn sec">Enregistrer</button></form>
    </details>
    ${actif ? `<div class="block"><b>Vendue ?</b><p class="dim" style="font-size:13px">${S.settings.auto?.retirerAilleurs === false ? 'Le retrait automatique ailleurs est désactivé.' : 'Je retire aussitôt les autres annonces.'}</p><div class="acts">${Object.entries({ ...CANAUX, autre: 'En direct' }).map(([k, n]) => `<button class="btn sec sm" data-act="item.vendu" data-id="${i.id}" data-canal="${k}">${n}</button>`).join('')}</div>
      ${i.statut === 'en_ligne' ? `<button class="btn ghost sm" style="justify-self:start" data-act="item.retirer" data-id="${i.id}">Retirer de la vente</button>` : ''}</div>` : ''}`);
}

function sheetOrder(id) {
  const o = S.orders[id]; if (!o) return;
  const i = S.items[o.itemId] || {};
  const st = STAT_CMD[o.statut] || [o.statut, ''];
  const opts = Object.entries(LIVRAISONS).filter(([k]) => k !== 'ebay' || o.canal === 'ebay');
  const ico = { cocolis: 'truck', colissimo: 'box', mondial_relay: 'box', retrait_lyon: 'home', retrait_annecy: 'home', main_propre: 'check', ebay: 'bag' };
  openSheet(`${gal(i.photos?.slice(0, 2))}${eyebrow(`${esc(o.id)} · ${esc(CANAUX[o.canal] || o.canal)}`)}<h2 class="st">${esc(i.titre)}</h2>
    <div class="acts">${pill(st[0], st[1])}</div>
    <dl class="kv"><dt>Prix</dt><dd><b>${eur(o.prix)}</b></dd><dt>Marge</dt><dd>${eur(o.prix - (i.cout || 0))}</dd><dt>Acheteur</dt><dd>${esc(o.acheteur || '—')}${o.ville ? ', ' + esc(o.ville) : ''}</dd><dt>Date</dt><dd>${esc(fdate(o.creeLe))} ${fheure(o.creeLe)}</dd>${o.suivi ? `<dt>Suivi</dt><dd>${esc(o.suivi)}</dd>` : ''}</dl>
    <div class="block"><b>Livraison · c'est toi qui choisis</b><div class="menu">${opts.map(([k, v]) => `<button data-act="commande.livraison" data-id="${o.id}" data-livraison="${k}" style="${o.livraison === k ? 'border-color:rgba(91,140,255,.6);background:rgba(91,140,255,.12)' : ''}">${icon(ico[k] || 'truck', 18)}<span>${esc(v)}</span></button>`).join('')}</div>
    ${o.livraison === 'cocolis' ? `<a class="btn sec" href="https://www.cocolis.fr/" target="_blank" rel="noopener">Créer l'envoi sur Cocolis ${icon('arrow', 14)}</a>` : ''}</div>
    <form class="block" data-form="commande" data-id="${o.id}"><b>Suivi</b>
      <label class="f">Statut<select class="in" name="statut">${STATUTS_COMMANDE.map((s) => `<option value="${s}" ${s === o.statut ? 'selected' : ''}>${STAT_CMD[s][0]}</option>`).join('')}</select></label>
      <label class="f">N° de suivi ou rendez-vous<input class="in" name="suivi" value="${esc(o.suivi || '')}"></label>
      <label class="f">Note<textarea class="in" name="note" style="min-height:80px">${esc(o.note || '')}</textarea></label>
      <button class="btn sec">Enregistrer</button></form>`);
}

function sheetNew() {
  openSheet(`${eyebrow('Stock')}<h2 class="h1" style="font-size:34px;margin:8px 0">Un <span class="serif grad">achat</span></h2><p class="sub">Hors veille (autre salle, brocante). Tu peux aussi écrire au bot : /achat 120 Verres de Sèvres, avec les photos.</p>
    <form class="block" data-form="new"><label class="f">Titre<input class="in" name="titre" required placeholder="Verres à cognac de Sèvres"></label><div class="inrow"><label class="f">Prix au marteau<div class="eur"><input class="in" name="marteau" inputmode="numeric" required></div></label><label class="f">Frais %<input class="in" name="frais" inputmode="decimal" value="${S.settings.pricing.fraisDefaut}"></label></div>
    <div class="inrow"><label class="f">Marque<input class="in" name="marque"></label><label class="f">Catégorie<select class="in" name="categorie">${CATS.map((c) => `<option>${c}</option>`).join('')}</select></label></div>
    <label class="f">Description<textarea class="in" name="description"></textarea></label><p class="dim" style="font-size:13px">Photos : envoie-les au bot Telegram avec la référence de la pièce en légende.</p><button class="btn grd">Ajouter au stock</button></form>`);
}

function sheetSecret(name) {
  const s = SECRETS.find((x) => x.n === name); if (!s) return;
  openSheet(`${eyebrow(`${icon('key', 13)} Secret GitHub`)}<h2 class="st mono" style="text-transform:none;letter-spacing:0;font-size:19px">${esc(s.n)}</h2><p class="sub">${esc(s.d)}</p>
    <form class="block" data-form="secret" data-id="${esc(s.n)}"><label class="f">Valeur<input class="in" name="value" type="password" autocomplete="off" required spellcheck="false" style="font-family:var(--mono);font-size:13px"></label>
      ${s.n === 'ECHOS_DATA_KEY' && cfg.pass ? `<button type="button" class="btn sec" data-act="secret.pass">Utiliser ma phrase secrète actuelle</button>` : ''}
      <button class="btn grd">${icon('key', 16)} Enregistrer dans GitHub</button>
      <p class="dim" style="font-size:12.5px">Chiffré sur cet appareil avec la clé publique du dépôt avant l'envoi : ni GitHub dans ses pages, ni personne ne peut le relire ensuite. ${secretOk(s.n) ? 'L\'ancienne valeur sera remplacée.' : ''}</p></form>`);
}

function sheetMenu() {
  openSheet(`${eyebrow('Navigation')}<h2 class="st">Console</h2><div class="menu" style="margin-top:12px">${Object.entries(VIEWS).map(([k, v]) => `<a href="#${k}" data-act="close-nav">${icon(v.i, 18)}<span>${v.t}</span>${badge(k)}</a>`).join('')}</div>
  <div class="block"><button class="btn sec full" data-act="run">${icon('bolt', 16)} Lancer un cycle du moteur</button><button class="btn ghost full" data-act="theme-btn">${icon('sun', 16)} Changer de thème</button></div>`);
}

function sheetQuick() {
  openSheet(`${eyebrow('Actions rapides')}<h2 class="st">Que veux-tu faire ?</h2><div class="menu" style="margin-top:12px">
    <button data-open="new">${icon('plus', 18)}<span>Nouvel achat</span></button>
    <button data-act="veille">${icon('radar', 18)}<span>Lancer une veille</span></button>
    <button data-act="pal">${icon('search', 18)}<span>Rechercher</span></button>
    <button data-act="ics">${icon('cal', 18)}<span>Agenda .ics</span></button>
    <a href="#connexions" data-act="close-nav">${icon('plug', 18)}<span>Connexions</span></a>
    <a href="#auto" data-act="close-nav">${icon('bolt', 18)}<span>Automatismes</span></a></div>`);
}

/* ================= palette ⌘K ================= */
let palSel = 0, palList = [];
function palItems(q) {
  q = q.trim().toLowerCase();
  const nav = Object.entries(VIEWS).map(([k, v]) => ({ g: 'Aller à', ic: v.i, t: v.t, run: () => { location.hash = '#' + k; } }));
  const acts = [
    { g: 'Actions', ic: 'plus', t: 'Nouvel achat', run: () => sheetNew() },
    { g: 'Actions', ic: 'radar', t: 'Lancer une veille Interenchères', run: () => runEngine(true) },
    { g: 'Actions', ic: 'bolt', t: 'Lancer un cycle du moteur', run: () => runEngine(false) },
    { g: 'Actions', ic: 'cal', t: 'Exporter l\'agenda (.ics)', run: () => ics() },
    { g: 'Actions', ic: 'sun', t: 'Changer de thème', run: () => toggleTheme() },
    { g: 'Actions', ic: 'key', t: 'Coffre des secrets', run: () => { location.hash = '#connexions'; setTimeout(() => $('#secrets')?.scrollIntoView({ behavior: 'smooth' }), 80); } },
  ];
  const ent = [
    ...items().map((i) => ({ g: 'Pièces', img: i.photos?.[0], t: i.titre, s: `${i.id} · ${STAT_ITEM[i.statut][0]}`, k: i.titre + ' ' + i.id + ' ' + i.marque, run: () => sheetItem(i.id) })),
    ...lots().filter((l) => l.statut !== 'ignore').map((l) => ({ g: 'Lots', img: l.photos?.[0], t: l.titre, s: `${KIND[l.kind]?.[0] || ''} · ${fdate(l.date)}`, k: l.titre + ' ' + l.etude + ' ' + l.ville, run: () => sheetLot(l.id) })),
    ...orders().map((o) => ({ g: 'Ventes', ic: 'bag', t: S.items[o.itemId]?.titre || o.id, s: `${o.id} · ${eur(o.prix)}`, k: o.id + ' ' + (o.acheteur || '') + ' ' + (S.items[o.itemId]?.titre || ''), run: () => sheetOrder(o.id) })),
  ];
  const m = (x) => !q || (x.t + ' ' + (x.k || '') + ' ' + (x.s || '')).toLowerCase().includes(q);
  return [...acts.filter(m), ...nav.filter(m), ...(q ? ent.filter(m).slice(0, 14) : [])];
}
function renderPal() {
  palList = palItems($('#palq').value);
  palSel = Math.min(palSel, Math.max(0, palList.length - 1));
  let g = '';
  $('#palr').innerHTML = palList.map((x, n) => { const h = x.g !== g ? `<div class="grp">${esc((g = x.g))}</div>` : ''; return `${h}<button class="${n === palSel ? 'sel' : ''}" data-pi="${n}">${x.img ? `<img class="th" style="width:28px;height:28px;border-radius:8px" src="${pic(x.img)}" alt="">` : `<span style="color:var(--dim)">${icon(x.ic || 'arrow', 18)}</span>`}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.t)}</span>${x.s ? `<small>${esc(x.s)}</small>` : ''}</button>`; }).join('') || `<div class="pad dim" style="font-size:14px">Aucun résultat.</div>`;
  $('#palr .sel')?.scrollIntoView({ block: 'nearest' });
}
function openPal() { if (!S) return; closeSheet(); $('#pal').classList.add('on'); $('#palq').value = ''; palSel = 0; renderPal(); setTimeout(() => $('#palq').focus(), 10); }
function closePal() { $('#pal').classList.remove('on'); }
function runPal(n) { const x = palList[n]; if (!x) return; closePal(); x.run(); }
$('#palq').addEventListener('input', () => { palSel = 0; renderPal(); });
$('#palq').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palList.length - 1); renderPal(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); renderPal(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); }
});
$('#pal').addEventListener('click', (e) => { const b = e.target.closest('[data-pi]'); if (b) return runPal(+b.dataset.pi); if (e.target.id === 'pal') closePal(); });

/* ================= actions ================= */
function render() {
  if (!S) return;
  const v = curView();
  const y = scrollY;
  $('#root').innerHTML = shell(VIEWS[v].r());
  document.title = `${VIEWS[v].t} · Échos Console`;
  if (render.same === v) scrollTo(0, y);
  render.same = v;
}

function ics() {
  const l = lots().filter((x) => x.statut === 'suivi' && Date.parse(x.date) > Date.now());
  if (!l.length) return toast('Aucune vente suivie à exporter', false);
  const d = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const e = (s) => String(s).replace(/[,;\\]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Echos des siecles//Admin//FR', ...l.flatMap((x) => ['BEGIN:VEVENT', `UID:${x.id}@echosdessiecles.fr`, `DTSTAMP:${d(new Date().toISOString())}`, `DTSTART:${d(x.date)}`, `DTEND:${d(new Date(Date.parse(x.date) + 3600e3).toISOString())}`, `SUMMARY:${e('Enchère · ' + x.titre.slice(0, 60))}`, `LOCATION:${e(x.etude + ' ' + x.ville)}`, `DESCRIPTION:${e(`Marteau max ${x.marteauMax || '?'} €\n${x.url}`)}`, 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Vente dans 2 h', 'END:VALARM', 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  a.download = 'echos-ventes.ics';
  a.click();
  toast(`${l.length} vente(s) exportée(s)`);
}

async function runEngine(veille) {
  if (mode === 'demo') return toast(veille ? 'Veille lancée · démo' : 'Cycle lancé · démo');
  try { await dispatch(veille); toast(veille ? 'Veille lancée : résultats dans 1 à 2 min' : 'Moteur lancé'); setSync('wait', 'Moteur en cours…'); setTimeout(() => loadRemote().then(render).catch(() => {}), 90e3); } catch (e) { toast(e.message, false); }
}
function toggleTheme(light) {
  const r = document.documentElement;
  r.dataset.theme = light ?? r.dataset.theme !== 'light' ? 'light' : 'dark';
  if (light === false) r.dataset.theme = 'dark';
  try { localStorage.setItem(THEME, r.dataset.theme); } catch {}
  $('meta[name=theme-color]').content = r.dataset.theme === 'light' ? '#f7f7f5' : '#09090b';
}
function setPath(path, val) {
  const [a, b] = path.split('.');
  return { type: 'reglages', patch: { [a]: { [b]: val } } };
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-open],[data-f],[data-copy],[data-scroll]');
  if (!t || t.matches('input[type=checkbox]')) return;
  if (e.target.closest('input,select,textarea') && !t.matches('button')) return;
  if (t.dataset.scroll) { e.preventDefault(); document.getElementById(t.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (t.dataset.f) { e.preventDefault(); f[t.dataset.f] = t.dataset.v; if (t.getAttribute('href')) location.hash = t.getAttribute('href'); render(); return; }
  if (t.dataset.copy) {
    const i = S.items[t.dataset.id];
    const a = i?.annonce || {};
    const txt = { titre: a.titre || i?.titre, desc: (a.description || i?.description || '') + (i?.retrait ? '\n\nRemise en main propre possible à Lyon et Annecy.' : ''), prix: String(i?.prix || '') }[t.dataset.copy];
    try { await navigator.clipboard.writeText(txt); toast('Copié'); } catch { toast('Copie impossible', false); }
    return;
  }
  if (t.dataset.open) {
    e.preventDefault();
    ({ lot: sheetLot, item: sheetItem, order: sheetOrder, new: sheetNew, secret: sheetSecret })[t.dataset.open](t.dataset.id);
    return;
  }
  const a = t.dataset.act, id = t.dataset.id;
  switch (a) {
    case 'close': return closeSheet();
    case 'close-nav': return closeSheet();
    case 'pal': return openPal();
    case 'menu': return sheetMenu();
    case 'quick': return sheetQuick();
    case 'theme-btn': toggleTheme(); return render();
    case 'logout': e.preventDefault(); cfg = { repo: cfg.repo }; saveCfg(); S = null; mode = null; closeSheet(); return showLogin();
    case 'reload': if (mode === 'live') { try { await loadRemote(); render(); toast('À jour'); } catch (err) { setSync('err', err.message); toast(err.message, false); } } else toast('Démo à jour'); return;
    case 'ics': closeSheet(); return ics();
    case 'run': closeSheet(); return runEngine(false);
    case 'veille': closeSheet(); return runEngine(true);
    case 'secret.pass': { const inp = $('#sheet [name=value]'); inp.value = cfg.pass; return $('#sheet [data-form=secret]').requestSubmit(); }
    case 'lbc.mode': return act({ type: 'reglages', patch: { leboncoin: { mode: t.dataset.v } } }, t.dataset.v === 'claude' ? 'Leboncoin : via Claude' : 'Leboncoin : mode assisté');
    case 'lbc.supprime': if (await act({ type: 'item.canal', id, channel: 'leboncoin', statut: S.items[id].canaux.leboncoin.statut === 'en_ligne' ? 'retire' : S.items[id].canaux.leboncoin.statut, aSupprimer: false }, 'Annonce Leboncoin supprimée')) sheetItem(id); return;
    case 'req.del': return act({ type: 'reglages', patch: { veille: { requetes: S.settings.veille.requetes.filter((r) => r.id !== id) } } }, 'Recherche supprimée');
    case 'req.toggle': { const r = S.settings.veille.requetes.find((x) => x.id === id); return act({ type: 'reglages', patch: { veille: { requetes: S.settings.veille.requetes.map((x) => (x.id === id ? { ...x, actif: !x.actif } : x)) } } }, r?.actif ? 'Recherche en pause' : 'Recherche active'); }
    case 'job.relancer': return act({ type: 'job.relancer', id }, 'Tâche relancée');
  }
  const map = {
    'lot.suivre': [{ type: a, id }, 'Lot suivi : rappel avant la vente'],
    'lot.ignorer': [{ type: a, id }, 'Lot ignoré'],
    'lot.perdu': [{ type: a, id }, 'Noté'],
    'item.prix': [{ type: a, id, prix: +t.dataset.prix }, `Prix fixé à ${eur(+t.dataset.prix)}`],
    'item.publier': [{ type: a, id }, 'Publication lancée partout'],
    'item.retirer': [{ type: a, id }, 'Retirée de la vente'],
    'item.vendu': [{ type: a, id, canal: t.dataset.canal }, 'Vente enregistrée, annonces retirées'],
    'commande.livraison': [{ type: a, id, livraison: t.dataset.livraison }, LIVRAISONS[t.dataset.livraison]],
  };
  if (map[a]) {
    const ok = await act(map[a][0], map[a][1]);
    if (ok && document.body.classList.contains('open')) {
      if (a === 'item.vendu') sheetOrder(Object.keys(S.orders).at(-1));
      else if (a.startsWith('item.')) sheetItem(id);
      else if (a.startsWith('lot.')) closeSheet();
      else if (a.startsWith('commande.')) sheetOrder(id);
    }
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.revente) { const r = num(t.value); act({ type: 'lot.revente', id: t.dataset.revente, revente: r }, r ? 'Marteau max recalculé' : 'Revente effacée').then(() => { if (document.body.classList.contains('open')) sheetLot(t.dataset.revente); }); }
  if (t.dataset.act === 'item.retrait') act({ type: 'item.retrait', id: t.dataset.id, retrait: t.checked }, t.checked ? 'Retrait possible' : 'Envoi uniquement');
  if (t.dataset.act === 'theme') { toggleTheme(t.checked); }
  if (t.dataset.tog) {
    const label = { 'integrations.veille': 'Veille', 'integrations.telegram': 'Telegram', 'integrations.ia': 'Rédaction IA', 'canaux.site': 'Site', 'canaux.ebay': 'eBay', 'canaux.leboncoin': 'Leboncoin' }[t.dataset.tog];
    act(setPath(t.dataset.tog, t.checked), label ? `${label} ${t.checked ? 'activé' : 'en pause'}` : t.checked ? 'Activé' : 'Désactivé');
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('[data-q]')) { f.q = t.value; clearTimeout(f.t); f.t = setTimeout(() => { render(); const i = $('[data-q]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 220); }
  if (t.matches('[data-sim]')) {
    const form = t.closest('form'); const fd = Object.fromEntries(new FormData(form));
    const p = { ...S.settings.pricing, ...Object.fromEntries(Object.entries(fd).map(([k, v]) => [k, num(v)]).filter(([, v]) => v != null)) };
    $('#simOut').innerHTML = simHtml(p, num($('#simH').value) || 0, num($('#simR').value) || 0);
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return $('#pal').classList.contains('on') ? closePal() : openPal(); }
  if (e.key === 'Escape') { closePal(); closeSheet(); }
  if (e.key === '/' && !e.target.closest('input,textarea,select') && S) { e.preventDefault(); openPal(); }
});
document.addEventListener('pointermove', (e) => {
  const c = e.target.closest?.('.card.glow'); if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', e.clientX - r.left + 'px'); c.style.setProperty('--my', e.clientY - r.top + 'px');
}, { passive: true });
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
    case 'lbc': if (await act({ type: 'item.canal', id, channel: 'leboncoin', statut: 'en_ligne', url: fd.url?.trim() || undefined }, 'Leboncoin : publiée')) sheetItem(id); return;
    case 'texte': if (await act({ type: 'item.modifier', id, titre: fd.titre, marque: fd.marque, categorie: fd.categorie, description: fd.description, annonce: { ...(S.items[id].annonce || {}), titre: fd.titre, description: fd.description, categorie: fd.categorie, marque: fd.marque } }, 'Texte enregistré')) sheetItem(id); return;
    case 'commande': if (await act({ type: 'commande.statut', id, statut: fd.statut, suivi: fd.suivi, note: fd.note }, 'Commande mise à jour')) sheetOrder(id); return;
    case 'new': if (await act({ type: 'item.creer', titre: fd.titre, marteau: num(fd.marteau), frais: num(fd.frais), marque: fd.marque, categorie: fd.categorie, description: fd.description }, 'Achat ajouté au stock')) { closeSheet(); location.hash = '#stock'; } return;
    case 'pricing': { const p = Object.fromEntries(['seuil', 'multHaut', 'multBas', 'fraisDefaut', 'fraisLive', 'arrondi'].map((k) => [k, num(fd[k])]).filter(([, v]) => v != null && v >= 0)); return act({ type: 'reglages', patch: { pricing: p } }, 'Règle de prix enregistrée'); }
    case 'req': if (!fd.q?.trim()) return; return act({ type: 'reglages', patch: { veille: { requetes: [...S.settings.veille.requetes, { id: 'r' + Date.now().toString(36), q: fd.q.trim(), tag: fd.tag, actif: true }] } } }, 'Recherche ajoutée');
    case 'veille': return act({ type: 'reglages', patch: { veille: { exclus: fd.exclus.split(',').map((s) => s.trim()).filter(Boolean), types: { live: !!fd.t_live, online: !!fd.t_online, classic: !!fd.t_classic }, estimationMin: num(fd.estimationMin) || 0, joursMax: num(fd.joursMax) || 45 }, rappels: { heures: fd.rappels.split(',').map(num).filter((n) => n > 0) } } }, 'Filtres enregistrés');
    case 'secret': {
      const btn = form.querySelector('.btn.grd'); btn.disabled = true;
      try { await setSecret(id, fd.value.trim()); closeSheet(); render(); toast(`${id} enregistré${mode === 'demo' ? ' · démo' : ''}`); }
      catch (err) { btn.disabled = false; toast(err.message, false); }
      return;
    }
  }
});

addEventListener('hashchange', () => { closeSheet(); closePal(); render(); scrollTo(0, 0); });
// Comptes à rebours vivants.
setInterval(() => { for (const el of document.querySelectorAll('[data-cd]')) { const p = Date.parse(el.dataset.cd) < Date.now(); el.textContent = p && el.classList.contains('cd') ? 'terminée' : dans(el.dataset.cd); } }, 30e3);

/* ================= connexion ================= */
function showLogin(err = '') {
  $('#root').innerHTML = `<div class="login"><div class="box reveal">
    <div class="orb"><svg width="38" height="38"><use href="#logo"/></svg></div>
    <div class="eyebrow" style="margin-top:22px"><i class="dot"></i>Échos des siècles</div>
    <h1 class="h1">La <span class="serif grad">console.</span></h1>
    <p class="sub">Veille Interenchères, prix, annonces sur le site, eBay et Leboncoin, ventes et livraisons. Tout au même endroit.</p>
    <form data-form="login">
      <label class="f">Phrase secrète<input class="in" name="pass" type="password" autocomplete="current-password" required minlength="12"></label>
      <label class="f">Jeton GitHub<input class="in" name="token" type="password" autocomplete="off" required value="${esc(cfg.token || '')}" placeholder="github_pat_…"></label>
      <details><summary class="dim" style="font-size:13px;cursor:pointer">Options</summary><label class="f" style="margin-top:10px">Dépôt<input class="in" name="repo" value="${esc(repo())}"></label></details>
      <label class="tog" style="padding:6px 0;border:0"><span class="t"><b style="font-size:13.5px;font-weight:500">Rester connecté sur cet appareil</b></span><input type="checkbox" class="sw" name="remember" checked></label>
      ${err ? `<p class="err">${esc(err)}</p>` : ''}
      ${!isSecureContext ? '<p class="err">Ouvre l\'admin en https:// pour te connecter (la démo marche partout).</p>' : ''}
      <button class="btn pri full">Entrer ${icon('arrow', 15)}</button>
      <button type="button" class="btn sec full" data-demo>Explorer la démo</button>
    </form>
    <p class="dim" style="font-size:12.5px;margin-top:18px">Données chiffrées AES-256 : seule ta phrase secrète permet de les lire, et elle ne quitte jamais cet appareil.</p>
  </div></div>`;
  $('[data-demo]').onclick = startDemo;
}
async function startDemo() { mode = 'demo'; S = demoState(); await loadSecrets(); setSync('ok', 'Synchronisé'); render(); }

async function doLogin(fd, form) {
  cfg = { repo: (fd.repo || DEFAULT_REPO).trim(), token: fd.token.trim(), pass: fd.pass, remember: !!fd.remember };
  form.querySelector('.btn.pri').disabled = true;
  try { mode = 'live'; await loadRemote(); saveCfg(); render(); }
  catch (e) { mode = null; showLogin(e.message); }
}

/* ================= démarrage ================= */
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  if (new URLSearchParams(location.search).has('demo')) return startDemo();
  if (cfg.token && cfg.pass) {
    mode = 'live';
    try { await loadRemote(); return render(); } catch (e) { mode = null; return showLogin(e.message); }
  }
  showLogin();
})();
// Rafraîchit quand on revient sur l'appli (téléphone).
document.addEventListener('visibilitychange', () => { if (!document.hidden && mode === 'live') loadRemote().then(render).catch(() => {}); });
