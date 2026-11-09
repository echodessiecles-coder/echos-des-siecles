// Diagnostic : vérifie depuis le serveur que chaque service répond.
// Lancé à la demande (Actions › Moteur › Run workflow › diagnostic). Les journaux
// d'un dépôt public sont publics : on n'affiche que des états et des compteurs,
// jamais de secret ni de donnée privée.

import { searchLots, normalizeLot } from './interencheres.mjs';
import { emptyState } from './model.mjs';

const out = [];
const ok = (k, v) => out.push(`✅ ${k} : ${v}`);
const ko = (k, v) => out.push(`❌ ${k} : ${v}`);
const info = (k, v) => out.push(`ℹ️  ${k} : ${v}`);

// Interenchères : quelques recherches réelles.
const st = emptyState();
const reqs = st.settings.veille.requetes.filter((r) => ['baccarat', 'école russe', 'christofle'].includes(r.q));
for (const r of reqs) {
  try {
    const t0 = Date.now();
    const res = await searchLots(r.q);
    const lots = res.map((x) => normalizeLot(x, r));
    const futurs = lots.filter((l) => Date.parse(l.date) > Date.now()).length;
    const kinds = lots.reduce((a, l) => ((a[l.kind] = (a[l.kind] || 0) + 1), a), {});
    const avecPhoto = lots.filter((l) => l.photos.length).length;
    ok(`Interenchères « ${r.q} »`, `${lots.length} lots (${futurs} à venir, ${avecPhoto} avec photos, ${Object.entries(kinds).map(([k, n]) => k + ' ' + n).join(', ')}) en ${Date.now() - t0} ms`);
    if (r.q === 'baccarat' && res[0]) {
      info('Champs d\'un lot', Object.keys(res[0]).sort().join(', '));
      info('Champs de la vente', Object.keys(res[0].sale || {}).sort().join(', '));
      const urlish = Object.entries({ ...res[0], ...Object.fromEntries(Object.entries(res[0].sale || {}).map(([k, v]) => ['sale.' + k, v])) })
        .filter(([k, v]) => /url|slug|link|path/i.test(k) && typeof v === 'string').map(([k, v]) => `${k}=${v}`);
      info('Liens possibles', urlish.join(' | ') || 'aucun');
    }
  } catch (e) { ko(`Interenchères « ${r.q} »`, e.message); }
  await new Promise((r) => setTimeout(r, 800));
}

// Telegram : le jeton est-il valide ?
if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    const r = await (await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`)).json();
    r.ok ? ok('Telegram', 'jeton valide') : ko('Telegram', 'jeton refusé');
  } catch (e) { ko('Telegram', 'injoignable'); }
} else info('Telegram', 'secret TELEGRAM_BOT_TOKEN absent');

info('Données chiffrées', process.env.ECHOS_DATA_KEY ? 'ECHOS_DATA_KEY présent' : 'ECHOS_DATA_KEY absent : le moteur ne démarre pas');
info('Rédaction IA', process.env.ANTHROPIC_API_KEY ? 'clé présente' : 'clé absente (facultatif)');
info('eBay', process.env.EBAY_REFRESH_TOKEN ? 'identifiants présents' : 'identifiants absents (facultatif)');

// Leboncoin depuis un serveur : bloqué ou pas ?
try {
  const r = await fetch('https://www.leboncoin.fr/', { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' } });
  info('Leboncoin depuis le serveur', `HTTP ${r.status}${r.status === 403 ? ' (anti-robot : la publication doit passer par le Mac)' : ''}`);
} catch { info('Leboncoin depuis le serveur', 'injoignable'); }

console.log(out.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import('node:fs');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Diagnostic Échos\n\n' + out.map((l) => '- ' + l).join('\n') + '\n');
}
