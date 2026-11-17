// Réponses différées isolées : aucun serveur ni donnée métier.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const { JSDOM } = require(require.resolve('jsdom', { paths: [path.join(root, '.audit-runtime')] }));
const dom = new JSDOM('<div id="valid-liste"></div>', { runScripts: 'outside-only' });
const w = dom.window;
let labo = 'A', token = 'session-A', admin = true;
const requests = [];
w.CAEKLaboFilter = { get: () => labo };
w.CAEKOperateurs = { isAdmin: () => admin, token: () => token };
w.CAEKServer = {
  configured: () => true,
  listCoulages: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  adminListLabos: async () => ({ labos: [] }), listLots: async () => []
};
for (const name of ['model', 'integrite', 'validation']) {
  w.eval(fs.readFileSync(path.join(root, 'module_beton_caek/js', name + '.js'), 'utf8'));
}
const rows = ref => [{ ref, statut: 'soumis', payload: {} }];
(async () => {
  try {
    const old = w.CAEKValidation.refresh();
    labo = 'B';
    const latest = w.CAEKValidation.refresh();
    requests[1].resolve(rows('TEST-B'));
    await latest;
    const expected = w.document.body.innerHTML;
    requests[0].resolve(rows('TEST-A'));
    await old;
    assert.equal(w.document.body.innerHTML, expected, 'Une ancienne sélection ne remplace pas le laboratoire courant');
    const failed = w.CAEKValidation.refresh();
    const success = w.CAEKValidation.refresh();
    requests[3].resolve(rows('TEST-NEW'));
    await success;
    const current = w.document.body.innerHTML;
    requests[2].reject(new Error('ancienne erreur'));
    await failed;
    assert.equal(w.document.body.innerHTML, current, 'Une ancienne erreur ne remplace pas le résultat courant');
    for (const change of [() => { token = 'session-B'; }, () => { labo = 'C'; }, () => { admin = false; }]) {
      const pending = w.CAEKValidation.refresh();
      change();
      requests.at(-1).resolve(rows('TEST-OBSOLETE'));
      await pending;
      assert.equal(w.document.body.innerHTML, current, 'Contexte modifié : réponse ignorée');
    }
    console.log('OK : réponses inversées, erreur tardive, changement de session, laboratoire et droits.');
  } finally { w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
