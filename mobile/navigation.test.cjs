const test = require('node:test');
const assert = require('node:assert/strict');
const { home, action } = require('./navigation.cjs');
for (const production of [false, true]) {
  test('Portal routing, production=' + production, () => {
    assert.equal(action(home(production), production), 'inside');
    assert.equal(action(home(production) + 'patients.html?tab=1', production), 'inside');
    assert.equal(action(home(!production) + 'patients.html', production), 'block');
    assert.equal(action('https://maps.google.com/', production), 'external');
    assert.equal(action('javascript:alert(1)', production), 'block');
    assert.equal(action('file:///etc/passwd', production), 'block');
  });
}
