const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../index');

function fakeDeps() {
  return {
    classifyIdentifier: (id) => ({ field: 'email', value: id }),
    userRepository: { findByIdentifier: async () => ({ id: 1, password: 'hash' }) },
    comparePassword: () => true,
    tokenSigner: { sign: (id) => `token-${id}` },
  };
}

test('returns 200 and a token for a valid login event', async () => {
  const handler = createHandler(async () => fakeDeps());
  const event = { body: JSON.stringify({ identifier: 'a@b.com', password: 'x' }) };

  const result = await handler(event);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { access_token: 'token-1', token_type: 'bearer' });
  assert.equal(result.headers['Content-Type'], 'application/json');
});

test('returns 400 for an unparseable body', async () => {
  const handler = createHandler(async () => fakeDeps());

  const result = await handler({ body: 'not-json' });

  assert.equal(result.statusCode, 400);
});

test('returns 400 for a missing body', async () => {
  const handler = createHandler(async () => fakeDeps());

  const result = await handler({});

  assert.equal(result.statusCode, 400);
});

test('returns 500 when dependency wiring throws', async () => {
  const handler = createHandler(async () => {
    throw new Error('boom');
  });

  const result = await handler({ body: JSON.stringify({ identifier: 'a', password: 'b' }) });

  assert.equal(result.statusCode, 500);
});
