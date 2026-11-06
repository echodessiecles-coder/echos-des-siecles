// Bot Telegram d'Échos des siècles.
// - Prévient : nouveaux lots, rappels avant vente, « as-tu gagné ? », prix à fixer,
//   nouvelles commandes, choix de livraison, erreurs de publication.
// - Reçoit : boutons (suivre, gagné, prix, retrait, livraison…) et réponses
//   texte (prix au marteau, autre prix), photos des pièces, commandes /achat /vendu.
// Le moteur tourne par cycles : les réponses sont traitées au cycle suivant (≈ 5 min
// sur GitHub Actions, quasi instantané en mode serveur `npm run serve`).

import fs from 'node:fs/promises';
import path from 'node:path';
import { applyCommand, log, LIVRAISONS, CANAUX } from './model.mjs';
import { propositions, coutRevient } from './pricing.mjs';

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;
export const telegramActif = () => !!TOKEN();

async function api(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method} : ${data.description || res.status}`);
  return data.result;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const eur = (n) => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR') + ' €');
const quand = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'date inconnue');
const KIND = { live: 'Live', online: 'Chrono', classic: 'Catalogue (en salle)' };
const kb = (rows) => ({ inline_keyboard: rows.map((r) => r.filter(Boolean).map(([text, data]) => (data.startsWith('http') ? { text, url: data } : { text, callback_data: data.slice(0, 64) }))) });
const adminUrl = () => process.env.ADMIN_URL || 'https://echosdessiecles.fr/admin/';

async function send(state, text, markup, photo) {
  const chat_id = state.tg.chatId;
  if (!chat_id) return null;
  if (photo) {
    try {
      return await api('sendPhoto', { chat_id, photo, caption: text.slice(0, 1024), parse_mode: 'HTML', reply_markup: markup });
    } catch { /* photo inaccessible : on envoie le texte seul */ }
  }
  return api('sendMessage', { chat_id, text, parse_mode: 'HTML', reply_markup: markup, disable_web_page_preview: true });
}

function lotTexte(lot, titre) {
  return [
    `<b>${esc(titre)}</b>`,
    esc(lot.titre),
    `${KIND[lot.kind] || lot.kind} · ${esc(lot.etude)}${lot.ville ? ' · ' + esc(lot.ville) : ''}`,
    `🗓 ${quand(lot.date)}${lot.numero ? ' · lot n° ' + lot.numero : ''}`,
    `Estimation : ${lot.estMin || lot.estMax ? eur(lot.estMin) + ' – ' + eur(lot.estMax) : 'non indiquée'} · frais ${lot.frais ?? '≈28'} %`,
    lot.marteauMax ? `🎯 <b>Marteau max conseillé : ${eur(lot.marteauMax)}</b> (pour revendre ${eur(lot.revente)})` : '🎯 Marteau max : indique ton prix de revente visé pour le calculer',
  ].join('\n');
}

/** Construit et envoie une notification (job « notify »). */
export async function sendNotification(state, j) {
  if (!state.tg.chatId) return 'skip';
  const lot = j.lotId ? state.lots[j.lotId] : null;
  const it = j.itemId ? state.items[j.itemId] : null;
  const o = j.orderId ? state.orders[j.orderId] : null;
  switch (j.kind) {
    case 'nouveau_lot':
      if (!lot) return 'skip';
      return send(state, lotTexte(lot, `🔎 Nouveau lot · ${lot.tag}`), kb([[['👁 Suivre', `S|${lot.id}`], ['✕ Ignorer', `I|${lot.id}`], ['🎯 Revente visée', `M|${lot.id}`]], [['Voir le lot', lot.url]]]), lot.photos[0]);
    case 'invendu':
      if (!lot) return 'skip';
      return send(state, lotTexte(lot, '♻️ Lot peut-être invendu (vente passée)') + `\nContacte l'étude pour une offre après-vente : ${esc(lot.contact.tel)} ${esc(lot.contact.email)}`, kb([[['👁 Suivre', `S|${lot.id}`], ['✕ Ignorer', `I|${lot.id}`]], [['Voir le lot', lot.url]]]), lot.photos[0]);
    case 'resume_veille':
      return send(state, `🔎 <b>${j.count} nouveaux lots</b> trouvés par la veille. Je t'ai envoyé les premiers, le reste est dans l'admin.`, kb([[['Ouvrir la veille', adminUrl() + '#veille']]]));
    case 'rappel':
      if (!lot) return 'skip';
      return send(state, lotTexte(lot, `⏰ Vente dans ${j.heures} h`), kb([[['Voir le lot', lot.url]], [['🎯 Revente visée', `M|${lot.id}`], ['✕ Je laisse tomber', `I|${lot.id}`]]]), lot.photos[0]);
    case 'resultat':
      if (!lot) return 'skip';
      return send(state, `🔨 <b>Vente terminée</b>\n${esc(lot.titre)}\nAs-tu remporté ce lot ?`, kb([[['✅ Oui, je l\'ai eu', `G|${lot.id}`], ['❌ Non', `X|${lot.id}`]]]), lot.photos[0]);
    case 'prix': {
      if (!it) return 'skip';
      const props = propositions(it.cout, state.settings.pricing);
      const txt = [`💶 <b>Quel prix pour ${esc(it.titre)} ?</b>`, `Réf. ${it.id} · coût ${eur(it.cout)} (marteau ${eur(it.marteau)} + ${it.frais} % de frais)`, `Règle : ${it.cout > state.settings.pricing.seuil ? '× ' + state.settings.pricing.multHaut : '× ' + state.settings.pricing.multBas} → <b>${eur(it.prixConseille)}</b>`, 'Choisis un prix ou réponds avec ton propre prix.'].join('\n');
      return send(state, txt, kb([props.map((p) => [`${p.regle ? '⭐ ' : ''}${eur(p.prix)} (×${p.mult})`, `P|${it.id}|${p.prix}`]), [['✏️ Autre prix', `O|${it.id}`]]]), it.photos[0]);
    }
    case 'retrait':
      if (!it) return 'skip';
      return send(state, `📦 <b>${esc(it.titre)}</b> à ${eur(it.prix)}\nRetrait possible à Lyon / Annecy ?\n(Je publie ensuite sur ${Object.keys(CANAUX).filter((c) => state.settings.canaux[c]).map((c) => CANAUX[c]).join(', ')}.)`, kb([[['✅ Oui, retrait possible', `R|${it.id}|1`], ['🚚 Envoi seulement', `R|${it.id}|0`]]]));
    case 'publie': {
      if (!it) return 'skip';
      const lignes = Object.entries(it.canaux).map(([c, v]) => `${v.statut === 'en_ligne' ? '✅' : v.statut === 'erreur' ? '⚠️' : '⏳'} ${CANAUX[c]}${v.url ? ` : ${esc(v.url)}` : ''}${v.err ? ` (${esc(v.err)})` : ''}`);
      return send(state, `🚀 <b>${esc(it.titre)}</b> · ${eur(it.prix)}\n${lignes.join('\n')}`, kb([[['💰 Vendu', `V|${it.id}`]]]));
    }
    case 'leboncoin_pack': {
      if (!it) return 'skip';
      const a = it.annonce || {};
      await send(state, `🟠 <b>Leboncoin, prêt à coller</b> (réf. ${it.id})\nOuvre l'app Leboncoin › Déposer une annonce, puis copie :`);
      await send(state, `<b>Titre</b>\n<code>${esc((a.titre || it.titre).slice(0, 100))}</code>`);
      await send(state, `<b>Description</b>\n<code>${esc(a.description || it.description)}</code>`);
      if (it.photos.length > 1) {
        const media = it.photos.slice(0, 10).map((p) => ({ type: 'photo', media: photoUrl(p) }));
        try { await api('sendMediaGroup', { chat_id: state.tg.chatId, media }); } catch {}
      }
      return send(state, `<b>Prix</b> <code>${it.prix}</code> € · Catégorie conseillée : ${esc(a.categorieLbc || 'Décoration › Art de la table')}${it.retrait ? '\nRemise en main propre : Lyon / Annecy' : ''}`, kb([[['✅ C\'est publié sur Leboncoin', `L|${it.id}`]]]), it.photos[0] && photoUrl(it.photos[0]));
    }
    case 'commande': {
      if (!o) return 'skip';
      const item = state.items[o.itemId];
      const marge = item ? o.prix - item.cout : null;
      const btn = Object.entries(LIVRAISONS).filter(([k]) => k !== 'ebay' || o.canal === 'ebay').map(([k, v]) => [v, `D|${o.id}|${k}`]);
      return send(state, `🛎 <b>Nouvelle vente !</b> ${esc(item?.titre)}\n${eur(o.prix)} sur ${esc(CANAUX[o.canal] || o.canal)}${o.acheteur ? ' · ' + esc(o.acheteur) : ''}${o.ville ? ', ' + esc(o.ville) : ''}${marge != null ? `\nMarge : ${eur(marge)}` : ''}\nLes autres annonces sont retirées. <b>Quelle livraison ?</b>`, kb([btn.slice(0, 2), btn.slice(2, 4), btn.slice(4)]), item?.photos[0] && photoUrl(item.photos[0]));
    }
    case 'cocolis':
      if (!o) return 'skip';
      return send(state, `🚐 <b>Cocolis</b> pour la commande ${o.id}. Crée l'envoi ici, puis donne le suivi dans l'admin :`, kb([[['Créer l\'envoi Cocolis', 'https://www.cocolis.fr/']], [['Ouvrir la commande', adminUrl() + '#commandes']]]));
    case 'erreur':
      return send(state, `⚠️ ${esc(j.message)}`, kb([[['Ouvrir l\'admin', adminUrl() + '#journal']]]));
    default:
      return 'skip';
  }
}

