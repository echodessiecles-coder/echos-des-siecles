// Test de bout en bout, sans réseau : Interenchères et Telegram sont simulés.
// Lot trouvé → suivi → gagné (marteau via Telegram) → prix → retrait → publié
// sur le site (index.html réécrit) + pack Leboncoin → vendu → livraison choisie.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'echos-'));
await fs.copyFile(path.join(repo, 'index.html'), path.join(root, 'index.html'));
await fs.mkdir(path.join(root, 'img'));
process.env.SITE_ROOT = root;
process.env.ECHOS_DATA_KEY = 'phrase-de-test-assez-longue';
process.env.TELEGRAM_BOT_TOKEN = 'TEST';
process.env.VEILLE_PAUSE_MS = '0';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.EBAY_CLIENT_ID;

// JPEG minimal 4x3 (en-tête SOF0 suffisant pour le calcul du ratio)
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x04, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
const inFuture = new Date(Date.now() + 3 * 864e5).toISOString();
const LOT = {
  id: 555, description_translations: { 'fr-FR': 'Baccarat, suite de 12 verres à vin modèle Harcourt\nCristal taillé, bon état' },
  medias: [{ url: '//thumbor.example/a.jpg', type: 'item_picture', rank: 0 }],
  pricing: { estimates: { min: 300, max: 500 } }, meta: { order_number: { primary: 12 } },
  organization: { names: { voluntary: 'Hôtel des ventes test' }, address: { city: 'Lyon', telephone: '0400', email: 'a@b.fr' } },
  sale: { id: 9, datetime: inFuture, sites: { interencheres: { type: 'live' } }, options: { commission_rate: { voluntary: 25 } }, address: { city: 'Lyon' } },
};

const sent = [];
let updates = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  const json = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('search.interencheres.com')) return json(url.includes('baccarat') ? [LOT] : []);
  if (url.includes('thumbor.example')) return new Response(JPEG);
  if (url.includes('api.telegram.org')) {
    const method = url.split('/').pop();
    const body = opt.body ? JSON.parse(opt.body) : {};
    if (method === 'getUpdates') { const u = updates; updates = []; return json({ ok: true, result: u }); }
    sent.push({ method, ...body });
    return json({ ok: true, result: { message_id: sent.length } });
  }
  throw new Error('URL inattendue ' + url);
};

const { tick } = await import('../src/run.mjs');
const { loadState } = await import('../src/store.mjs');
let uid = 1;
const msg = (text) => ({ update_id: uid++, message: { chat: { id: 42, type: 'private' }, from: { first_name: 'Stéphane' }, text } });
const cb = (data) => ({ update_id: uid++, callback_query: { id: 'q' + uid, data, from: { first_name: 'Stéphane' }, message: { chat: { id: 42 }, message_id: 1 } } });
const textes = () => sent.map((s) => s.text || s.caption || '').join('\n---\n');

test('parcours complet', async () => {
  updates = [msg('/start')];
  await tick({ forceVeille: true });
  let s = await loadState(root);
  assert.equal(s.tg.chatId, 42, 'Telegram relié au premier /start');
  assert.ok(s.lots['555'], 'lot trouvé par la veille');
  assert.equal(s.lots['555'].kind, 'live');
  assert.match(textes(), /Nouveau lot/);

  updates = [cb('S|555'), cb('M|555')];
  await tick();
  updates = [msg('2400')];
  await tick();
  s = await loadState(root);
  assert.equal(s.lots['555'].statut, 'suivi');
  // revente 2400, frais 25 + 3,6 = 28,6 % → 2400 / 3 / 1,286 ≈ 622 → 620
  assert.equal(s.lots['555'].marteauMax, 620);

  updates = [cb('G|555')];
  await tick();
  updates = [msg('600')];
  await tick();
  s = await loadState(root);
  const it = Object.values(s.items)[0];
  assert.ok(it, 'pièce créée');
  assert.equal(it.cout, 771.6);
  assert.equal(it.prixConseille, 2310);
  assert.match(textes(), /Quel prix/);

  updates = [cb(`P|${it.id}|2300`)];
  await tick();
  updates = [cb(`R|${it.id}|1`)];
  await tick();
  s = await loadState(root);
  const it2 = s.items[it.id];
  assert.equal(it2.statut, 'en_ligne');
  assert.equal(it2.canaux.site.statut, 'en_ligne');
  assert.equal(it2.canaux.leboncoin.statut, 'a_coller');
  assert.equal(it2.canaux.ebay.statut, 'non_configure');
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const P = JSON.parse(html.match(/^const P=(\[.*\]);$/m)[1]);
  assert.equal(P[0].id, it2.siteId);
  assert.equal(P[0].price, 2300);
  assert.equal(P[0].ar, 1.333);
  assert.match(textes(), /Leboncoin, prêt à coller/);

  updates = [cb(`W|${it.id}|leboncoin`)];
  await tick();
  s = await loadState(root);
  const o = Object.values(s.orders)[0];
  assert.equal(o.statut, 'livraison_a_choisir');
  const P2 = JSON.parse((await fs.readFile(path.join(root, 'index.html'), 'utf8')).match(/^const P=(\[.*\]);$/m)[1]);
  assert.equal(P2[0].sold, true, 'marqué vendu sur le site');

  updates = [cb(`D|${o.id}|cocolis`)];
  await tick();
  s = await loadState(root);
  assert.equal(s.orders[o.id].livraison, 'cocolis');
  assert.match(textes(), /Cocolis/);
});

test('commandes de l\'admin (inbox chiffrée)', async () => {
  const { encryptJSON } = await import('../src/crypto.mjs');
  await fs.mkdir(path.join(root, 'data', 'inbox'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'inbox', '1.enc'), await encryptJSON([{ type: 'item.creer', titre: 'Coupes Ruinart', marteau: 40, frais: 25 }], process.env.ECHOS_DATA_KEY));
  await tick();
  const s = await loadState(root);
  const it = Object.values(s.items).find((i) => i.titre === 'Coupes Ruinart');
  assert.ok(it);
  assert.equal(it.cout, 50);
  assert.equal(it.prixConseille, 200); // ≤ 100 € → × 4
  assert.deepEqual(await fs.readdir(path.join(root, 'data', 'inbox')), []);
});
