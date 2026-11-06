// Rédaction des annonces avec l'API Claude (facultatif, payé à l'usage).
// Sans clé ANTHROPIC_API_KEY, on garde le texte de la salle des ventes.
// Coût indicatif : ~1 500 jetons par annonce avec Claude Haiku 5.5, soit moins
// d'un centime ; 20 annonces par mois coûtent quelques centimes.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
export const iaActive = () => !!process.env.ANTHROPIC_API_KEY;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titre', 'description', 'categorie', 'marque', 'categorieLbc', 'motsClesEbay'],
  properties: {
    titre: { type: 'string', description: 'Titre vendeur, 80 caractères maximum' },
    description: { type: 'string', description: 'Description de 3 à 6 phrases, honnête, avec état et dimensions si connues' },
    categorie: { type: 'string', enum: ['Cristal', 'Porcelaine', 'Argenterie', 'Objets', 'Tableaux'] },
    marque: { type: 'string', description: 'Manufacture ou artiste, ou chaîne vide' },
    categorieLbc: { type: 'string', description: 'Catégorie Leboncoin la plus adaptée' },
    motsClesEbay: { type: 'string', description: 'Requête courte pour trouver la catégorie eBay' },
  },
};

const SYSTEM = `Tu rédiges les annonces d'Échos des siècles, antiquaire à Lyon spécialisé dans l'art de la table (cristal, porcelaine, argenterie) et les tableaux russes.
Ton : élégant, précis, jamais exagéré. N'invente rien : pas de date, de poinçon ou de dimension absents du texte source. Mentionne l'état si le texte en parle.
N'indique jamais le prix d'achat, la salle des ventes ni le numéro de lot.`;

export async function redigerAnnonce(item) {
  if (!iaActive()) return null;
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Texte de la salle des ventes :\n${item.description || item.titre}\n\nTitre actuel : ${item.titre}\nPrix de vente : ${item.prix} €` }],
  });
  if (res.stop_reason === 'refusal') return null;
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}
