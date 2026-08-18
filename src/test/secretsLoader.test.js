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
