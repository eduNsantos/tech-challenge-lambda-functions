const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { createTokenSigner, TOKEN_TTL_SECONDS } = require('../src/token');

test('signs a token with the claims php-open-source-saver/jwt-auth expects', () => {
  const signer = createTokenSigner('test-secret', 'https://api.example.com/login');
  const token = signer.sign(42);
  const decoded = jwt.verify(token, 'test-secret', { algorithms: ['HS256'] });

  assert.equal(decoded.sub, 42);
  assert.equal(decoded.user_id, 42);
  assert.equal(decoded.iss, 'https://api.example.com/login');
  assert.equal(
    decoded.prv,
    crypto.createHash('sha1').update('App\\Models\\User').digest('hex')
  );
  assert.ok(decoded.jti && decoded.jti.length > 0);
  assert.equal(decoded.nbf, decoded.iat);
  assert.equal(decoded.exp - decoded.iat, TOKEN_TTL_SECONDS);
});

test('two tokens for the same user have different jti', () => {
  const signer = createTokenSigner('test-secret', 'iss');
  const a = jwt.decode(signer.sign(1));
  const b = jwt.decode(signer.sign(1));
  assert.notEqual(a.jti, b.jti);
});

test('rejects verification with the wrong secret', () => {
  const signer = createTokenSigner('right-secret', 'iss');
  const token = signer.sign(1);
  assert.throws(() => jwt.verify(token, 'wrong-secret'));
});
