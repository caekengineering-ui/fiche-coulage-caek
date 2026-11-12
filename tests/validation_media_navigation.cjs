// Navigation réelle, serveur simulé, aucun accès à la production.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const { JSDOM } = require(require.resolve('jsdom', { paths: [path.join(root, '.audit-runtime')] }));
const dom = new JSDOM('<section id="screen-accueil" class="screen"></section><section id="screen-login" class="screen"></section><section id="screen-validation" class="screen"><div id="valid-liste"></div></section>', { runScripts: 'outside-only', url: 'https://isolated.invalid/' });
const w = dom.window;
const pending = [], created = [], revoked = [];
const tick = () => new Promise(resolve => setImmediate(resolve));
w.scrollTo = () => {};
w.URL.createObjectURL = () => { const url = 'blob:isolated-' + created.length; created.push(url); return url; };
w.URL.revokeObjectURL = url => revoked.push(url);
w.CAEKOperateurs = { isAdmin: () => true, token: () => 'isolated-test', init() {}, renderAll() {} };
w.CAEKServer = {
  configured: () => true,
  listCoulages: async () => [{ ref: 'TEST', statut: 'soumis', payload: { medias: [{ path: 'bl', categorie: 'bl', type: 'photo' }] } }],
  adminListLabos: async () => ({ labos: [] }), listLots: async () => []
};
w.CAEKMedias = { fetchBlob: () => new Promise(resolve => pending.push(resolve)) };
for (const name of ['model', 'integrite', 'validation', 'app']) {
  w.eval(fs.readFileSync(path.join(root, 'module_beton_caek/js', name + '.js'), 'utf8'));
}
(async () => {
  try {
    await tick();
    w.CAEKApp.navigate('screen-validation');
    await tick();
    w.document.querySelector('.valid-toggle').click();
    assert.equal(pending.length, 1);
    w.CAEKApp.navigate('screen-accueil');
    pending.shift()(new w.Blob());
    await tick();
    assert.equal(created.length, 0, 'Sortie réelle : aucun blob tardif');
    await w.CAEKValidation.refresh();
    assert.equal(pending.length, 0, 'Rendu masqué : aucun nouveau téléchargement');
    w.CAEKApp.navigate('screen-validation');
    await tick();
    assert.equal(pending.length, 1, 'Retour : le média est rechargé');
    pending.shift()(new w.Blob());
    await tick();
    assert.equal(created.length, 1);
    assert.equal(w.document.querySelectorAll('.valid-media-img').length, 1);
    w.dispatchEvent(new w.PopStateEvent('popstate', { state: { screen: 'screen-accueil' } }));
    assert.deepEqual(revoked, created, 'Retour téléphone : les URL sont révoquées');
    w.CAEKApp.navigate('screen-validation');
    await tick();
    w.CAEKApp.navigate('screen-login');
    pending.shift()(new w.Blob());
    await tick();
    assert.equal(created.length, 1, 'Navigation connexion : aucun blob tardif');
    console.log('OK : navigation, retour téléphone, révocation, réouverture et écran connexion.');
  } finally { w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
