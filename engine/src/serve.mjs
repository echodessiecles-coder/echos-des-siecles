// Mode serveur (VPS, Raspberry, Mac) : même moteur, en boucle.
// Telegram est relevé toutes les 20 s, donc les réponses sont quasi instantanées.
// Avec GIT_SYNC=1, le dossier est un clone du dépôt : on tire avant chaque
// cycle et on pousse les changements (site, données chiffrées) après.

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tick } from './run.mjs';

const ROOT = process.env.SITE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVERY = +(process.env.CYCLE_SECONDS || 20) * 1000;
const sh = (c) => execSync(c, { cwd: ROOT, stdio: 'pipe' }).toString().trim();

async function loop() {
  for (;;) {
    try {
      if (process.env.GIT_SYNC === '1') sh('git pull --rebase --autostash -q');
      const r = await tick();
      if (process.env.GIT_SYNC === '1' && sh('git status --porcelain')) {
        sh('git add -A data index.html img && git commit -q -m "Moteur : mise à jour automatique" && git push -q');
      }
      if (r.jobs) console.log(new Date().toISOString(), 'tâches en attente :', r.jobs);
    } catch (e) {
      console.error(new Date().toISOString(), e.message);
    }
    await new Promise((res) => setTimeout(res, EVERY));
  }
}
loop();
