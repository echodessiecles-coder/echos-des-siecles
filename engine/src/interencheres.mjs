// Veille Interenchères. La recherche publique du site (sans connexion) bloque
// les serveurs (anti-robot) : en production, la veille passe par les alertes
// e-mail (voir alertes.mjs) ; searchLots ne sert que là où elle répond.
// garde les lots « art de la table » et « tableaux russes », calcule le
// marteau maximum et repère les ventes à venir.

import { fraisLot, marteauMax } from './pricing.mjs';
import { log, notify } from './model.mjs';

const SEARCH = process.env.INTERENCHERES_SEARCH_URL || 'https://search.interencheres.com/v1/search/ie4_items';
// Client honnête : on ne se fait pas passer pour un navigateur.
const UA = 'EchosDesSiecles-veille/1.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const https = (u) => (u ? (u.startsWith('//') ? 'https:' + u : u) : null);

export async function searchLots(query) {
  const url = SEARCH + '?query=' + encodeURIComponent(query);
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`Interenchères ${res.status} pour « ${query} »`);
  const data = await res.json();
  return Array.isArray(data) ? data : data?.items || data?.hits || [];
}

const MARQUES = ['Baccarat', 'Saint-Louis', 'Daum', 'Lalique', 'Sèvres', 'Haviland', 'Bernardaud', 'Raynaud', 'Christofle', 'Puiforcat', 'Ercuis', 'Gallé', 'Val Saint-Lambert', 'Limoges', 'Gien', 'Odiot', 'Tétard', 'Boulenger', 'Bernardaud'];

