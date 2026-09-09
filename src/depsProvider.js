function createDepsProvider({ secretsLoader, buildPool, buildTokenSigner }) {
  let pool;
  let tokenSigner;
  let lastDbPassword;
  let lastJwtSecret;

  return async function resolveResources() {
    const secrets = await secretsLoader.load();

    if (!pool || secrets.db_password !== lastDbPassword) {
      pool = buildPool(secrets.db_password);
      lastDbPassword = secrets.db_password;
    }

    if (!tokenSigner || secrets.jwt_secret !== lastJwtSecret) {
      tokenSigner = buildTokenSigner(secrets.jwt_secret);
      lastJwtSecret = secrets.jwt_secret;
    }

    return { pool, tokenSigner };
  };
}

module.exports = { createDepsProvider };
