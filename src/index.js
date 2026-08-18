const bcrypt = require('bcryptjs');
const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const { classifyIdentifier } = require('./identifier');
const { createUserRepository } = require('./userRepository');
const { createTokenSigner } = require('./token');
const { createSecretsLoader } = require('./secretsLoader');
const { createPool } = require('./db');
const { authenticate } = require('./authenticate');

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function createHandler(getDeps) {
  return async function handler(event) {
    let parsedBody;
    try {
      parsedBody = JSON.parse(event.body || '{}') ?? {};
    } catch {
      return response(400, { message: 'body inválido' });
    }

    try {
      const deps = await getDeps();
      const result = await authenticate(parsedBody, deps);
      return response(result.statusCode, result.body);
    } catch (err) {
      console.error('auth-lambda error', err);
      return response(500, { message: 'Erro interno' });
    }
  };
}

let pool;
let tokenSigner;
const secretsLoader = createSecretsLoader(
  new SecretsManagerClient({}),
  process.env.AUTH_SECRET_ID
);

async function getRealDeps() {
  const secrets = await secretsLoader.load();

  if (!pool) {
    pool = createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: secrets.db_password,
      database: process.env.DB_NAME,
    });
  }

  if (!tokenSigner) {
    tokenSigner = createTokenSigner(
      secrets.jwt_secret,
      process.env.TOKEN_ISSUER || 'tech-challenge-lambda-auth'
    );
  }

  return {
    classifyIdentifier,
    userRepository: createUserRepository(pool),
    comparePassword: (plain, hash) =>
      typeof hash === 'string' && bcrypt.compareSync(plain, hash),
    tokenSigner,
  };
}

module.exports = { createHandler };
module.exports.handler = createHandler(getRealDeps);
