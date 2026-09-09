const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function createSecretsLoader(client, secretId, { ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  let cached;
  let loadedAt;

  return {
    async load() {
      if (!cached || now() - loadedAt >= ttlMs) {
        const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
        cached = JSON.parse(response.SecretString);
        loadedAt = now();
      }

      return cached;
    },
  };
}

module.exports = { createSecretsLoader };
