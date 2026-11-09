// Diagnostic : vérifie depuis le serveur que chaque service répond.
// Lancé à la demande (Actions › Moteur › Run workflow › diagnostic). Les journaux
// d'un dépôt public sont publics : on n'affiche que des états et des compteurs,
// jamais de secret ni de donnée privée.

import { imapActif, imapHost } from './alertes.mjs';

const out = [];
const ok = (k, v) => out.push(`✅ ${k} : ${v}`);
const ko = (k, v) => out.push(`❌ ${k} : ${v}`);
const info = (k, v) => out.push(`ℹ️  ${k} : ${v}`);

// Veille : la boîte des alertes Interenchères répond-elle ?
if (imapActif()) {
  try {
    const { ImapFlow } = await import('imapflow');
    const c = new ImapFlow({ host: imapHost(), port: 993, secure: true, auth: { user: process.env.VEILLE_IMAP_USER, pass: process.env.VEILLE_IMAP_PASS }, logger: false });
    await c.connect();
    const box = await c.mailboxOpen(process.env.VEILLE_IMAP_FOLDER || 'INBOX', { readOnly: true });
    const n = (await c.search({ from: process.env.VEILLE_EXPEDITEUR || 'interencheres', since: new Date(Date.now() - 30 * 86400e3) }, { uid: true })) || [];
    await c.logout();
    ok('Boîte des alertes', `connexion réussie, ${box.exists} e-mails, ${n.length} alertes Interenchères sur 30 jours`);
  } catch (e) { ko('Boîte des alertes', 'connexion refusée (adresse, mot de passe d\'application ou IMAP désactivé)'); }
} else info('Boîte des alertes', 'secrets VEILLE_IMAP_USER et VEILLE_IMAP_PASS absents');

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

console.log(out.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import('node:fs');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Diagnostic Échos\n\n' + out.map((l) => '- ' + l).join('\n') + '\n');
}
