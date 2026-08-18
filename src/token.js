const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');

const TOKEN_TTL_SECONDS = 3600;
const LARAVEL_USER_MODEL_HASH = crypto
  .createHash('sha1')
  .update('App\\Models\\User')
  .digest('hex');

function createTokenSigner(jwtSecret, issuer) {
  return {
    sign(userId) {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        sub: userId,
        iat: now,
        nbf: now,
        exp: now + TOKEN_TTL_SECONDS,
        jti: crypto.randomUUID(),
        iss: issuer,
        prv: LARAVEL_USER_MODEL_HASH,
        user_id: userId,
      };

      return jwt.sign(payload, jwtSecret, {
        algorithm: 'HS256',
      });
    },
  };
}

module.exports = { createTokenSigner, TOKEN_TTL_SECONDS };
