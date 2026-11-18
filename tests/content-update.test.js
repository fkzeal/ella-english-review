const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../engine');
const {publishedBank: bank, cambridgeBank} = require('./bank-fixture');

test('new lessons merge without changing old answers or review progress', () => {
  const old = cambridgeBank();
  old.revision = bank.revision - 1;
  const state = E.emptyState();
  E.syncBatches(old, state, '2026-11-18');
  const q = old.questions[0];
  E.grade(old, state, q.id, q.answer, false, '2026-11-18');
  const progress = structuredClone(state.units[E.unitKey(q)]);
  const merged = E.mergeBank(old, bank);
  for (const previous of old.questions) {
    assert.deepEqual(merged.questions.find(item => item.id === previous.id), previous);
  }
  E.syncBatches(merged, state, '2026-11-18');
  assert.deepEqual(state.units[E.unitKey(q)], progress);
  assert.equal(state.history.length, 1);
  E.validateState(state, merged);
});

test('RAZ default dates remain defaults and variants do not duplicate review units', () => {
  const state = E.emptyState();
  E.syncBatches(bank, state, '2026-11-18');
  for (const lessonId of ['raz-d-greater-than', 'raz-d-animal-tongues']) {
    for (const module of ['lv', 'rg', 'skills']) {
      const info = E.moduleDate(bank, state, lessonId, module);
      assert.equal(info.date, '2026-11-17');
      assert.equal(info.source, 'default');
    }
    const ids = E.plan(bank, state, {lessonId, today: '2026-11-18', size: 12, rng: () => .5});
    assert(ids.length > 0);
    const units = ids.map(id => E.unitKey(bank.questions.find(q => q.id === id)));
    assert.equal(new Set(units).size, units.length);
  }
});
test('a book repeat is one batch covering all points and retries preserve mastery',()=>{
  const lesson='raz-d-animal-tongues',state=E.emptyState();E.syncBatches(bank,state,'2026-11-18');
  const q=bank.questions.find(q=>q.pointId==='raz-d-animal-tongues-animals');
  E.grade(bank,state,q.id,q.answer,false,'2026-11-18');
  const progress=structuredClone(state.units[E.unitKey(q)]);
  E.addBookRepeat(bank,state,lesson,'2026-11-18','2026-11-18');
  assert.equal(state.localBatches.length,1);
  assert.deepEqual(new Set(state.localBatches[0].items[0].modules),new Set(['lv','rg','skills']));
  E.addBookRepeat(bank,state,lesson,'2026-11-18','2026-11-18');
  assert.equal(state.localBatches.length,1);
  assert.deepEqual(state.units[E.unitKey(q)],progress);
  E.validateState(state,bank);
  const before=JSON.stringify(state);
  assert.throws(()=>E.addBookRepeat(bank,state,lesson,'2026-11-16','2026-11-18'));
  assert.equal(JSON.stringify(state),before);
});