export const photoUrl = (p) => (p.startsWith('http') ? p : (process.env.SITE_URL || 'https://echosdessiecles.fr') + '/' + p.replace(/^\//, ''));

function nombre(txt) {
  const m = String(txt).replace(/\s/g, '').replace(',', '.').match(/\d+(\.\d+)?/);
  return m ? Math.round(parseFloat(m[0])) : null;
}

async function ask(state, attente, text) {
  state.tg.attente = attente;
  await send(state, text, { force_reply: true, input_field_placeholder: 'Montant en €' });
}

async function onCallback(state, q) {
  const [k, id, arg] = q.data.split('|');
  let reponse = 'OK';
  try {
    switch (k) {
      case 'S': applyCommand(state, { type: 'lot.suivre', id, source: 'telegram' }); reponse = 'Lot suivi : je te rappellerai avant la vente'; break;
      case 'I': applyCommand(state, { type: 'lot.ignorer', id, source: 'telegram' }); reponse = 'Lot ignoré'; break;
      case 'X': applyCommand(state, { type: 'lot.perdu', id, source: 'telegram' }); reponse = 'Noté, lot perdu'; break;
      case 'M': await ask(state, { kind: 'revente', lotId: id }, `À combien penses-tu revendre ce lot ? (je calcule le marteau max)`); break;
      case 'G': await ask(state, { kind: 'marteau', lotId: id }, `Bravo ! Quel était le prix au marteau ? (sans les frais)`); break;
      case 'P': applyCommand(state, { type: 'item.prix', id, prix: +arg, source: 'telegram' }); reponse = `Prix fixé : ${eur(+arg)}`; break;
      case 'O': await ask(state, { kind: 'prix', itemId: id }, `Quel prix de vente pour ${id} ?`); break;
      case 'R': applyCommand(state, { type: 'item.retrait', id, retrait: arg === '1', publier: true, source: 'telegram' }); reponse = 'Publication lancée'; break;
      case 'L': applyCommand(state, { type: 'item.canal', id, channel: 'leboncoin', statut: 'en_ligne', source: 'telegram' }); reponse = 'Leboncoin marqué publié'; break;
      case 'V': await send(state, `Vendu où ?`, kb([[['Leboncoin', `W|${id}|leboncoin`], ['Site', `W|${id}|site`], ['eBay', `W|${id}|ebay`], ['Autre', `W|${id}|autre`]]])); break;
      case 'W': applyCommand(state, { type: 'item.vendu', id, canal: arg, source: 'telegram' }); reponse = 'Vente enregistrée'; break;
      case 'D': applyCommand(state, { type: 'commande.livraison', id, livraison: arg, source: 'telegram' }); reponse = LIVRAISONS[arg]; break;
      default: reponse = 'Action inconnue';
    }
  } catch (e) { reponse = e.message; }
  try { await api('answerCallbackQuery', { callback_query_id: q.id, text: reponse.slice(0, 190) }); } catch {}
  if (q.message && !['M', 'G', 'O', 'V'].includes(k)) {
    try { await api('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch {}
  }
}

const AIDE = [
  '<b>Échos des siècles · bot</b>',
  '/achat 120 Verres Sèvres : enregistre un achat (prix marteau + titre), joins des photos si tu veux',
  '/prix P0003 450 : change le prix d\'une pièce',
  '/vendu P0003 leboncoin : marque vendu (retire les autres annonces)',
  '/stock : pièces sans prix ou à publier',
  '/ventes : tes lots suivis des 7 prochains jours',
  'Envoie une photo avec la légende P0003 pour l\'ajouter à la pièce.',
].join('\n');

async function onText(state, msg, ctx) {
  const t = (msg.text || '').trim();
  const att = state.tg.attente;
  if (t.startsWith('/start') || t === '/aide' || t === '/help') return send(state, AIDE + `\n\nAdmin : ${adminUrl()}`);
  if (t.startsWith('/achat')) {
    const m = t.match(/^\/achat\s+([\d\s.,]+)\s*(.*)$/);
    if (!m) return send(state, 'Format : /achat 120 Titre de la pièce');
    const item = applyCommand(state, { type: 'item.creer', marteau: nombre(m[1]), titre: m[2] || 'Nouvel achat', source: 'telegram' });
    return item;
  }
  if (t.startsWith('/prix')) {
    const [, id, p] = t.split(/\s+/);
    applyCommand(state, { type: 'item.prix', id: (id || '').toUpperCase(), prix: nombre(p), source: 'telegram' });
    return send(state, `Prix de ${id} : ${eur(nombre(p))}`);
  }
  if (t.startsWith('/vendu')) {
    const [, id, canal = 'autre', p] = t.split(/\s+/);
    applyCommand(state, { type: 'item.vendu', id: (id || '').toUpperCase(), canal: canal.toLowerCase(), prix: p ? nombre(p) : undefined, source: 'telegram' });
    return null;
  }
  if (t === '/stock') {
    const l = Object.values(state.items).filter((i) => ['prix', 'pret'].includes(i.statut));
    return send(state, l.length ? l.map((i) => `${i.id} · ${esc(i.titre)} · ${i.prix ? eur(i.prix) : 'sans prix (conseillé ' + eur(i.prixConseille) + ')'}`).join('\n') : 'Rien en attente 👌');
  }
  if (t === '/ventes') {
    const lim = Date.now() + 7 * 86400e3;
    const l = Object.values(state.lots).filter((x) => x.statut === 'suivi' && Date.parse(x.date) < lim).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    return send(state, l.length ? l.map((x) => `${quand(x.date)} · ${esc(x.titre.slice(0, 60))} · max ${eur(x.marteauMax)}`).join('\n') : 'Aucun lot suivi cette semaine.');
  }
  // Réponse à une question en attente (prix, marteau, revente).
  const n = nombre(t);
  if (att && n != null) {
    state.tg.attente = null;
    if (att.kind === 'marteau') { applyCommand(state, { type: 'lot.gagne', id: att.lotId, marteau: n, source: 'telegram' }); return null; }
    if (att.kind === 'prix') { applyCommand(state, { type: 'item.prix', id: att.itemId, prix: n, source: 'telegram' }); return send(state, `Prix fixé : ${eur(n)}`); }
    if (att.kind === 'revente') {
      applyCommand(state, { type: 'lot.revente', id: att.lotId, revente: n, source: 'telegram' });
      applyCommand(state, { type: 'lot.suivre', id: att.lotId, source: 'telegram' });
      const lot = state.lots[att.lotId];
      return send(state, `🎯 Pour revendre ${eur(n)} : marteau max <b>${eur(lot?.marteauMax)}</b>. Lot suivi.`);
    }
  }
  return send(state, 'Je n\'ai pas compris. /aide pour la liste des commandes.');
}

async function onPhoto(state, msg, ctx) {
  const ref = ((msg.caption || '').match(/P\d{4}/i) || [])[0]?.toUpperCase();
  const achat = (msg.caption || '').match(/^\/achat\s+([\d\s.,]+)\s*(.*)$/);
  const best = msg.photo[msg.photo.length - 1];
  const f = await api('getFile', { file_id: best.file_id });
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN()}/${f.file_path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const rel = `img/tg-${best.file_unique_id}.jpg`;
  await fs.mkdir(path.join(ctx.root, 'img'), { recursive: true });
  await fs.writeFile(path.join(ctx.root, rel), buf);
  let it = ref ? state.items[ref] : null;
  if (!it && achat) it = applyCommand(state, { type: 'item.creer', marteau: nombre(achat[1]), titre: achat[2] || 'Nouvel achat', photos: [], source: 'telegram' }) && Object.values(state.items).at(-1);
  if (!it && msg.media_group_id) it = Object.values(state.items).find((i) => i.tgGroup === msg.media_group_id);
  if (!it) return send(state, 'Photo reçue, mais pour quelle pièce ? Mets la référence (ex. P0003) en légende.');
  if (msg.media_group_id) it.tgGroup = msg.media_group_id;
  // Ses propres photos passent devant celles de la salle des ventes.
  it.photosPerso = [...(it.photosPerso || []), rel];
  it.photos = [...it.photosPerso, ...it.photos.filter((p) => !p.startsWith('img/tg-') && !it.photosPerso.includes(p))];
  if (it.statut === 'en_ligne') applyCommand(state, { type: 'item.modifier', id: it.id, photos: it.photos, source: 'telegram' });
  log(state, `Photo ajoutée à ${it.id}`);
  return null;
}

/** Lit les messages reçus depuis le dernier cycle. */
export async function pollTelegram(state, ctx) {
  if (!telegramActif()) return;
  const forced = process.env.TELEGRAM_CHAT_ID;
  if (forced) state.tg.chatId = +forced;
  const updates = await api('getUpdates', { offset: state.tg.offset || 0, timeout: 0, allowed_updates: ['message', 'callback_query'] });
  for (const u of updates) {
    state.tg.offset = u.update_id + 1;
    const msg = u.message || u.callback_query?.message;
    const chatId = msg?.chat?.id;
    const from = u.message?.from || u.callback_query?.from;
    // Le premier /start en privé lie le bot à ce compte ; ensuite, tout autre chat est ignoré.
    if (!state.tg.chatId && u.message?.chat?.type === 'private' && /^\/start/.test(u.message.text || '')) {
      state.tg.chatId = chatId;
      state.tg.nom = [from?.first_name, from?.last_name].filter(Boolean).join(' ');
      log(state, `Telegram relié au compte ${state.tg.nom}`);
    }
    if (chatId !== state.tg.chatId) continue;
    try {
      if (u.callback_query) await onCallback(state, u.callback_query);
      else if (u.message?.photo) await onPhoto(state, u.message, ctx);
      else if (u.message?.text) await onText(state, u.message, ctx);
    } catch (e) {
      log(state, 'Telegram : ' + e.message, 'warn');
      try { await send(state, '⚠️ ' + esc(e.message)); } catch {}
    }
  }
  state.status.services.telegram = { ok: true, le: new Date().toISOString(), relie: !!state.tg.chatId, nom: state.tg.nom || null };
}
