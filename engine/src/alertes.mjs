// Veille par alertes e-mail : Interenchères bloque les serveurs (anti-robot
// Cloudflare), mais envoie lui-même par e-mail les nouveaux lots des recherches
// enregistrées sur le compte du client. Le moteur lit cette boîte (IMAP),
// extrait les lots de chaque alerte et les fait entrer dans la veille.
//
// Secrets : VEILLE_IMAP_USER (adresse), VEILLE_IMAP_PASS (mot de passe
// d'application), VEILLE_IMAP_HOST facultatif (déduit pour Gmail / Outlook).

import { ingestLot } from './interencheres.mjs';
import { log, notify } from './model.mjs';

export const imapActif = () => !!(process.env.VEILLE_IMAP_USER && process.env.VEILLE_IMAP_PASS);

export function imapHost(user = process.env.VEILLE_IMAP_USER || '') {
  if (process.env.VEILLE_IMAP_HOST) return process.env.VEILLE_IMAP_HOST;
  const d = user.split('@')[1]?.toLowerCase() || '';
  if (/gmail|googlemail/.test(d)) return 'imap.gmail.com';
  if (/outlook|hotmail|live\.|msn/.test(d)) return 'outlook.office365.com';
  if (/yahoo/.test(d)) return 'imap.mail.yahoo.com';
  if (/orange|wanadoo/.test(d)) return 'imap.orange.fr';
  if (/free\.fr/.test(d)) return 'imap.free.fr';
  if (/ionos|1und1/.test(d)) return 'imap.ionos.fr';
  if (/icloud|me\.com|mac\.com/.test(d)) return 'imap.mail.me.com';
  return 'imap.' + d;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê', ocirc: 'ô', icirc: 'î', ucirc: 'û' };
const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const strip = (h) => decode(String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|td|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/** Retrouve l'identifiant du lot (et de la vente) dans un lien, même passé par un traceur de clics. */
export function lotDepuisLien(href) {
  let u = decode(href || '');
  for (let i = 0; i < 3; i++) {
    const m = /-(\d{4,})\/lot-(\d{5,})\.html/.exec(u) || /\/lot-(\d{5,})\.html/.exec(u);
    if (m) return m.length === 3 ? { venteId: +m[1], id: m[2] } : { venteId: null, id: m[1] };
    try { const d = decodeURIComponent(u); if (d === u) break; u = d; } catch { break; }
  }
  return null;
}

const MOIS = { janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12 };
const nombre = (s) => +String(s).replace(/[\s .]/g, '').replace(',', '.');

/** Date de vente en heure de Paris (approximation : +01:00 l'hiver, +02:00 l'été). */
function dateParis(y, mo, d, h = 0, mi = 0) {
  const off = mo > 3 && mo < 11 ? '+02:00' : '+01:00';
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00${off}`;
}
export function trouverDate(txt) {
  let m = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[^\d\n]{0,6}(\d{1,2})\s*[h:]\s*(\d{2})?)?/.exec(txt);
  if (m) return dateParis(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0));
  m = new RegExp(`(\\d{1,2})(?:er)?\\s+(${Object.keys(MOIS).join('|')})\\s+(\\d{4})(?:[^\\d\\n]{0,6}(\\d{1,2})\\s*[h:]\\s*(\\d{2})?)?`, 'i').exec(txt);
  if (m) return dateParis(+m[3], MOIS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0));
  return null;
}
export function trouverEstimation(txt) {
  const m = /(\d[\d\s .]*)\s*(?:€|EUR)?\s*(?:-|–|à|\/)\s*(\d[\d\s .]*)\s*(?:€|EUR)/i.exec(txt);
  if (m) { const a = nombre(m[1]), b = nombre(m[2]); if (a > 0 && b >= a) return [a, b]; }
  const s = /estimation[^\d\n]{0,12}(\d[\d\s .]*)\s*(?:€|EUR)/i.exec(txt);
  return s ? [nombre(s[1]), nombre(s[1])] : [null, null];
}

const MARQUES = ['Baccarat', 'Saint-Louis', 'Daum', 'Lalique', 'Sèvres', 'Haviland', 'Bernardaud', 'Raynaud', 'Christofle', 'Puiforcat', 'Ercuis', 'Gallé', 'Val Saint-Lambert', 'Limoges', 'Gien', 'Odiot', 'Tétard', 'Boulenger'];

/** Extrait les lots d'une alerte Interenchères (HTML, ou texte brut à défaut). */
export function parseAlerte({ html, text, subject = '' } = {}) {
  const src = html || String(text || '').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>');
  const liens = [...src.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ ref: lotDepuisLien(m[1]), inner: m[2], start: m.index, end: m.index + m[0].length }))
    .filter((l) => l.ref);
  const ordre = [];
  const par = new Map();
  for (const l of liens) {
    if (!par.has(l.ref.id)) { par.set(l.ref.id, []); ordre.push(l.ref.id); }
    par.get(l.ref.id).push(l);
  }
  return ordre.map((id, i) => {
    const ls = par.get(id);
    const prev = i ? par.get(ordre[i - 1]) : null;
    const next = par.get(ordre[i + 1]);
    const debut = prev ? prev[prev.length - 1].end : Math.max(0, ls[0].start - 1500);
    const fin = next ? next[0].start : Math.min(src.length, ls[ls.length - 1].end + 1500);
    const bloc = src.slice(debut, fin);
    // Les détails (estimation, date, type) suivent en général le titre : on les
    // cherche d'abord après le dernier lien du lot, puis dans tout le bloc.
    const apres = strip(src.slice(ls[ls.length - 1].start, fin));
    const txt = strip(bloc);
    const titres = ls.map((l) => strip(l.inner)).filter((t) => t && !/^https?:/.test(t) && !/^(voir|découvrir|enchérir|accéder)/i.test(t));
    const titre = (titres.sort((a, b) => b.length - a.length)[0] || txt.split('\n').find((x) => x.length > 12) || 'Lot ' + id).replace(/\s+/g, ' ').slice(0, 110);
    const imgs = (h) => [...h.matchAll(/<img\b[^>]*src\s*=\s*["']([^"']+)["']/gi)].map((m) => decode(m[1])).find((u) => /^https?:/.test(u) && !/logo|pixel|track|spacer|icon/i.test(u));
    const photo = imgs(ls.map((l) => l.inner).join(' ')) || imgs(bloc);
    const est = trouverEstimation(apres);
    const [estMin, estMax] = est[0] != null ? est : trouverEstimation(txt);
    const venteId = ls.find((l) => l.ref.venteId)?.ref.venteId ?? null;
    const genre = (t) => (/\blive\b|en direct/i.test(t) ? 'live' : /chrono|online|en ligne/i.test(t) ? 'online' : null);
    const kind = genre(apres) || genre(txt) || 'classic';
    const marque = MARQUES.find((m) => (titre + ' ' + apres).toLowerCase().includes(m.toLowerCase())) || '';
    const russe = /russ|icône|icone/i.test(titre + ' ' + apres);
    return {
      id: String(id),
      source: 'interencheres',
      via: 'alerte',
      titre,
      description: apres.slice(0, 1500),
      marque,
      photos: photo ? [photo] : [],
      kind,
      date: trouverDate(apres) || trouverDate(txt),
      venteId,
      numero: null,
      estMin, estMax,
      depart: null,
      frais: undefined,
      etude: '', ville: '', cp: '',
      contact: { tel: '', email: '' },
      livraison: false,
      url: `https://www.interencheres.com/art-decoration/vente-${venteId || 0}/lot-${id}.html`,
      requete: '', // l'alerte a déjà filtré par recherche
      tag: russe ? 'Tableaux russes' : 'Art de la table',
    };
  });
}

