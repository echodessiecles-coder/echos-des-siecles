// Veille par alertes e-mail : extraction des lots d'une alerte Interenchères
// et passage complet avec une boîte IMAP simulée.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAlerte, lotDepuisLien, trouverDate, imapHost, runVeilleMail } from '../src/alertes.mjs';
import { emptyState } from '../src/model.mjs';

const lien = (sale, id) => `https://click.interencheres.com/ls/click?upn=${encodeURIComponent(`https://www.interencheres.com/art-decoration/vins-et-arts-de-la-table-${sale}/lot-${id}.html?utm_source=alerte`)}`;
const HTML = `<html><body><h1>Votre alerte « baccarat »</h1>
<table>
<tr><td><a href="${lien(693080, 89661801)}"><img src="https://thumbor.interencheres.com/abc/photo1.jpg" alt=""></a></td>
<td><a href="${lien(693080, 89661801)}">BACCARAT &ndash; Suite de six verres à vin, modèle Harcourt</a><br>Estimation : 150 € - 200 €<br>Vente live le 19/11/2026 à 14h00 · Lyon</td></tr>
<tr><td><a href="${lien(701234, 89787886)}"><img src="https://thumbor.interencheres.com/def/photo2.jpg"></a></td>
<td><a href="${lien(701234, 89787886)}">École russe, huile sur toile, paysage d&#39;hiver</a><br>Estimation 300 à 500 €<br>Vente chrono jusqu'au 21 novembre 2026 18h30</td></tr>
</table><a href="https://www.interencheres.com/compte/alertes">Gérer mes alertes</a>
<img src="https://track.example/pixel.gif"></body></html>`;

test('lien de lot, même derrière un traceur', () => {
  assert.deepEqual(lotDepuisLien(lien(693080, 89661801)), { venteId: 693080, id: '89661801' });
  assert.equal(lotDepuisLien('https://www.interencheres.com/compte/alertes'), null);
});

test('dates françaises', () => {
  assert.equal(trouverDate('le 19/11/2026 à 14h00'), '2026-11-19T14:00:00+01:00');
  assert.equal(trouverDate('jusqu\'au 21 novembre 2026 18h30'), '2026-11-21T18:30:00+01:00');
});

test('hôte IMAP déduit', () => {
  assert.equal(imapHost('veille.echos@gmail.com'), 'imap.gmail.com');
  assert.equal(imapHost('x@outlook.fr'), 'outlook.office365.com');
});

test('extraction des lots d\'une alerte', () => {
  const lots = parseAlerte({ html: HTML, subject: 'Nouveaux lots pour votre alerte' });
  assert.equal(lots.length, 2);
  const [a, b] = lots;
  assert.equal(a.id, '89661801');
  assert.match(a.titre, /BACCARAT/);
  assert.equal(a.marque, 'Baccarat');
  assert.deepEqual([a.estMin, a.estMax], [150, 200]);
  assert.equal(a.kind, 'live');
  assert.equal(a.date, '2026-11-19T14:00:00+01:00');
  assert.deepEqual(a.photos, ['https://thumbor.interencheres.com/abc/photo1.jpg']);
  assert.equal(a.url, 'https://www.interencheres.com/art-decoration/vente-693080/lot-89661801.html');
  assert.equal(b.kind, 'online');
  assert.equal(b.tag, 'Tableaux russes');
  assert.deepEqual([b.estMin, b.estMax], [300, 500]);
});

test('passage complet avec une boîte simulée', async () => {
  const brut = (from, uid) => ({ uid, envelope: { from: [{ address: from }] }, source: Buffer.from(`From: ${from}\r\nSubject: Alerte\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${HTML}`) });
  const msgs = [brut('alertes@interencheres.com', 41), brut('ami@exemple.fr', 42)];
  const client = {
    connect: async () => {}, logout: async () => {},
    mailboxOpen: async () => ({ uidValidity: 7n, exists: msgs.length }),
    fetch: async function* (crit) { const min = crit.uid ? +crit.uid.split(':')[0] : 0; for (const m of msgs) if (m.uid >= min) yield m; },
  };
  const state = emptyState();
  const r1 = await runVeilleMail(state, { client });
  assert.deepEqual(r1, { mails: 1, vus: 2, nouveaux: 2 });
  assert.equal(state.status.veilleMail.uid, 42);
  assert.ok(state.lots['89661801'].marteauMax === null || Number.isFinite(state.lots['89661801'].marteauMax));
  assert.equal(state.lots['89661801'].statut, 'nouveau');
  const r2 = await runVeilleMail(state, { client });
  assert.deepEqual(r2, { mails: 0, vus: 0, nouveaux: 0 }, 'pas de doublon au passage suivant');
});
