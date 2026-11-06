const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const { JSDOM } = require(require.resolve('jsdom', {paths: [path.join(root, '.audit-runtime')]}));
const dom = new JSDOM('<div id="valid-liste"><div class="valid-medias" data-ref="TEST"><div class="valid-medias-zone"></div></div></div>', {runScripts:'outside-only'});
const w = dom.window;
const pending = {};
w.URL.createObjectURL = () => 'blob:isolated';
w.URL.revokeObjectURL = () => {};
w.CAEKMedias = {fetchBlob: path => new Promise((resolve, reject) => {pending[path] = {resolve, reject};})};
w.findRow = () => ({payload:{medias:[
  {path:'photo', categorie:'prelevement', type:'photo'},
  {path:'bl', categorie:'bl', type:'photo', numeroEchantillon:'TEST-E1'},
  {path:'audio', categorie:'audio', type:'audio'}
]}});
const source = fs.readFileSync(path.join(root, 'module_beton_caek/js/validation.js'), 'utf8');
w.eval(source.slice(source.indexOf('  var _urls = []'), source.indexOf('  function updateBadgeDisplay')));
(async () => {
  try {
    w.loadMedias();
    pending.photo.resolve(new w.Blob());
    pending.audio.resolve(new w.Blob());
    await new Promise(resolve => setImmediate(resolve));
    pending.bl.resolve(new w.Blob());
    await new Promise(resolve => setImmediate(resolve));
    const labels = [...w.document.querySelectorAll('.photo-cat')].map(el => el.textContent);
    assert.match(labels[0], /Bon de livraison.*TEST-E1/);
    assert.match(labels[1], /Note audio/);
    assert.match(labels[2], /Prélèvement/);
    w.loadMedias();
    pending.photo.resolve(new w.Blob());
    pending.audio.resolve(new w.Blob());
    pending.bl.reject(new Error('simulated unavailable'));
    await new Promise(resolve => setImmediate(resolve));
    const zone = w.document.querySelector('.valid-medias-zone');
    assert.match(zone.firstElementChild.textContent, /Média indisponible.*Bon de livraison.*TEST-E1/);
    assert.equal(zone.querySelectorAll('audio[controls]').length, 1);
    assert.equal(zone.querySelectorAll('img').length, 1);
    console.log('OK : ordre BL/audio/photo conservé malgré téléchargements inversés et échec BL explicite.');
  } finally { w.close(); }
})().catch(error => {console.error(error); process.exitCode=1;});
