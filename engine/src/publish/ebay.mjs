// Publication eBay via l'API officielle « Sell » (Inventory + Fulfillment).
// Pré-requis (une fois) : compte développeur eBay, appli en production, jeton
// utilisateur (refresh token, valable 18 mois) et politiques vendeur (livraison,
// paiement, retour) créées dans le compte eBay. Voir docs/ADMIN.md.

const API = process.env.EBAY_API_URL || 'https://api.ebay.com';
const MARKET = 'EBAY_FR';
const TREE = '71'; // arbre de catégories eBay France
export const ebayActif = () => !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET && process.env.EBAY_REFRESH_TOKEN);

let token = null;
async function accessToken() {
  if (token && token.exp > Date.now() + 60e3) return token.value;
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${API}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.EBAY_REFRESH_TOKEN,
      scope: 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.account',
    }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error('eBay connexion : ' + (d.error_description || res.status));
  token = { value: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return token.value;
}

async function call(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: {
      authorization: 'Bearer ' + (await accessToken()),
      'content-type': 'application/json',
      'content-language': 'fr-FR',
      'accept-language': 'fr-FR',
      'x-ebay-c-marketplace-id': MARKET,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('eBay : ' + (d.errors?.map((e) => e.longMessage || e.message).join(' · ') || res.status));
  return d;
}

async function categorie(q) {
  if (process.env.EBAY_CATEGORY_ID) return process.env.EBAY_CATEGORY_ID;
  const d = await call('GET', `/commerce/taxonomy/v1/category_tree/${TREE}/get_category_suggestions?q=${encodeURIComponent(q)}`);
  const id = d?.categorySuggestions?.[0]?.category?.categoryId;
  if (!id) throw new Error('eBay : pas de catégorie trouvée pour « ' + q + ' »');
  return id;
}

const sku = (item) => 'EDS-' + item.id;

export async function publishEbay(state, item, { photoUrl }) {
  const a = item.annonce || {};
  const imageUrls = item.photos.slice(0, 12).map(photoUrl);
  if (!imageUrls.length) throw new Error('aucune photo');
  const titre = (a.titre || item.titre).slice(0, 80);
  const desc = `<p>${(a.description || item.description || titre).replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>${item.retrait ? '<p>Remise en main propre possible à Lyon et Annecy.</p>' : ''}<p>Échos des siècles · echosdessiecles.fr</p>`;
  await call('PUT', `/sell/inventory/v1/inventory_item/${sku(item)}`, {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: process.env.EBAY_CONDITION || 'USED_EXCELLENT',
    product: { title: titre, description: desc, imageUrls, aspects: item.marque ? { Marque: [item.marque] } : {} },
  });
  const offre = {
    sku: sku(item),
    marketplaceId: MARKET,
    format: 'FIXED_PRICE',
    availableQuantity: 1,
    categoryId: await categorie(a.motsClesEbay || item.marque + ' ' + (item.categorie || '') || titre),
    listingDescription: desc,
    listingPolicies: {
      fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID,
      paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID,
      returnPolicyId: process.env.EBAY_RETURN_POLICY_ID,
    },
    merchantLocationKey: process.env.EBAY_LOCATION_KEY || 'lyon',
    pricingSummary: { price: { value: String(item.prix), currency: 'EUR' } },
  };
  let offerId = item.canaux.ebay?.offerId;
  if (offerId) await call('PUT', `/sell/inventory/v1/offer/${offerId}`, offre);
  else offerId = (await call('POST', '/sell/inventory/v1/offer', offre)).offerId;
  const pub = await call('POST', `/sell/inventory/v1/offer/${offerId}/publish`);
  return { offerId, listingId: pub?.listingId, url: pub?.listingId ? `https://www.ebay.fr/itm/${pub.listingId}` : null };
}

export async function unpublishEbay(state, item) {
  const offerId = item.canaux.ebay?.offerId;
  if (!offerId) return;
  try { await call('POST', `/sell/inventory/v1/offer/${offerId}/withdraw`); } catch (e) { if (!/not.*published|25713/i.test(e.message)) throw e; }
}

/** Ventes eBay depuis le dernier passage → commandes dans l'admin. */
export async function syncEbayOrders(state, applyCommand) {
  const since = state.status.services.ebay?.ordersSince || new Date(Date.now() - 3 * 86400e3).toISOString();
  const d = await call('GET', `/sell/fulfillment/v1/order?filter=${encodeURIComponent(`creationdate:[${since}..]`)}&limit=50`);
  for (const o of d?.orders || []) {
    const s = o.lineItems?.[0]?.sku || '';
    const id = s.replace(/^EDS-/, '');
    const it = state.items[id];
    if (!it || it.statut === 'vendu') continue;
    const ship = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    applyCommand(state, {
      type: 'item.vendu', id, canal: 'ebay', prix: +o.pricingSummary?.total?.value || it.prix,
      acheteur: ship?.fullName || o.buyer?.username, ville: ship?.contactAddress?.city, externeId: o.orderId, livraison: 'ebay', source: 'ebay',
    });
  }
  state.status.services.ebay = { ...(state.status.services.ebay || {}), ok: true, le: new Date().toISOString(), ordersSince: new Date(Date.now() - 3600e3).toISOString() };
}