/** Lit les nouvelles alertes depuis le dernier passage et fait entrer leurs lots. */
export async function runVeilleMail(state, { maxNotifs = 12, client } = {}) {
  const { veille } = state.settings;
  const nowMs = Date.now();
  const limite = nowMs + veille.joursMax * 86400e3;
  const user = process.env.VEILLE_IMAP_USER;
  const expediteur = (process.env.VEILLE_EXPEDITEUR || 'interencheres').toLowerCase();
  const mem = (state.status.veilleMail = state.status.veilleMail || { uid: 0, validity: null });
  let imap = client;
  if (!imap) {
    const { ImapFlow } = await import('imapflow');
    imap = new ImapFlow({ host: imapHost(user), port: 993, secure: true, auth: { user, pass: process.env.VEILLE_IMAP_PASS }, logger: false });
  }
  const { simpleParser } = await import('mailparser');
  let mails = 0, vus = 0, nouveaux = 0;
  await imap.connect();
  try {
    const box = await imap.mailboxOpen(process.env.VEILLE_IMAP_FOLDER || 'INBOX', { readOnly: true });
    const validity = String(box.uidValidity ?? '');
    if (mem.validity !== validity) {
      // Première fois (ou boîte recréée) : on remonte sur les 7 derniers jours.
      mem.validity = validity;
      mem.uid = 0;
    }
    const critere = mem.uid ? { uid: `${mem.uid + 1}:*` } : { since: new Date(nowMs - 7 * 86400e3) };
    for await (const msg of imap.fetch(critere, { uid: true, source: true, envelope: true }, { uid: true })) {
      if (msg.uid <= mem.uid) continue;
      mem.uid = Math.max(mem.uid, msg.uid);
      const from = (msg.envelope?.from || []).map((f) => (f.address || '') + ' ' + (f.name || '')).join(' ').toLowerCase();
      if (!from.includes(expediteur)) continue;
      mails++;
      const p = await simpleParser(msg.source);
      for (const lot of parseAlerte({ html: p.html || '', text: p.text || '', subject: p.subject || '' })) {
        const k = ingestLot(state, lot, { nowMs, limite });
        if (!k) continue;
        vus++;
        if (k === 'maj') continue;
        nouveaux++;
        if (veille.alerteNouveaux && nouveaux <= maxNotifs) notify(state, k === 'invendu' ? 'invendu' : 'nouveau_lot', { lotId: lot.id });
      }
    }
  } finally {
    await imap.logout().catch(() => {});
  }
  state.status.services.interencheres = { ok: true, le: new Date().toISOString(), vus, nouveaux, erreurs: 0, source: 'alertes', mails };
  if (nouveaux > maxNotifs) notify(state, 'resume_veille', { lotId: 'resume', count: nouveaux });
  if (mails) log(state, `Veille (alertes e-mail) : ${mails} alertes, ${vus} lots, ${nouveaux} nouveaux`);
  return { mails, vus, nouveaux };
}
