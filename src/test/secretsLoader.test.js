const test = require('node:test');
const assert = require('node:assert/strict');
const { createSecretsLoader } = require('../secretsLoader');

function fakeClient(secretString) {
  return {
    calls: 0,
    async send() {
      this.calls += 1;
      return { SecretString: secretString };
    },
  };
}

test('parses the secret JSON', async () => {
  const client = fakeClient(JSON.stringify({ db_password: 'p', jwt_secret: 's' }));
  const loader = createSecretsLoader(client, 'my-secret');

  const secrets = await loader.load();

  assert.deepEqual(secrets, { db_password: 'p', jwt_secret: 's' });
});

test('caches the secret after the first load', async () => {
  const client = fakeClient(JSON.stringify({ db_password: 'p', jwt_secret: 's' }));
  const loader = createSecretsLoader(client, 'my-secret');

  await loader.load();
  await loader.load();

  assert.equal(client.calls, 1);
});

test('refetches the secret once the TTL has elapsed', async () => {
  const client = fakeClient(JSON.stringify({ db_password: 'p', jwt_secret: 's' }));
  let now = 0;
  const loader = createSecretsLoader(client, 'my-secret', { ttlMs: 1000, now: () => now });

  await loader.load();
  now += 1001;
  await loader.load();

  assert.equal(client.calls, 2);
});

test('keeps using the cached secret before the TTL elapses', async () => {
  const client = fakeClient(JSON.stringify({ db_password: 'p', jwt_secret: 's' }));
  let now = 0;
  const loader = createSecretsLoader(client, 'my-secret', { ttlMs: 1000, now: () => now });

  await loader.load();
  now += 999;
  await loader.load();

  assert.equal(client.calls, 1);
});
