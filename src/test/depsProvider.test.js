const test = require('node:test');
const assert = require('node:assert/strict');
const { createDepsProvider } = require('../depsProvider');

test('rebuilds the pool and token signer when secrets rotate', async () => {
  let dbPassword = 'old';
  let jwtSecret = 'old-secret';
  const secretsLoader = { load: async () => ({ db_password: dbPassword, jwt_secret: jwtSecret }) };
  let poolBuilds = 0;
  let signerBuilds = 0;
  const provider = createDepsProvider({
    secretsLoader,
    buildPool: (password) => {
      poolBuilds += 1;
      return { password };
    },
    buildTokenSigner: (secret) => {
      signerBuilds += 1;
      return { secret };
    },
  });

  const first = await provider();
  dbPassword = 'new';
  jwtSecret = 'new-secret';
  const second = await provider();

  assert.equal(poolBuilds, 2);
  assert.equal(signerBuilds, 2);
  assert.notEqual(first.pool, second.pool);
  assert.notEqual(first.tokenSigner, second.tokenSigner);
});

test('reuses the pool and token signer when secrets have not changed', async () => {
  const secretsLoader = { load: async () => ({ db_password: 'p', jwt_secret: 's' }) };
  let poolBuilds = 0;
  let signerBuilds = 0;
  const provider = createDepsProvider({
    secretsLoader,
    buildPool: () => {
      poolBuilds += 1;
      return {};
    },
    buildTokenSigner: () => {
      signerBuilds += 1;
      return {};
    },
  });

  await provider();
  await provider();

  assert.equal(poolBuilds, 1);
  assert.equal(signerBuilds, 1);
});
