// Lecture / écriture de l'état chiffré (data/state.enc) et des commandes
// envoyées par l'admin (data/inbox/*.enc, une par fichier pour éviter les conflits).

import fs from 'node:fs/promises';
import path from 'node:path';
import { decryptJSON, encryptJSON } from './crypto.mjs';
import { emptyState, normalize, applyCommand, log } from './model.mjs';

export const key = () => {
  const k = process.env.ECHOS_DATA_KEY;
  if (!k || k.length < 12) throw new Error('ECHOS_DATA_KEY manquante (phrase secrète de 12 caractères minimum)');
  return k;
};

export async function loadState(root) {
  const file = path.join(root, 'data', 'state.enc');
  try {
    return normalize(await decryptJSON(await fs.readFile(file, 'utf8'), key()));
  } catch (e) {
    if (e.code === 'ENOENT') return emptyState();
    throw e;
  }
}

export async function saveState(root, state) {
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'state.enc'), await encryptJSON(state, key()));
}

export async function applyInbox(root, state) {
  const dir = path.join(root, 'data', 'inbox');
  let files = [];
  try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.enc')).sort(); } catch { return 0; }
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const cmds = await decryptJSON(await fs.readFile(full, 'utf8'), key());
      for (const c of [].concat(cmds)) {
        try { applyCommand(state, { ...c, source: 'admin' }); } catch (e) { log(state, `Commande admin refusée (${c.type}) : ${e.message}`, 'warn'); }
      }
    } catch (e) {
      log(state, `Fichier admin illisible ${f} : ${e.message}`, 'warn');
    }
    await fs.unlink(full);
  }
  return files.length;
}
