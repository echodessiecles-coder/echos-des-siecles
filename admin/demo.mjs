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
  // Historique de ventes (graphique des 30 derniers jours).
  const histo = [
    ['Verres à porto Baccarat, 6 pièces', 'Baccarat', 'Cristal', 60, 4, 280, 'site', 27],
    ['Assiettes à dessert Haviland, 12', 'Haviland', 'Porcelaine', 40, 5, 190, 'leboncoin', 24],
    ['Seau à champagne Christofle', 'Christofle', 'Argenterie', 85, 6, 330, 'ebay', 21],
    ['Carafe Saint-Louis Tommy', 'Saint-Louis', 'Cristal', 120, 7, 460, 'site', 18],
    ['Tasses à café Sèvres, 6', 'Sèvres', 'Porcelaine', 70, 8, 290, 'leboncoin', 15],
    ['Coupe Daum signée', 'Daum', 'Cristal', 55, 10, 240, 'ebay', 12],
    ['Paysage d\'hiver, école russe', 'École russe', 'Tableaux', 380, 30, 1450, 'site', 9],
    ['Verres à eau Lalique, 6', 'Lalique', 'Cristal', 160, 11, 620, 'leboncoin', 6],
    ['Ménagère Ercuis 37 pièces', 'Ercuis', 'Argenterie', 140, 12, 540, 'ebay', 3],
  ];
  for (const [titre, marque, cat, marteau, ph, prix, canal, j] of histo) {
    const it = add(titre, marque, cat, marteau, ph, prix, 'en_ligne');
    applyCommand(s, { type: 'item.vendu', id: it.id, canal, acheteur: 'Client', ville: 'Lyon' });
    const o = Object.values(s.orders).at(-1);
    it.vendu.le = o.creeLe = at(-j * D - 5 * H);
    it.creeLe = at(-(j + 9) * D);
    o.livraison = canal === 'ebay' ? 'colissimo' : 'retrait_lyon';
    o.statut = 'terminee';
    for (const c of Object.keys(it.canaux)) it.canaux[c] = { statut: c === canal ? 'vendu' : 'retire' };
  }
  // Leboncoin « via Claude » : une annonce en file, une à supprimer.
  s.settings.leboncoin.mode = 'claude';
  const q = Object.values(s.items).find((i) => i.canaux?.leboncoin?.statut === 'a_coller');
  if (q) q.canaux.leboncoin = { statut: 'file_claude' };
  const vendue = Object.values(s.items).find((i) => i.titre.startsWith('Cave à liqueurs'));
  if (vendue) vendue.canaux.leboncoin = { statut: 'vendu', aSupprimer: true };
  s.jobs = [{ id: 'j90', type: 'publish', itemId: 'P0002', channel: 'ebay', tries: 3, err: 'Catégorie eBay à confirmer', at: at(-5 * H) }];
  s.tg = { chatId: 1, nom: 'Stéphane', offset: 0, bot: 'EchosDesSieclesBot' };
  s.status = { lastRun: at(-4 * 60e3), lastVeille: at(-35 * 60e3), saved: at(-4 * 60e3), services: { interencheres: { ok: true, le: at(-35 * 60e3), vus: 186, nouveaux: 4, erreurs: 0 }, telegram: { ok: true, le: at(-4 * 60e3), relie: true, nom: 'Stéphane', bot: 'EchosDesSieclesBot' }, ebay: { ok: true, le: at(-9 * 60e3) }, config: { telegram: true, ebay: true, ia: true, leboncoin: 'claude' } } };
  s.log = [
    { t: at(-4 * 60e3), level: 'info', msg: 'Veille : 186 lots pertinents, 4 nouveaux' },
    { t: at(-2 * H), level: 'info', msg: 'Prix de P0003 fixé à 540 € (telegram)' },
    { t: at(-3 * H), level: 'info', msg: 'Vente C0002 : Service à crème sur plateau à 350 € (site)' },
    { t: at(-5 * H), level: 'warn', msg: 'eBay : catégorie à confirmer pour P0002' },
    { t: at(-26 * H), level: 'info', msg: 'Leboncoin : annonce de P0004 mise en file pour Claude' },
    { t: at(-30 * H), level: 'error', msg: 'ebay : jeton expiré, renouvelé automatiquement' },
  ];
  return s;
}
