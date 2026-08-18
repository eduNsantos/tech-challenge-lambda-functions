const test = require('node:test');
const assert = require('node:assert/strict');
const { createUserRepository } = require('../userRepository');

function fakePool(rows) {
  return {
    calls: [],
    async execute(sql, params) {
      this.calls.push({ sql, params });
      return [rows];
    },
  };
}

test('finds a user by document with a parameterized query', async () => {
  const pool = fakePool([{ id: 1, password: 'hash' }]);
  const repo = createUserRepository(pool);

  const user = await repo.findByIdentifier('document', '12345678901');

  assert.deepEqual(user, { id: 1, password: 'hash' });
  assert.match(pool.calls[0].sql, /document/);
  assert.deepEqual(pool.calls[0].params, ['12345678901']);
});

test('finds a user by email with a parameterized query', async () => {
  const pool = fakePool([{ id: 2, password: 'hash2' }]);
  const repo = createUserRepository(pool);

  const user = await repo.findByIdentifier('email', 'user@example.com');

  assert.deepEqual(user, { id: 2, password: 'hash2' });
  assert.match(pool.calls[0].sql, /email/);
  assert.deepEqual(pool.calls[0].params, ['user@example.com']);
});

test('returns null when no row matches', async () => {
  const pool = fakePool([]);
  const repo = createUserRepository(pool);

  const user = await repo.findByIdentifier('email', 'missing@example.com');

  assert.equal(user, null);
});

test('rejects an unsupported field', async () => {
  const pool = fakePool([]);
  const repo = createUserRepository(pool);

  await assert.rejects(() => repo.findByIdentifier('role', 'admin'));
});
