// Publication sur le site echosdessiecles.fr (GitHub Pages).
// Le catalogue est la ligne `const P=[...]` de index.html : on l'édite, on copie
// les photos dans img/, et le commit du moteur met le site à jour.

import fs from 'node:fs/promises';
import path from 'node:path';

const CATS_SITE = ['Cristal', 'Porcelaine', 'Argenterie', 'Objets'];
const SITE = () => process.env.SITE_URL || 'https://echosdessiecles.fr';

function jpegRatio(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return +(buf.readUInt16BE(i + 7) / buf.readUInt16BE(i + 5)).toFixed(3); // largeur / hauteur
    i += 2 + len;
  }
  return null;
}

async function readCatalogue(root) {
  const file = path.join(root, 'index.html');
  const html = await fs.readFile(file, 'utf8');
  const m = html.match(/^const P=(\[.*\]);$/m);
  if (!m) throw new Error('Catalogue introuvable dans index.html (ligne « const P=[...] »)');
  return { file, html, line: m[0], P: JSON.parse(m[1]) };
}

async function writeCatalogue(cat) {
  const line = 'const P=' + JSON.stringify(cat.P) + ';';
  await fs.writeFile(cat.file, cat.html.replace(cat.line, () => line));
}

async function localPhotos(root, item) {
  const out = [];
  let ar = null;
  for (const [n, p] of item.photos.slice(0, 2).entries()) {
    let rel = p;
    if (/^https?:/.test(p)) {
      rel = `img/e${item.siteId}${'ab'[n]}.jpg`;
      const res = await fetch(p.includes('thumbor') ? p : p, { headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`photo ${n + 1} : HTTP ${res.status}`);
      await fs.writeFile(path.join(root, rel), Buffer.from(await res.arrayBuffer()));
    }
    if (n === 0) {
      try { ar = jpegRatio(await fs.readFile(path.join(root, rel))); } catch {}
    }
    out.push(rel);
  }
  return { img: out, ar: ar || 1 };
}

export async function publishSite(state, item, { root }) {
  const cat = await readCatalogue(root);
  const { img, ar } = await localPhotos(root, item);
  if (!img.length) throw new Error('aucune photo : envoie une photo au bot avec la légende ' + item.id);
  const a = item.annonce || {};
  const prod = {
    id: item.siteId,
    brand: a.marque || item.marque || '',
    name: a.titre || item.titre,
    price: item.prix,
    cat: CATS_SITE.includes(a.categorie || item.categorie) ? a.categorie || item.categorie : 'Objets',
    sold: false,
    img,
    ar,
    desc: (a.description || item.description || '').replace(/\s+/g, ' ').slice(0, 600),
    ref: item.id,
    pickup: !!item.retrait,
  };
  const i = cat.P.findIndex((x) => x.id === item.siteId);
  if (i >= 0) cat.P[i] = { ...cat.P[i], ...prod };
  else cat.P.unshift(prod); // les nouveautés en premier
  await writeCatalogue(cat);
  return { url: `${SITE()}/#collection`, ref: String(item.siteId) };
}

export async function unpublishSite(state, item, { root, sold }) {
  const cat = await readCatalogue(root);
  const i = cat.P.findIndex((x) => x.id === item.siteId);
  if (i < 0) return;
  if (sold) cat.P[i].sold = true; // reste visible avec la mention « Vendu »
  else cat.P.splice(i, 1);
  await writeCatalogue(cat);
}
