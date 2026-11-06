// Modèle de données + commandes (module pur, partagé entre le moteur et l'admin).
// Toute action (bouton de l'admin, réponse Telegram, tâche automatique) passe par
// applyCommand(), ce qui garantit le même comportement partout.

import { DEFAULT_PRICING, coutRevient, fraisLot, prixConseille, marteauMax } from './pricing.mjs';

export const STATUTS_LOT = ['nouveau', 'suivi', 'ignore', 'gagne', 'perdu', 'invendu'];
export const STATUTS_ITEM = ['prix', 'pret', 'en_ligne', 'reserve', 'vendu', 'archive'];
export const STATUTS_COMMANDE = ['nouvelle', 'livraison_a_choisir', 'a_preparer', 'expediee', 'remise', 'terminee', 'annulee'];
export const LIVRAISONS = {
  cocolis: 'Cocolis',
  colissimo: 'Colissimo',
  mondial_relay: 'Mondial Relay',
  retrait_lyon: 'Retrait à Lyon',
  retrait_annecy: 'Retrait à Annecy',
  main_propre: 'Remise en main propre (50 km)',
  ebay: 'Envoi eBay',
};
export const CANAUX = { site: 'Site', ebay: 'eBay', leboncoin: 'Leboncoin' };

export const DEFAULT_REQUETES = [
  ['baccarat', 'Art de la table'], ['saint-louis cristal', 'Art de la table'], ['daum cristal', 'Art de la table'],
  ['lalique', 'Art de la table'], ['sèvres porcelaine', 'Art de la table'], ['limoges service', 'Art de la table'],
  ['haviland', 'Art de la table'], ['christofle', 'Art de la table'], ['puiforcat', 'Art de la table'],
  ['ercuis', 'Art de la table'], ['service de verres cristal', 'Art de la table'], ['carafe cristal', 'Art de la table'],
  ['ménagère métal argenté', 'Art de la table'], ['service à thé argent', 'Art de la table'], ['cave à liqueur', 'Art de la table'],
  ['école russe', 'Tableaux russes'], ['peinture russe', 'Tableaux russes'], ['tableau russe', 'Tableaux russes'],
  ['huile sur toile russe', 'Tableaux russes'], ['icône russe', 'Tableaux russes'],
].map(([q, tag], i) => ({ id: 'r' + (i + 1), q, tag, actif: true }));

export function emptyState() {
  return {
    v: 1,
    settings: {
      pricing: { ...DEFAULT_PRICING },
      veille: {
        requetes: DEFAULT_REQUETES,
        exclus: ['photocopieur', 'véhicule', 'voiture', 'ordinateur', 'imprimante', 'pneus', 'outillage', 'grands vins', 'bouteilles de vin', 'reproduction'],
        types: { live: true, online: true, classic: true },
        estimationMin: 0,
        alerteNouveaux: true,
        joursMax: 45,
      },
      rappels: { heures: [24, 2] },
      canaux: { site: true, ebay: true, leboncoin: true },
      leboncoin: { mode: 'assiste' }, // 'assiste' (pack prêt à coller) | 'robot' (navigateur, voir docs)
    },
    lots: {},
    items: {},
    orders: {},
    jobs: [],
    tg: { chatId: null, offset: 0, attente: null },
    status: { lastRun: null, services: {} },
    seq: { item: 0, site: 1000, order: 0, job: 0 },
    log: [],
  };
}

/** Complète un état chargé avec les champs ajoutés depuis (migrations douces). */
export function normalize(state) {
  const base = emptyState();
  const s = { ...base, ...state };
  s.settings = { ...base.settings, ...(state.settings || {}) };
  s.settings.pricing = { ...base.settings.pricing, ...(s.settings.pricing || {}) };
  s.settings.veille = { ...base.settings.veille, ...(s.settings.veille || {}) };
  s.seq = { ...base.seq, ...(s.seq || {}) };
  s.tg = { ...base.tg, ...(s.tg || {}) };
  s.status = { ...base.status, ...(s.status || {}) };
  for (const k of ['lots', 'items', 'orders']) s[k] = s[k] || {};
  s.jobs = s.jobs || [];
  s.log = s.log || [];
  return s;
}

const now = () => new Date().toISOString();

export function log(state, msg, level = 'info') {
  state.log.unshift({ t: now(), level, msg });
  state.log.length = Math.min(state.log.length, 400);
}

