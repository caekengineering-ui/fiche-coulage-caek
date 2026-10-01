const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = {
  localStorage: {getItem: () => 'ar'},
  NodeFilter: {SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2},
  document: {
    addEventListener() {},
    createTreeWalker(root) {
      let used = false;
      return {currentNode: root.node, nextNode() {if (used) return false; used = true; return true;}};
    }
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/i18n.js'), 'utf8'), context);

for (const initial of ['Rc (MPa)', 'Force (kN)', 'Observation', '✓ Rc (MPa)']) {
  let value = initial, writes = 0;
  const node = {parentNode: {nodeName: 'SPAN', closest: () => null}};
  Object.defineProperty(node, 'nodeValue', {get: () => value, set(v) {value = v; writes++;}});
  const root = {node, querySelectorAll: () => []};
  context.I18N.translate(root);
  const afterFirst = writes;
  // A DOM write schedules another observer delivery, even for identical text.
  for (let i = 0; i < 5; i++) context.I18N.translate(root);
  assert.equal(writes, afterFirst, 'Repeated mutation for ' + initial);
  assert.equal(value, context.I18N.T(initial));
}
let attr = 'Rc (MPa)', writes = 0;
const element = {closest: () => null, getAttribute: () => attr,
  hasAttribute: () => false, setAttribute(name, value) {writes++; attr = value;}};
const root = {node: {nodeValue: '', parentNode: null},
  querySelectorAll: selector => selector === '[title]' ? [element] : []};
context.I18N.translate(root);
assert.equal(writes, 0, 'Unchanged attribute must not trigger the observer');
console.log('i18n_stable_translation: OK');
