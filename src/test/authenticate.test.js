const test = require('node:test');
const assert = require('node:assert/strict');
const { authenticate } = require('../authenticate');

function makeDeps({ user = null, passwordMatches = false } = {}) {
  return {
    classifyIdentifier: (id) => ({ field: 'email', value: id }),
    userRepository: { findByIdentifier: async () => user },
    comparePassword: () => passwordMatches,
    tokenSigner: { sign: (id) => `token-for-${id}` },
  };
}

test('returns 400 when identifier is missing', async () => {
  const result = await authenticate({ password: 'x' }, makeDeps());
  assert.equal(result.statusCode, 400);
});

test('returns 400 when password is missing', async () => {
  const result = await authenticate({ identifier: 'a@b.com' }, makeDeps());
  assert.equal(result.statusCode, 400);
});

test('returns 401 when user is not found', async () => {
  const result = await authenticate(
    { identifier: 'a@b.com', password: 'x' },
    makeDeps({ user: null })
  );
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.message, 'Credenciais inválidas');
});

test('returns 401 when the password does not match', async () => {
  const deps = makeDeps({ user: { id: 1, password: 'hash' }, passwordMatches: false });
  const result = await authenticate({ identifier: 'a@b.com', password: 'wrong' }, deps);
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.message, 'Credenciais inválidas');
});

test('returns 200 with a signed token on success', async () => {
  const deps = makeDeps({ user: { id: 7, password: 'hash' }, passwordMatches: true });
  const result = await authenticate({ identifier: 'a@b.com', password: 'right' }, deps);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { access_token: 'token-for-7', token_type: 'bearer' });
});