export function job(state, type, data = {}) {
  // Pas de doublon d'une même tâche en attente.
  const key = JSON.stringify([type, data.itemId, data.orderId, data.channel, data.lotId, data.kind]);
  if (state.jobs.some((j) => j.key === key && !j.done)) return;
  state.jobs.push({ id: 'j' + ++state.seq.job, key, type, ...data, tries: 0, at: now() });
}

export const notify = (state, kind, data = {}) => job(state, 'notify', { kind, ...data });

/** Crée une pièce en stock à partir d'un lot gagné (ou d'une saisie manuelle). */
export function createItem(state, { lotId, titre, description, marteau, frais, photos, categorie, marque, cout }) {
  const lot = lotId ? state.lots[lotId] : null;
  const fraisPct = Number.isFinite(frais) ? frais : lot ? fraisLot(lot, state.settings.pricing) : state.settings.pricing.fraisDefaut;
  const c = Number.isFinite(cout) ? cout : coutRevient(marteau || 0, fraisPct);
  const id = 'P' + String(++state.seq.item).padStart(4, '0');
  state.items[id] = {
    id,
    siteId: ++state.seq.site,
    lotId: lotId || null,
    titre: titre || lot?.titre || 'Nouvelle pièce',
    description: description || lot?.description || '',
    marque: marque || lot?.marque || '',
    categorie: categorie || lot?.categorie || 'Objets',
    marteau: marteau ?? null,
    frais: fraisPct,
    cout: c,
    prixConseille: prixConseille(c, state.settings.pricing),
    prix: null,
    retrait: true,
    photos: photos || lot?.photos || [],
    statut: 'prix',
    canaux: {},
    creeLe: now(),
  };
  if (lot) lot.itemId = id;
  log(state, `Pièce ${id} créée : ${state.items[id].titre} (coût ${c} €)`);
  notify(state, 'prix', { itemId: id });
  return state.items[id];
}

function needItem(state, id) {
  const it = state.items[id];
  if (!it) throw new Error('Pièce inconnue : ' + id);
  return it;
}

function setChannelsToPublish(state, it) {
  for (const ch of Object.keys(CANAUX)) {
    if (!state.settings.canaux[ch]) continue;
    const cur = it.canaux[ch];
    if (cur?.statut === 'en_ligne') job(state, 'update', { itemId: it.id, channel: ch });
    else {
      it.canaux[ch] = { ...(cur || {}), statut: 'a_publier' };
      job(state, 'publish', { itemId: it.id, channel: ch });
    }
  }
}

/**
 * Applique une commande. `cmd` = { type, ...données, source }.
 * Ne fait AUCUN appel réseau : les effets (publier, prévenir) sont mis en file (state.jobs).
 */
