const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

function createSecretsLoader(client, secretId) {
  let cached;

  return {
    async load() {
      if (!cached) {
        const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
        cached = JSON.parse(response.SecretString);
      }

      return cached;
    },
  };
}

module.exports = { createSecretsLoader };
