const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
function load(file, expose, extra = {}) {
  const elements = {};
  const events = {};
  const context = { console, Promise, navigator: {onLine: false},
    document: {getElementById: id => elements[id] || null,
      addEventListener: (name, fn) => { events[name] = fn; }}, ...extra };
  context.window = context;
  vm.createContext(context);
  let source = fs.readFileSync(path.join(__dirname, '../js', file), 'utf8');
  const end = source.lastIndexOf('  return {');
  source = source.slice(0,end) + expose + '\n' + source.slice(end);
  vm.runInContext(source, context);
  return {context, elements, events};
}
(async () => {
  const f = load('fiche.js', 'window.test = {render: renderEprouvettePhotos, add: addEprouvettePhoto, set: function(c) {current=c;}};', {
    CAEKDB: {getPhotosByRef: async () => [], addPhoto: async () => {throw Error('locked write');}}
  });
  for (const id of ['fc-epr-photo-zone','fc-epr-photo-code','fc-epr-photo-grid','fc-epr-photo-actions']) f.elements[id] = {value:'TEST-E1-01'};
  for (const status of ['brouillon','valide','soumis']) {
    f.context.test.set({ref:'TEST',statut:status});
    f.context.test.render(['TEST-E1-01']);
    assert.equal(f.elements['fc-epr-photo-actions'].hidden, status !== 'brouillon');
    if (status !== 'brouillon') f.context.test.add({});
  }
  let saved;
  const n = load('nouveau.js', 'window.test = {create: creerBrouillon, select: function(p) {activeCode="TEST";activeProjet=p;}};', {
    CAEKOperateurs: {laboId: () => 'LAB-A'},
    CAEKDB: {saveCoulage: async c => {saved=c;return {ok:true};}, getAllClients:async()=>[],getAllProjets:async()=>[]}
  });
  for (const project of [null, {laboId:''}, {laboId:'LAB-B'}]) {
    n.context.test.select(project);
    n.context.test.create();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saved.laboId, project && project.laboId || 'LAB-A');
  }
  n.elements['screen-nouveau'] = {classList:{contains:()=>true}};
  n.context.CAEKNouveau.init();
  assert.equal(typeof n.events['caek-sync-done'], 'function');
  // Execute the login synchronization block, verifying that no queued writes
  // from the previous account are sent under the new account.
  const source = fs.readFileSync(path.join(__dirname,'../js/operateurs.js'),'utf8');
  const block = source.slice(source.indexOf('      writeSession(_session);'), source.indexOf('      // Les référentiels'));
  const calls=[];
  const c={_session:{},writeSession:()=>{},applyActive:()=>{},renderAll:()=>{},
    CAEKSync:{autoSync:()=>calls.push('clients')},CAEKCoulages:{pull:()=>calls.push('read')}};
  c.window=c;vm.runInNewContext(block,c);
  assert.deepEqual(calls,['clients','read']);
  console.log('PASS: photo panel, locked photos, draft laboratory, client refresh, login sync');
})().catch(e=>{console.error(e);process.exitCode=1;});