export function normalizeLot(it, requete) {
  const s = it.sale || {};
  const kind = s.sites?.interencheres?.type || (it.online ? 'online' : s.live ? 'live' : 'classic');
  const desc = (it.description_translations?.['fr-FR'] || it.description || '').trim();
  const titre = desc.split('\n')[0].replace(/\s+/g, ' ').slice(0, 110) || 'Lot ' + it.id;
  const photos = (it.medias || [])
    .filter((m) => !m.type || m.type === 'item_picture')
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((m) => https(m.url))
    .filter(Boolean);
  const org = it.organization || {};
  const rate = s.options?.commission_rate || {};
  const frais = Number.isFinite(rate.voluntary) ? rate.voluntary : Number.isFinite(rate.judicial) ? rate.judicial : undefined;
  const date = kind === 'online' ? it.online?.end_at || s.online?.end_at || s.datetime : s.start_at || s.datetime;
  const marque = MARQUES.find((m) => desc.toLowerCase().includes(m.toLowerCase())) || '';
  return {
    id: String(it.id),
    source: 'interencheres',
    titre,
    description: desc,
    marque,
    photos,
    kind, // live | online (chrono) | classic (catalogue, en salle)
    date,
    venteId: s.id,
    numero: it.meta?.order_number?.primary ?? null,
    estMin: it.pricing?.estimates?.min ?? null,
    estMax: it.pricing?.estimates?.max ?? null,
    depart: it.pricing?.starting_price ?? null,
    frais,
    etude: org.names?.voluntary || org.names?.judicial || org.address?.name || '',
    ville: s.address?.city || org.address?.city || '',
    cp: s.address?.postcode || org.address?.postcode || '',
    contact: { tel: org.address?.telephone || s.address?.telephone || '', email: org.address?.email || s.address?.email || '' },
    livraison: !!it.has_shipping,
    // Lien direct vérifié : la catégorie « art-decoration » et le libellé de vente sont libres, seuls les numéros comptent.
    url: it.url || it.link || (s.id ? `https://www.interencheres.com/art-decoration/vente-${s.id}/lot-${it.id}.html` : `https://www.interencheres.com/recherche/lots?search=${encodeURIComponent(titre.slice(0, 60))}`),
    requete: requete.q,
    tag: requete.tag,
  };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function pertinent(lot, settings) {
  const v = settings.veille;
  const txt = norm(lot.titre + ' ' + lot.description);
  // Mots exclus en mot entier (« vin » exclurait sinon les verres à vin).
  if (v.exclus.some((w) => w && new RegExp(`(^|[^a-z0-9])${norm(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(txt))) return false;
  if (!v.types[lot.kind]) return false;
  if (v.estimationMin && lot.estMax && lot.estMax < v.estimationMin) return false;
  // Au moins un mot significatif de la recherche doit apparaître dans la description.
  const words = norm(lot.requete).split(/\s+/).filter((w) => w.length > 3);
  return !words.length || words.some((w) => txt.includes(w));
}

/** Revente estimée : médiane de ses propres ventes de la même marque, sinon rien. */
export function reventeEstimee(state, lot) {
  if (!lot.marque) return null;
  const prix = Object.values(state.items).filter((i) => i.marque === lot.marque && (i.vendu?.prix || i.prix)).map((i) => i.vendu?.prix || i.prix).sort((a, b) => a - b);
  return prix.length ? prix[Math.floor(prix.length / 2)] : null;
}

/**
 * Fait entrer un lot (déjà normalisé) dans l'état : filtre, met à jour un lot connu
 * ou crée un nouveau lot avec son marteau maximum. Partagé par la veille par API
 * et par la veille par alertes e-mail. Renvoie 'nouveau', 'invendu', 'maj' ou null.
 */
export function ingestLot(state, lot, { nowMs = Date.now(), limite = Infinity } = {}) {
  const { pricing } = state.settings;
  const t = Date.parse(lot.date || '');
  if (Number.isFinite(t) && t > limite) return null;
  if (!pertinent(lot, state.settings)) return null;
  const old = state.lots[lot.id];
  if (old) {
    // Mise à jour des infos qui bougent (date, estimations), on garde ses choix.
    // Un champ inconnu dans la nouvelle source (ex. alerte e-mail) ne remplace pas l'ancien.
    const neuf = Object.fromEntries(Object.entries(lot).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
    Object.assign(old, { ...neuf, statut: old.statut, revente: old.revente, marteauMax: old.marteauMax, itemId: old.itemId, requete: old.requete, tag: old.tag, vuLe: old.vuLe, rappels: old.rappels, demandeResultat: old.demandeResultat });
    return 'maj';
  }
  const passe = Number.isFinite(t) && t < nowMs - 12 * 3600e3;
  lot.statut = passe ? 'invendu' : 'nouveau';
  lot.vuLe = new Date(nowMs).toISOString();
  lot.revente = reventeEstimee(state, lot);
  lot.marteauMax = marteauMax(lot.revente, fraisLot(lot, pricing), pricing);
  state.lots[lot.id] = lot;
  return lot.statut;
}

export async function runVeille(state, { maxNotifs = 12 } = {}) {
  const { veille } = state.settings;
  const nowMs = Date.now();
  const limite = nowMs + veille.joursMax * 86400e3;
  let nouveaux = 0, vus = 0, erreurs = 0;
  for (const r of veille.requetes.filter((x) => x.actif)) {
    let res;
    try { res = await searchLots(r.q); } catch (e) { erreurs++; log(state, e.message, 'warn'); continue; }
    for (const raw of res) {
      const lot = normalizeLot(raw, r);
      const k = ingestLot(state, lot, { nowMs, limite });
      if (!k) continue;
      vus++;
      if (k === 'maj') continue;
      nouveaux++;
      if (veille.alerteNouveaux && nouveaux <= maxNotifs) notify(state, k === 'invendu' ? 'invendu' : 'nouveau_lot', { lotId: lot.id });
    }
    await sleep(+(process.env.VEILLE_PAUSE_MS ?? 800)); // poli avec leur serveur
  }
  state.status.services.interencheres = { ok: erreurs === 0, le: new Date().toISOString(), vus, nouveaux, erreurs, source: 'api' };
  if (nouveaux > maxNotifs) notify(state, 'resume_veille', { lotId: 'resume', count: nouveaux });
  log(state, `Veille : ${vus} lots pertinents, ${nouveaux} nouveaux${erreurs ? `, ${erreurs} erreurs` : ''}`);
  return { vus, nouveaux, erreurs };
}

/** Rappels avant les ventes des lots suivis, et question « gagné ? » après. */
export function runRappels(state) {
  const nowMs = Date.now();
  for (const lot of Object.values(state.lots)) {
    if (lot.statut !== 'suivi') continue;
    const t = Date.parse(lot.date || '');
    if (!Number.isFinite(t)) continue;
    lot.rappels = lot.rappels || [];
    for (const h of state.settings.auto?.rappels === false ? [] : state.settings.rappels.heures) {
      const due = t - h * 3600e3;
      if (nowMs >= due && nowMs < t && !lot.rappels.includes(h)) {
        lot.rappels.push(h);
        notify(state, 'rappel', { lotId: lot.id, heures: h });
      }
    }
    // 1 h après la fin (3 h pour une vente live qui dure), on demande le résultat.
    const apres = t + (lot.kind === 'online' ? 1 : 3) * 3600e3;
    if (nowMs > apres && !lot.demandeResultat && state.settings.auto?.demanderResultat !== false) {
      lot.demandeResultat = new Date().toISOString();
      notify(state, 'resultat', { lotId: lot.id });
    }
  }
  // Ménage : lots non suivis dont la vente est passée depuis 30 jours.
  for (const [id, lot] of Object.entries(state.lots)) {
    const t = Date.parse(lot.date || '');
    if (['nouveau', 'ignore', 'perdu', 'invendu'].includes(lot.statut) && Number.isFinite(t) && t < nowMs - 30 * 86400e3) delete state.lots[id];
  }
}
