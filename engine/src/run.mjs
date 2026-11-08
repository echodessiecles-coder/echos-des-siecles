// Un cycle du moteur : lit l'état, applique les actions de l'admin et de Telegram,
// fait la veille, les rappels, les publications, puis sauvegarde.
// Usage : node src/run.mjs [--veille] (depuis engine/, racine du site = ..)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState, saveState, applyInbox } from './store.mjs';
import { applyCommand, log, notify } from './model.mjs';
import { runVeille, runRappels } from './interencheres.mjs';
import { pollTelegram, sendNotification, telegramActif, photoUrl } from './telegram.mjs';
import { publishSite, unpublishSite } from './publish/site.mjs';
import { publishEbay, unpublishEbay, syncEbayOrders, ebayActif } from './publish/ebay.mjs';
import { publishLeboncoin, unpublishLeboncoin } from './publish/leboncoin.mjs';
import { redigerAnnonce, iaActive } from './ai.mjs';

const ROOT = process.env.SITE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VEILLE_MIN = +(process.env.VEILLE_INTERVAL_MIN || 60);
const EBAY_MIN = 15;

const signature = (s) => JSON.stringify({ ...s, status: null });
const minutesSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 60e3 : Infinity);

const PUBLISH = {
  site: { on: () => true, pub: publishSite, unpub: unpublishSite },
  ebay: { on: ebayActif, pub: publishEbay, unpub: unpublishEbay },
  leboncoin: { on: () => true, pub: publishLeboncoin, unpub: unpublishLeboncoin },
};

async function runJob(state, j, ctx) {
  const it = j.itemId ? state.items[j.itemId] : null;
  if (j.type === 'notify') {
    if (!telegramActif() || state.settings.integrations?.telegram === false) return 'skip';
    return sendNotification(state, j);
  }
  if (!it) return 'skip';
  const ch = PUBLISH[j.channel];
  if (!ch) return 'skip';
  if (j.type === 'unpublish') {
    if (ch.on()) await ch.unpub(state, it, { ...ctx, sold: j.sold });
    it.canaux[j.channel] = { ...(it.canaux[j.channel] || {}), statut: j.sold ? 'vendu' : 'retire', le: new Date().toISOString() };
    return 'ok';
  }
  // publish / update
  if (it.statut === 'vendu' || it.statut === 'archive') return 'skip';
  if (!ch.on()) { it.canaux[j.channel] = { statut: 'non_configure' }; return 'skip'; }
  if (iaActive() && state.settings.integrations?.ia !== false && !it.annonce) {
    try { it.annonce = await redigerAnnonce(it); } catch (e) { log(state, 'Rédaction IA impossible : ' + e.message, 'warn'); it.annonce = {}; }
  }
  const r = await ch.pub(state, it, ctx);
  it.canaux[j.channel] = { ...(it.canaux[j.channel] || {}), statut: r?.statut || 'en_ligne', ...r, err: null, le: new Date().toISOString() };
  return 'ok';
}

async function runJobs(state, ctx) {
  for (let pass = 0; pass < 4; pass++) {
    const todo = state.jobs.filter((j) => !j.done && (!j.nextAt || Date.parse(j.nextAt) <= Date.now()));
    if (!todo.length) break;
    for (const j of todo) {
      try {
        await runJob(state, j, ctx);
        j.done = true;
        if (j.type === 'publish' || j.type === 'update') {
          const it = state.items[j.itemId];
          const reste = state.jobs.some((x) => !x.done && x.itemId === j.itemId && (x.type === 'publish' || x.type === 'update'));
          if (it && !reste) notify(state, 'publie', { itemId: j.itemId, kind: 'publie' });
        }
      } catch (e) {
        j.tries++;
        j.err = e.message;
        const it = state.items[j.itemId];
        if (j.tries >= 3) {
          j.done = true;
          j.failed = true;
          if (it && j.channel) it.canaux[j.channel] = { ...(it.canaux[j.channel] || {}), statut: 'erreur', err: e.message };
          log(state, `Échec ${j.type} ${j.channel || j.kind || ''} ${j.itemId || ''} : ${e.message}`, 'error');
          if (j.type !== 'notify') notify(state, 'erreur', { itemId: j.itemId, channel: j.channel, message: `${j.channel || ''} ${it ? '« ' + it.titre + ' »' : ''} : ${e.message}` });
        } else {
          j.nextAt = new Date(Date.now() + 5 * 60e3 * j.tries).toISOString();
        }
      }
    }
  }
  // On garde les 7 derniers jours de tâches terminées pour le journal.
  state.jobs = state.jobs.filter((j) => !j.done || minutesSince(j.at) < 7 * 1440);
}

export async function tick({ forceVeille = false } = {}) {
  const ctx = { root: ROOT, photoUrl };
  const state = await loadState(ROOT);
  const avant = signature(state);
  const nInbox = await applyInbox(ROOT, state);
  const steps = [];
  const safe = async (name, fn) => {
    try { await fn(); steps.push(name); } catch (e) { log(state, `${name} : ${e.message}`, 'error'); state.status.services[name] = { ok: false, le: new Date().toISOString(), err: e.message }; }
  };
  await safe('telegram', () => pollTelegram(state, ctx));
  if (forceVeille || (state.settings.integrations?.veille !== false && minutesSince(state.status.lastVeille) >= VEILLE_MIN - 2)) {
    await safe('interencheres', async () => { await runVeille(state); state.status.lastVeille = new Date().toISOString(); });
  }
  await safe('rappels', async () => runRappels(state));
  if (ebayActif() && minutesSince(state.status.services.ebay?.le) >= EBAY_MIN) await safe('ebay', () => syncEbayOrders(state, applyCommand));
  await safe('taches', () => runJobs(state, ctx));
  state.status.lastRun = new Date().toISOString();
  state.status.services.config = { telegram: telegramActif(), ebay: ebayActif(), ia: iaActive(), leboncoin: state.settings.leboncoin.mode };
  // On ne réécrit (et donc ne commite) que si quelque chose a vraiment changé,
  // ou une fois par heure pour montrer que le moteur tourne.
  const change = signature(state) !== avant || minutesSince(state.status.saved) >= 60;
  if (change) { state.status.saved = new Date().toISOString(); await saveState(ROOT, state); }
  return { inbox: nInbox, steps, saved: change, jobs: state.jobs.filter((j) => !j.done).length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.ECHOS_DATA_KEY) {
    console.log('Moteur pas encore configuré : ajoute le secret ECHOS_DATA_KEY (voir docs/ADMIN.md).');
    process.exit(0);
  }
  tick({ forceVeille: process.argv.includes('--veille') })
    .then((r) => console.log('Cycle terminé', JSON.stringify(r)))
    .catch((e) => { console.error('Erreur :', e.message); process.exit(1); });
}
