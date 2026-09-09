const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

// Cross-repo assumption under test: this Lambda uses bcryptjs to verify
// password hashes created by Laravel's bcrypt()/Hash::make() in the
// tech-challenge-application repo, which produce hashes with a `$2y$`
// prefix. bcryptjs itself only ever generates `$2a$` or `$2b$` prefixes,
// but treats `$2a$`, `$2b$`, and `$2y$` identically when comparing. We
// simulate a real Laravel-produced hash by generating one with bcryptjs
// and rewriting its prefix to `$2y$`, then confirm compareSync still
// works both for the correct and an incorrect password.

function toLaravelStylePrefix(hash) {
  return `$2y$${hash.slice(4)}`;
}

test('bcryptjs.compareSync accepts a $2y$-prefixed hash (Laravel-style) for the correct password', () => {
  const hash = bcrypt.hashSync('some-known-password', 10);
  const laravelStyleHash = toLaravelStylePrefix(hash);

  assert.match(laravelStyleHash, /^\$2y\$/);
  assert.equal(bcrypt.compareSync('some-known-password', laravelStyleHash), true);
});

test('bcryptjs.compareSync rejects a $2y$-prefixed hash (Laravel-style) for the wrong password', () => {
  const hash = bcrypt.hashSync('some-known-password', 10);
  const laravelStyleHash = toLaravelStylePrefix(hash);

  assert.equal(bcrypt.compareSync('wrong-password', laravelStyleHash), false);
});
