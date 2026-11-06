// Données d'exemple pour découvrir l'admin sans connexion (rien n'est envoyé).
import { emptyState, applyCommand } from '../engine/src/model.mjs';
import { marteauMax, fraisLot } from '../engine/src/pricing.mjs';

const H = 3600e3, D = 24 * H;
const at = (ms) => new Date(Date.now() + ms).toISOString();
const img = (n, s = 'a') => `../img/p${String(n).padStart(2, '0')}${s}.jpg`;

export function demoState() {
  const s = emptyState();
  const lots = [
    ['91001', 'Baccarat, suite de 12 verres à vin modèle Harcourt, cristal taillé', 'live', 1.2 * D, 300, 500, 'Art de la table', 'Hôtel des ventes de Lyon Brotteaux', 'Lyon', 'Baccarat', [14, 9], 'suivi', 2400],
    ['91002', 'Sèvres, service à thé en porcelaine bleu de four et or, XIXe', 'live', 2.4 * D, 200, 300, 'Art de la table', 'De Baecque et Associés', 'Lyon', 'Sèvres', [36], 'nouveau', null],
    ['91003', 'École russe XIXe, Paysage d\'hiver, huile sur toile signée', 'online', 0.3 * D, 800, 1200, 'Tableaux russes', 'Chartreuse Enchères', 'Annecy', '', [30], 'suivi', 3900],
    ['91004', 'Christofle, ménagère 48 pièces en métal argenté modèle Marly', 'online', 4.5 * D, 250, 350, 'Art de la table', 'Interenchères Chrono · Villeurbanne', 'Villeurbanne', 'Christofle', [12], 'nouveau', null],
    ['91005', 'Saint-Louis, carafe à whisky Tommy et 6 gobelets', 'classic', 6 * D, 150, 250, 'Art de la table', 'Imperial Enchères', 'Annecy', 'Saint-Louis', [9], 'nouveau', null],
    ['91006', 'Daum, coupe en cristal signée, vers 1960', 'live', 9 * D, 80, 120, 'Art de la table', 'Ader', 'Paris', 'Daum', [22], 'nouveau', 290],
    ['91007', 'Icône russe, Vierge de Kazan, tempera sur bois, oklad', 'live', -2 * D, 400, 600, 'Tableaux russes', 'Millon Riviera', 'Nice', '', [31], 'invendu', null],
  ];
  for (const [id, titre, kind, dt, estMin, estMax, tag, etude, ville, marque, ph, statut, revente] of lots) {
    const lot = { id, source: 'interencheres', titre, description: titre + '. Bon état général, petites égrenures possibles.', marque, photos: ph.flatMap((n) => [img(n), img(n, 'b')]), kind, date: at(dt), numero: 40 + +id.slice(-1), estMin, estMax, frais: 26, etude, ville, contact: { tel: '04 00 00 00 00', email: 'etude@exemple.fr' }, url: 'https://www.interencheres.com/', requete: tag, tag, statut, revente, vuLe: at(-3 * H) };
    lot.marteauMax = marteauMax(revente, fraisLot(lot, s.settings.pricing), s.settings.pricing);
    s.lots[id] = lot;
  }
  // Pièces en stock
  const add = (titre, marque, cat, marteau, ph, prix, etat) => {
    const it = applyCommand(s, { type: 'item.creer', titre, marque, categorie: cat, marteau, frais: 26, photos: [img(ph), img(ph, 'b')], description: titre + '. Pièce contrôlée à la main.' }) && Object.values(s.items).at(-1);
    if (prix) applyCommand(s, { type: 'item.prix', id: it.id, prix });
    if (etat === 'en_ligne' || etat === 'vendu') {
      applyCommand(s, { type: 'item.publier', id: it.id });
      it.canaux = { site: { statut: 'en_ligne', url: 'https://echosdessiecles.fr/#collection' }, ebay: { statut: 'en_ligne', url: 'https://www.ebay.fr/' }, leboncoin: { statut: 'en_ligne' } };
    }
    if (etat === 'lbc') {
      applyCommand(s, { type: 'item.publier', id: it.id });
      it.canaux = { site: { statut: 'en_ligne' }, ebay: { statut: 'en_ligne' }, leboncoin: { statut: 'a_coller' } };
    }
    if (etat === 'vendu') applyCommand(s, { type: 'item.vendu', id: it.id, canal: 'leboncoin', acheteur: 'Claire M.', ville: 'Villeurbanne' });
    return it;
  };
  add('Verres à cognac de Sèvres, suite de 18', 'Sèvres', 'Cristal', 820, 2, null);
  add('Coupes à champagne Ruinart, 6 pièces', 'Ruinart', 'Cristal', 45, 3, null);
  add('Picadilly, service avec carafe', 'Baccarat', 'Cristal', 145, 14, 540, 'en_ligne');
  add('Camargue, 6 verres à vin du Rhin', 'Saint-Louis', 'Cristal', 135, 9, 510, 'lbc');
  add('Cave à liqueurs en marqueterie', 'Napoléon III', 'Objets', 190, 17, 720, 'vendu');
  const o2 = add('Service à crème sur plateau', 'Porcelaine bleu et or', 'Porcelaine', 92, 36, 350, 'en_ligne');
  applyCommand(s, { type: 'item.vendu', id: o2.id, canal: 'site', acheteur: 'Paul D.', ville: 'Annecy' });
  applyCommand(s, { type: 'commande.livraison', id: Object.keys(s.orders).at(-1), livraison: 'retrait_annecy' });
  s.jobs = [];
  s.tg = { chatId: 1, nom: 'Stéphane', offset: 0 };
  s.status = { lastRun: at(-4 * 60e3), lastVeille: at(-35 * 60e3), services: { interencheres: { ok: true, vus: 186, nouveaux: 4 }, telegram: { ok: true, relie: true, nom: 'Stéphane' }, config: { telegram: true, ebay: true, ia: true, leboncoin: 'assiste' } } };
  s.log = [
    { t: at(-4 * 60e3), level: 'info', msg: 'Veille : 186 lots pertinents, 4 nouveaux' },
    { t: at(-2 * H), level: 'info', msg: 'Prix de P0003 fixé à 540 € (telegram)' },
    { t: at(-5 * H), level: 'warn', msg: 'eBay : catégorie à confirmer pour P0002' },
  ];
  return s;
}
