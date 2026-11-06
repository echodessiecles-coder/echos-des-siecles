// Règles de prix d'Échos des siècles (module pur, partagé avec l'admin).
// - Achat > 100 € (frais compris) : revente = achat × 3.
// - Achat ≤ 100 € : multiple plus élevé (× 4 par défaut, réglable).
// - Le prix final est TOUJOURS choisi par Stéphane : on ne fait que proposer.

export const DEFAULT_PRICING = {
  seuil: 100,        // € : au-dessus, multiple « haut »
  multHaut: 3,
  multBas: 4,
  fraisDefaut: 28,   // % TTC frais acheteur si la vente ne les indique pas
  fraisLive: 3.6,    // % TTC ajoutés par Interenchères Live
  arrondi: 10,       // arrondi des prix de vente proposés
};

const P = (s) => ({ ...DEFAULT_PRICING, ...(s || {}) });

export const roundTo = (n, step = 10) => (step ? Math.max(step, Math.round(n / step) * step) : Math.round(n));

/** Frais acheteur totaux (en %) d'un lot. */
export function fraisLot(lot, settings) {
  const s = P(settings);
  const base = Number.isFinite(lot?.frais) ? lot.frais : s.fraisDefaut;
  return base + (lot?.kind === 'live' ? s.fraisLive : 0);
}

/** Coût de revient = prix au marteau + frais acheteur. */
export const coutRevient = (marteau, fraisPct) => Math.round(marteau * (1 + fraisPct / 100) * 100) / 100;

export const multiple = (cout, settings) => {
  const s = P(settings);
  return cout > s.seuil ? s.multHaut : s.multBas;
};

/** Prix de vente conseillé pour un coût de revient donné. */
export function prixConseille(cout, settings) {
  const s = P(settings);
  return roundTo(cout * multiple(cout, s), s.arrondi);
}

/** Trois propositions de prix (boutons Telegram / admin). La première est la règle. */
export function propositions(cout, settings) {
  const s = P(settings);
  const m = multiple(cout, s);
  const mults = cout > s.seuil ? [m, m - 0.5, m + 0.5] : [m, m + 1, m + 2];
  return [...new Set(mults.map((k) => roundTo(cout * k, s.arrondi)))].map((prix, i) => ({ prix, mult: mults[i], regle: i === 0 }));
}

/**
 * Prix maximum à mettre au marteau pour revendre `revente` en respectant la règle.
 * On cherche le marteau H tel que prixConseille(coût(H)) ≈ revente.
 */
export function marteauMax(revente, fraisPct, settings) {
  const s = P(settings);
  if (!revente || revente <= 0) return null;
  const k = 1 + fraisPct / 100;
  const hHaut = revente / s.multHaut / k; // si le coût dépasse le seuil
  if (hHaut * k > s.seuil) return Math.floor(hHaut / 5) * 5;
  const hBas = revente / s.multBas / k;
  return Math.max(0, Math.floor(Math.min(hBas, s.seuil / k) / 5) * 5);
}

/** Marge brute d'une vente. */
export const marge = (prixVente, cout) => Math.round((prixVente - cout) * 100) / 100;