export function applyCommand(state, cmd) {
  const src = cmd.source || 'admin';
  switch (cmd.type) {
    // ----- Veille -----
    case 'lot.suivre': {
      const l = state.lots[cmd.id]; if (!l) break;
      l.statut = 'suivi';
      if (cmd.revente) l.revente = +cmd.revente;
      break;
    }
    case 'lot.ignorer': { const l = state.lots[cmd.id]; if (l) l.statut = 'ignore'; break; }
    case 'lot.revente': {
      const l = state.lots[cmd.id]; if (!l) break;
      l.revente = +cmd.revente || null;
      l.marteauMax = marteauMax(l.revente, fraisLot(l, state.settings.pricing), state.settings.pricing);
      break;
    }
    case 'lot.perdu': { const l = state.lots[cmd.id]; if (l) l.statut = 'perdu'; break; }
    case 'lot.gagne': {
      const l = state.lots[cmd.id]; if (!l) break;
      if (l.itemId && state.items[l.itemId]) break; // déjà créé
      l.statut = 'gagne';
      l.marteauFinal = +cmd.marteau;
      createItem(state, { lotId: l.id, marteau: +cmd.marteau });
      break;
    }
    // ----- Stock -----
    case 'item.creer': {
      createItem(state, cmd);
      break;
    }
    case 'item.modifier': {
      const it = needItem(state, cmd.id);
      for (const k of ['titre', 'description', 'marque', 'categorie', 'retrait', 'photos', 'annonce']) if (k in cmd) it[k] = cmd[k];
      if (it.statut === 'en_ligne') setChannelsToPublish(state, it);
      break;
    }
    case 'item.prix': {
      const it = needItem(state, cmd.id);
      const prix = Math.round(+cmd.prix);
      if (!(prix > 0)) throw new Error('Prix invalide');
      it.prix = prix;
      it.prixFixeLe = now();
      log(state, `Prix de ${it.id} fixé à ${prix} € (${src})`);
      if (it.statut === 'prix') {
        it.statut = 'pret';
        notify(state, 'retrait', { itemId: it.id });
      } else if (it.statut === 'en_ligne') setChannelsToPublish(state, it);
      break;
    }
    case 'item.retrait': {
      const it = needItem(state, cmd.id);
      it.retrait = !!cmd.retrait;
      if (cmd.publier) applyCommand(state, { type: 'item.publier', id: it.id, source: src });
      break;
    }
    case 'item.publier': {
      const it = needItem(state, cmd.id);
      if (!it.prix) throw new Error('Fixe un prix avant de publier');
      it.statut = 'en_ligne';
      it.publieLe = it.publieLe || now();
      setChannelsToPublish(state, it);
      break;
    }
    case 'item.retirer': {
      const it = needItem(state, cmd.id);
      for (const ch of Object.keys(it.canaux)) if (it.canaux[ch]?.statut === 'en_ligne') job(state, 'unpublish', { itemId: it.id, channel: ch });
      it.statut = 'archive';
      break;
    }
    case 'item.canal': { // ex. Leboncoin publié à la main : { id, channel, statut, url }
      const it = needItem(state, cmd.id);
      it.canaux[cmd.channel] = { ...(it.canaux[cmd.channel] || {}), statut: cmd.statut, url: cmd.url || it.canaux[cmd.channel]?.url, le: now() };
      break;
    }
    case 'item.vendu': {
      const it = needItem(state, cmd.id);
      if (it.statut === 'vendu') break;
      it.statut = 'vendu';
      it.vendu = { prix: +cmd.prix || it.prix, canal: cmd.canal || 'autre', le: now() };
      // Retirer partout ailleurs pour éviter la double vente.
      for (const ch of Object.keys(it.canaux)) {
        if (it.canaux[ch]?.statut === 'en_ligne' || it.canaux[ch]?.statut === 'a_publier') job(state, 'unpublish', { itemId: it.id, channel: ch, sold: true });
      }
      const oid = 'C' + String(++state.seq.order).padStart(4, '0');
      state.orders[oid] = {
        id: oid, itemId: it.id, canal: it.vendu.canal, prix: it.vendu.prix,
        acheteur: cmd.acheteur || null, ville: cmd.ville || null, externeId: cmd.externeId || null,
        livraison: cmd.livraison || null, statut: cmd.livraison ? 'a_preparer' : 'livraison_a_choisir',
        note: cmd.note || '', creeLe: now(),
      };
      log(state, `Vente ${oid} : ${it.titre} à ${it.vendu.prix} € (${it.vendu.canal})`);
      notify(state, 'commande', { orderId: oid });
      break;
    }
    // ----- Commandes -----
    case 'commande.livraison': {
      const o = state.orders[cmd.id]; if (!o) throw new Error('Commande inconnue');
      if (!LIVRAISONS[cmd.livraison]) throw new Error('Mode de livraison inconnu');
      o.livraison = cmd.livraison;
      o.statut = 'a_preparer';
      log(state, `Commande ${o.id} : ${LIVRAISONS[cmd.livraison]}`);
      if (cmd.livraison === 'cocolis') notify(state, 'cocolis', { orderId: o.id });
      break;
    }
    case 'commande.statut': {
      const o = state.orders[cmd.id]; if (!o) throw new Error('Commande inconnue');
      o.statut = cmd.statut;
      if (cmd.suivi) o.suivi = cmd.suivi;
      if (cmd.note != null) o.note = cmd.note;
      break;
    }
    // ----- Réglages -----
    case 'reglages': {
      const patch = cmd.patch || {};
      for (const k of Object.keys(patch)) {
        state.settings[k] = typeof patch[k] === 'object' && !Array.isArray(patch[k]) ? { ...state.settings[k], ...patch[k] } : patch[k];
      }
      // Recalcule les marteaux max avec les nouveaux réglages.
      for (const l of Object.values(state.lots)) if (l.revente) l.marteauMax = marteauMax(l.revente, fraisLot(l, state.settings.pricing), state.settings.pricing);
      break;
    }
    case 'job.relancer': {
      const j = state.jobs.find((x) => x.id === cmd.id);
      if (j) { j.tries = 0; j.err = null; j.done = false; j.nextAt = null; }
      break;
    }
    default:
      throw new Error('Commande inconnue : ' + cmd.type);
  }
  return state;
}
