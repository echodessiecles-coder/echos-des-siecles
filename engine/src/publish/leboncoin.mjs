// Leboncoin n'a pas d'API publique pour les particuliers, et ses conditions
// d'utilisation interdisent les robots : un compte peut être suspendu, et les
// serveurs cloud (GitHub, VPS) sont bloqués par leur anti-robot.
//
// Mode « assisté » (par défaut, sans risque) : le moteur prépare l'annonce
// complète (titre, description, prix, catégorie, photos) et l'envoie sur
// Telegram ; Stéphane la colle dans l'app en 30 secondes et appuie sur
// « C'est publié ». À la vente ailleurs, le bot rappelle de la supprimer.
//
// Mode « robot » : prévu pour tourner sur le Mac (IP et session de Stéphane),
// à valider ensemble avant activation. Voir docs/ADMIN.md.

import { notify } from '../model.mjs';

export async function publishLeboncoin(state, item) {
  if (item.canaux.leboncoin?.statut === 'en_ligne') return { statut: 'en_ligne' };
  notify(state, 'leboncoin_pack', { itemId: item.id });
  return { statut: 'a_coller' };
}

export async function unpublishLeboncoin(state, item) {
  notify(state, 'erreur', { itemId: item.id, message: `Pense à supprimer l'annonce Leboncoin de « ${item.titre} » (${item.id}) : elle est vendue ou retirée ailleurs.` });
}
