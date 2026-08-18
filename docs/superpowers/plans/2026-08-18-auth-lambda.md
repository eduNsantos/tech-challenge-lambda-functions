# Auth Lambda (API Gateway + Lambda Node.js 24) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision, via Terraform, an API Gateway + Lambda (Node.js 24) endpoint that authenticates a user by CPF or e-mail + password against the RDS from `tech-challenge-database`, issuing a JWT compatible with the `php-open-source-saver/jwt-auth` guard used by `tech-challenge-application`.

**Architecture:** The Lambda's business logic is split into small, dependency-injected modules (identifier classification, user lookup, password check, token signing) composed in `src/index.js`. Terraform locates the existing VPC/subnets/RDS-security-group by tag (same pattern as `tech-challenge-database`), looks up the RDS instance by a fixed `identifier`, creates a Secrets Manager secret for `db_password`/`jwt_secret`, a VPC interface endpoint so the Lambda (which lives in a private subnet) can reach Secrets Manager, and wires an HTTP API Gateway route (`POST /login`) to the Lambda.

**Tech Stack:** Terraform (`hashicorp/aws` ~> 6.0, `hashicorp/archive` ~> 2.4), Node.js 24 (`node:test` built-in test runner, no test framework dependency), `mysql2`, `bcryptjs`, `jsonwebtoken`, `@aws-sdk/client-secrets-manager`.

**Spec:** `docs/superpowers/specs/2026-08-18-auth-lambda-design.md`

## Global Constraints

- Lambda runtime must be `nodejs24.x` (confirmed GA on AWS).
- RDS discovery uses **data sources by tag** (`main` VPC, `sub_a`/`sub_b` subnets, `rds` security group) and `data "aws_db_instance"` by a fixed `identifier` — never `terraform_remote_state` (the other repo has no remote backend).
- The RDS `identifier` this repo looks up is `"tech-challenge-db"` — depends on the one-line change requested in `REQUEST-TO-DATABASE-REPO.md` (already committed at repo root). Until that change lands upstream, `terraform apply`/`plan` will fail to find the instance — this plan's tasks only run `terraform validate`/`fmt`, which don't call AWS, so this dependency does not block implementation.
- `users` table schema is fixed: `id`, `email`, `document` (digits only, 11 for CPF), `password` (bcrypt `$2y$`), `role`. Do not invent columns.
- JWT claims must match `php-open-source-saver/jwt-auth` defaults exactly: `sub` (user id, integer), `iat`, `nbf`, `exp` (= `iat` + 3600s), `jti` (random), `iss`, `prv` (`sha1('App\Models\User')`), plus custom claim `user_id` (= `sub`). Signed HS256 with the shared `jwt_secret`, using `noTimestamp: true` since `iat` is set manually.
- Success response: `200 { "access_token": "<jwt>", "token_type": "bearer" }`. Failure (bad credentials or user not found): `401 { "message": "Credenciais inválidas" }` — never distinguish "user not found" from "wrong password" in the response.
- Password verification via `bcryptjs` (pure-JS, handles `$2y$`/`$2b$`/`$2a$` uniformly — no native module to cross-compile for the Lambda zip).
- Lambda packaging: `data.archive_file` zipping `src/` (which includes its own `node_modules` after `npm install`), no external build pipeline.
- No dependency-mocking library (sinon, proxyquire, jest) — all modules are designed with plain dependency injection so `node:test` + `node:assert/strict` mocks are enough.
- Deviation from the spec's original file list: this plan adds `network.tf` (not listed in the spec) to hold the Lambda's security group, the Secrets Manager VPC endpoint, and its security group — needed because the Lambda sits in a private subnet and has no other route to Secrets Manager. This is called out explicitly in Task 12.

---

## Task 1: Repository scaffolding

**Files:**
- Create: `.gitignore`
- Create (empty dirs via `.gitkeep` not needed — created implicitly by later tasks): `src/`, `test/`

**Interfaces:** None (no code yet).

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
.terraform/
*.tfstate
*.tfstate.*
build/
*.zip
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add gitignore for terraform and node artifacts"
```

---

## Task 2: Lambda package manifest and dependencies

**Files:**
- Create: `src/package.json`
- Create (generated): `src/package-lock.json`, `src/node_modules/` (gitignored)

**Interfaces:**
- Produces: an `npm test` script runnable from `src/` that runs `node --test ../test/`.

- [ ] **Step 1: Create `src/package.json`**

```json
{
  "name": "tech-challenge-auth-lambda",
  "version": "1.0.0",
  "private": true,
  "description": "Lambda de autenticacao (CPF ou email + senha) do tech-challenge",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "test": "node --test ../test/"
  },
  "dependencies": {
    "mysql2": "^3.11.0",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "@aws-sdk/client-secrets-manager": "^3.632.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd src && npm install`
Expected: `node_modules/` and `package-lock.json` created, no errors.

- [ ] **Step 3: Smoke-check the dependencies resolve**

Run: `cd src && node -e "require('mysql2'); require('bcryptjs'); require('jsonwebtoken'); require('@aws-sdk/client-secrets-manager'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/package.json src/package-lock.json
git commit -m "chore: add lambda package manifest and dependencies"
```

---

## Task 3: Identifier classifier (CPF vs e-mail)

**Files:**
- Create: `src/identifier.js`
- Test: `test/identifier.test.js`

**Interfaces:**
- Produces: `classifyIdentifier(rawIdentifier: string) -> { field: 'document' | 'email', value: string }` — `value` for `document` is digits-only; for `email` it's the original string unchanged.

- [ ] **Step 1: Write the failing test**

Create `test/identifier.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIdentifier } = require('../src/identifier');

test('classifies an 11-digit CPF as document', () => {
  const result = classifyIdentifier('12345678901');
  assert.deepEqual(result, { field: 'document', value: '12345678901' });
});

test('classifies a formatted CPF as document, stripping punctuation', () => {
  const result = classifyIdentifier('123.456.789-01');
  assert.deepEqual(result, { field: 'document', value: '12345678901' });
});

test('classifies an email as email, unchanged', () => {
  const result = classifyIdentifier('user@example.com');
  assert.deepEqual(result, { field: 'email', value: 'user@example.com' });
});

test('classifies a non-11-digit numeric-looking string as email', () => {
  const result = classifyIdentifier('123456');
  assert.deepEqual(result, { field: 'email', value: '123456' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npm test`
Expected: FAIL — `Cannot find module '../src/identifier'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/identifier.js`:

```js
function classifyIdentifier(rawIdentifier) {
  const digitsOnly = rawIdentifier.replace(/\D/g, '');

  if (digitsOnly.length === 11) {
    return { field: 'document', value: digitsOnly };
  }

  return { field: 'email', value: rawIdentifier };
}

module.exports = { classifyIdentifier };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npm test`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/identifier.js test/identifier.test.js
git commit -m "feat: classify login identifier as CPF document or email"
```

---

## Task 4: JWT token signer compatible with php-open-source-saver/jwt-auth

**Files:**
- Create: `src/token.js`
- Test: `test/token.test.js`

**Interfaces:**
- Produces: `createTokenSigner(jwtSecret: string, issuer: string) -> { sign(userId: number) -> string }` and `TOKEN_TTL_SECONDS` (number, `3600`).

- [ ] **Step 1: Write the failing test**

Create `test/token.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npm test`
Expected: FAIL — `Cannot find module '../src/token'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/token.js`:

```js
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
        noTimestamp: true,
      });
    },
  };
}

module.exports = { createTokenSigner, TOKEN_TTL_SECONDS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npm test`
Expected: PASS — 7 tests passing (4 from Task 3 + 3 here).

- [ ] **Step 5: Commit**

```bash
git add src/token.js test/token.test.js
git commit -m "feat: sign JWTs compatible with php-open-source-saver/jwt-auth"
```

---

## Task 5: User repository (parameterized MySQL lookup)

**Files:**
- Create: `src/userRepository.js`
- Test: `test/userRepository.test.js`

**Interfaces:**
- Consumes: a `pool`-like object with an async `execute(sql, params) -> Promise<[rows]>` method (the shape `mysql2/promise` pools implement).
- Produces: `createUserRepository(pool) -> { findByIdentifier(field: 'document' | 'email', value: string) -> Promise<{id: number, password: string} | null> }`. Throws for any `field` other than `'document'`/`'email'`.

- [ ] **Step 1: Write the failing test**

Create `test/userRepository.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUserRepository } = require('../src/userRepository');

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npm test`
Expected: FAIL — `Cannot find module '../src/userRepository'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/userRepository.js`:

```js
const QUERIES = {
  document: 'SELECT id, password FROM users WHERE document = ? LIMIT 1',
  email: 'SELECT id, password FROM users WHERE email = ? LIMIT 1',
};

function createUserRepository(pool) {
  return {
    async findByIdentifier(field, value) {
      const sql = QUERIES[field];
      if (!sql) {
        throw new Error(`Unsupported identifier field: ${field}`);
      }

      const [rows] = await pool.execute(sql, [value]);
      return rows[0] ?? null;
    },
  };
}

module.exports = { createUserRepository };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npm test`
Expected: PASS — 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/userRepository.js test/userRepository.test.js
git commit -m "feat: add parameterized user lookup by document or email"
```

---

## Task 6: Secrets Manager loader with warm-invocation caching

**Files:**
- Create: `src/secretsLoader.js`
- Test: `test/secretsLoader.test.js`

**Interfaces:**
- Consumes: a `client`-like object with an async `send(command) -> Promise<{SecretString: string}>` method (the shape `@aws-sdk/client-secrets-manager`'s `SecretsManagerClient` implements).
- Produces: `createSecretsLoader(client, secretId: string) -> { load() -> Promise<{db_password: string, jwt_secret: string}> }`. Caches the parsed secret after the first successful `load()`.

- [ ] **Step 1: Write the failing test**

Create `test/secretsLoader.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSecretsLoader } = require('../src/secretsLoader');

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npm test`
Expected: FAIL — `Cannot find module '../src/secretsLoader'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/secretsLoader.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npm test`
Expected: PASS — 13 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/secretsLoader.js test/secretsLoader.test.js
git commit -m "feat: load and cache db/jwt secrets from Secrets Manager"
```

---

## Task 7: Authenticate core logic

**Files:**
- Create: `src/authenticate.js`
- Test: `test/authenticate.test.js`

**Interfaces:**
- Consumes:
  - `deps.classifyIdentifier` — same signature as Task 3's `classifyIdentifier`.
  - `deps.userRepository` — object with `findByIdentifier(field, value)`, same shape as Task 5's repository.
  - `deps.comparePassword(plainPassword: string, hash: string) -> boolean`.
  - `deps.tokenSigner` — object with `sign(userId)`, same shape as Task 4's signer.
- Produces: `authenticate({ identifier, password }, deps) -> Promise<{ statusCode: number, body: object }>`.

- [ ] **Step 1: Write the failing test**

Create `test/authenticate.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { authenticate } = require('../src/authenticate');

function makeDeps({ user = null, passwordMatches = false } = {}) {
  return {
    classifyIdentifier: (id) => ({ field: 'email', value: id }),
    userRepository: { findByIdentifier: async () => user },
    comparePassword: () => passwordMatches,
    tokenSigner: { sign: (id) => `token-for-${id}` },
  };
}

test('returns 400 when identifier is missing', async () => {
  const result = await authenticate({ password: 'x' }, makeDeps());
  assert.equal(result.statusCode, 400);
});

test('returns 400 when password is missing', async () => {
  const result = await authenticate({ identifier: 'a@b.com' }, makeDeps());
  assert.equal(result.statusCode, 400);
});

test('returns 401 when user is not found', async () => {
  const result = await authenticate(
    { identifier: 'a@b.com', password: 'x' },
    makeDeps({ user: null })
  );
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.message, 'Credenciais inválidas');
});

test('returns 401 when the password does not match', async () => {
  const deps = makeDeps({ user: { id: 1, password: 'hash' }, passwordMatches: false });
  const result = await authenticate({ identifier: 'a@b.com', password: 'wrong' }, deps);
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.message, 'Credenciais inválidas');
});

test('returns 200 with a signed token on success', async () => {
  const deps = makeDeps({ user: { id: 7, password: 'hash' }, passwordMatches: true });
  const result = await authenticate({ identifier: 'a@b.com', password: 'right' }, deps);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { access_token: 'token-for-7', token_type: 'bearer' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npm test`
Expected: FAIL — `Cannot find module '../src/authenticate'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/authenticate.js`:

```js
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function authenticate({ identifier, password }, deps) {
  if (!isNonEmptyString(identifier) || !isNonEmptyString(password)) {
    return {
      statusCode: 400,
      body: { message: 'identifier e password são obrigatórios' },
    };
  }

  const { field, value } = deps.classifyIdentifier(identifier);
  const user = await deps.userRepository.findByIdentifier(field, value);

  if (!user || !deps.comparePassword(password, user.password)) {
    return { statusCode: 401, body: { message: 'Credenciais inválidas' } };
  }

  const token = deps.tokenSigner.sign(user.id);
  return { statusCode: 200, body: { access_token: token, token_type: 'bearer' } };
}

module.exports = { authenticate };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npm test`
Expected: PASS — 18 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/authenticate.js test/authenticate.test.js
git commit -m "feat: add core login authentication logic"
```

---

## Task 8: DB pool factory

**Files:**
- Create: `src/db.js`

**Interfaces:**
- Produces: `createPool({ host, port, user, password, database }) -> mysql2/promise Pool` (has an `execute(sql, params)` method, matching what Task 5's `createUserRepository` consumes).

This is a two-line wrapper around `mysql2/promise` with no branching logic — not worth an isolated dependency-injected test (there's nothing to assert beyond "it calls the library with these arguments," which the library itself already guarantees). It is exercised indirectly by Task 9's handler tests via injected fakes, and for real by the manual post-deploy check described in the spec's Testes section.

- [ ] **Step 1: Write the implementation**

Create `src/db.js`:

```js
const mysql = require('mysql2/promise');

function createPool({ host, port, user, password, database }) {
  return mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    connectionLimit: 2,
  });
}

module.exports = { createPool };
```

- [ ] **Step 2: Smoke-check it loads without throwing**

Run: `cd src && node -e "require('./db'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/db.js
git commit -m "feat: add mysql2 connection pool factory"
```

---

## Task 9: Lambda handler wiring

**Files:**
- Create: `src/index.js`
- Test: `test/index.test.js`

**Interfaces:**
- Consumes: `classifyIdentifier` (Task 3), `createTokenSigner`/`TOKEN_TTL_SECONDS` (Task 4), `createUserRepository` (Task 5), `createSecretsLoader` (Task 6), `authenticate` (Task 7), `createPool` (Task 8).
- Produces: `createHandler(getDeps: () => Promise<AuthenticateDeps>) -> (event) => Promise<{statusCode, headers, body}>` and `exports.handler` (the real, AWS-wired handler used by Terraform).

- [ ] **Step 1: Write the failing test**

Create `test/index.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../src/index');

function fakeDeps() {
  return {
    classifyIdentifier: (id) => ({ field: 'email', value: id }),
    userRepository: { findByIdentifier: async () => ({ id: 1, password: 'hash' }) },
    comparePassword: () => true,
    tokenSigner: { sign: (id) => `token-${id}` },
  };
}

test('returns 200 and a token for a valid login event', async () => {
  const handler = createHandler(async () => fakeDeps());
  const event = { body: JSON.stringify({ identifier: 'a@b.com', password: 'x' }) };

  const result = await handler(event);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { access_token: 'token-1', token_type: 'bearer' });
  assert.equal(result.headers['Content-Type'], 'application/json');
});

test('returns 400 for an unparseable body', async () => {
  const handler = createHandler(async () => fakeDeps());

  const result = await handler({ body: 'not-json' });

  assert.equal(result.statusCode, 400);
});

test('returns 400 for a missing body', async () => {
  const handler = createHandler(async () => fakeDeps());

  const result = await handler({});

  assert.equal(result.statusCode, 400);
});

test('returns 500 when dependency wiring throws', async () => {
  const handler = createHandler(async () => {
    throw new Error('boom');
  });

  const result = await handler({ body: JSON.stringify({ identifier: 'a', password: 'b' }) });

  assert.equal(result.statusCode, 500);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src && npm test`
Expected: FAIL — `Cannot find module '../src/index'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/index.js`:

```js
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
      parsedBody = JSON.parse(event.body || '{}');
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
    comparePassword: (plain, hash) => bcrypt.compareSync(plain, hash),
    tokenSigner,
  };
}

module.exports = { createHandler };
module.exports.handler = createHandler(getRealDeps);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src && npm test`
Expected: PASS — 22 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/index.js test/index.test.js
git commit -m "feat: wire lambda handler for the login endpoint"
```

---

## Task 10: Terraform base configuration (providers, variables)

**Files:**
- Create: `providers.tf`
- Create: `variables.tf`

**Interfaces:**
- Produces Terraform variables consumed by later tasks: `var.aws_region`, `var.db_identifier`, `var.db_name`, `var.db_user`, `var.db_password` (sensitive), `var.jwt_secret` (sensitive), `var.token_issuer`.

Terraform config isn't unit-testable the way the Lambda code is; `terraform validate` (syntax + internal consistency) is the equivalent verification step used throughout the remaining tasks. It runs fully offline — no AWS credentials or network calls to AWS are needed.

- [ ] **Step 1: Create `providers.tf`**

```hcl
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
```

- [ ] **Step 2: Create `variables.tf`**

```hcl
variable "aws_region" {
  description = "Região da AWS onde os recursos serão criados"
  type        = string
  default     = "us-east-1"
}

variable "db_identifier" {
  description = "Identifier fixo da instância RDS no repositório tech-challenge-database"
  type        = string
  default     = "tech-challenge-db"
}

variable "db_name" {
  description = "Nome do banco de dados MySQL usado pela aplicação"
  type        = string
}

variable "db_user" {
  description = "Usuário do MySQL usado pelo Lambda para autenticar"
  type        = string
}

variable "db_password" {
  description = "Senha do usuário do MySQL (deve ser igual à usada no repo tech-challenge-database)"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "Segredo usado para assinar os JWTs (deve ser igual ao JWT_SECRET da aplicação Laravel)"
  type        = string
  sensitive   = true
}

variable "token_issuer" {
  description = "Valor do claim 'iss' incluído nos JWTs emitidos pelo Lambda"
  type        = string
  default     = "tech-challenge-lambda-auth"
}
```

- [ ] **Step 3: Initialize Terraform and validate**

Run: `terraform init && terraform fmt -check && terraform validate`
Expected: `terraform init` succeeds (downloads `aws` and `archive` providers); `terraform fmt -check` prints nothing (no diffs); `terraform validate` prints `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
git add providers.tf variables.tf .terraform.lock.hcl
git commit -m "chore: add terraform provider and variable definitions"
```

---

## Task 11: Terraform data sources (VPC, subnets, RDS security group, RDS instance)

**Files:**
- Create: `data.tf`

**Interfaces:**
- Produces: `data.aws_vpc.main`, `data.aws_subnet.sub_a`, `data.aws_subnet.sub_b`, `data.aws_security_group.rds`, `data.aws_db_instance.main` — consumed by Task 12 and Task 13.

- [ ] **Step 1: Create `data.tf`**

```hcl
data "aws_vpc" "main" {
  filter {
    name   = "tag:Name"
    values = ["main"]
  }
}

data "aws_subnet" "sub_a" {
  filter {
    name   = "tag:Name"
    values = ["sub_a"]
  }
}

data "aws_subnet" "sub_b" {
  filter {
    name   = "tag:Name"
    values = ["sub_b"]
  }
}

data "aws_security_group" "rds" {
  filter {
    name   = "tag:Name"
    values = ["rds"]
  }
}

data "aws_db_instance" "main" {
  db_instance_identifier = var.db_identifier
}
```

- [ ] **Step 2: Validate**

Run: `terraform fmt -check && terraform validate`
Expected: no formatting diffs; `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add data.tf
git commit -m "feat: add data sources to locate the shared VPC, subnets and RDS"
```

---

## Task 12: Terraform networking (Lambda security group + Secrets Manager VPC endpoint)

**Files:**
- Create: `network.tf`

**Note on scope:** the spec's file list didn't anticipate this file — it assumed the Lambda's security group would live in `lambda.tf`. Splitting it out is necessary because this task also adds a VPC interface endpoint for Secrets Manager: the Lambda runs in private subnets (`sub_a`/`sub_b`) that may have no route to the public internet, so without this endpoint `secretsmanager:GetSecretValue` calls from the Lambda would time out. The endpoint is entirely owned by this repository (it only needs the shared VPC/subnet IDs), so no upstream change is required for it.

**Interfaces:**
- Produces: `aws_security_group.lambda` (id) — consumed by Task 13's `aws_lambda_function.auth.vpc_config`.

- [ ] **Step 1: Create `network.tf`**

```hcl
resource "aws_security_group" "lambda" {
  name        = "tech-challenge-auth-lambda"
  description = "Security group do Lambda de autenticacao"
  vpc_id      = data.aws_vpc.main.id

  tags = {
    Name = "tech-challenge-auth-lambda"
  }
}

resource "aws_security_group" "secretsmanager_endpoint" {
  name        = "tech-challenge-auth-lambda-secretsmanager-endpoint"
  description = "Security group do VPC endpoint do Secrets Manager"
  vpc_id      = data.aws_vpc.main.id

  tags = {
    Name = "tech-challenge-auth-lambda-secretsmanager-endpoint"
  }
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_rds" {
  security_group_id            = aws_security_group.lambda.id
  description                   = "MySQL para o RDS do tech-challenge-database"
  from_port                     = 3306
  to_port                       = 3306
  ip_protocol                   = "tcp"
  referenced_security_group_id  = data.aws_security_group.rds.id
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_secretsmanager_endpoint" {
  security_group_id            = aws_security_group.lambda.id
  description                   = "HTTPS para o VPC endpoint do Secrets Manager"
  from_port                     = 443
  to_port                       = 443
  ip_protocol                   = "tcp"
  referenced_security_group_id  = aws_security_group.secretsmanager_endpoint.id
}

resource "aws_vpc_security_group_ingress_rule" "secretsmanager_endpoint_from_lambda" {
  security_group_id            = aws_security_group.secretsmanager_endpoint.id
  description                   = "HTTPS do Lambda de autenticacao"
  from_port                     = 443
  to_port                       = 443
  ip_protocol                   = "tcp"
  referenced_security_group_id  = aws_security_group.lambda.id
}

resource "aws_vpc_endpoint" "secretsmanager" {
  vpc_id              = data.aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [data.aws_subnet.sub_a.id, data.aws_subnet.sub_b.id]
  security_group_ids  = [aws_security_group.secretsmanager_endpoint.id]
  private_dns_enabled = true

  tags = {
    Name = "tech-challenge-auth-lambda-secretsmanager"
  }
}
```

Two security groups reference each other's id (via `aws_vpc_security_group_egress_rule`/`_ingress_rule`, not inline `egress`/`ingress` blocks) specifically to avoid a dependency cycle Terraform can't resolve — inline rule blocks on two mutually-referencing security groups would fail to plan.

- [ ] **Step 2: Validate**

Run: `terraform fmt -check && terraform validate`
Expected: no formatting diffs; `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add network.tf
git commit -m "feat: add lambda security group and secrets manager vpc endpoint"
```

---

## Task 13: Terraform secrets (Secrets Manager secret)

**Files:**
- Create: `secrets.tf`

**Interfaces:**
- Produces: `aws_secretsmanager_secret.auth_lambda` (id, name, arn) — consumed by Task 14's IAM policy and the Lambda's environment variables.

- [ ] **Step 1: Create `secrets.tf`**

```hcl
resource "aws_secretsmanager_secret" "auth_lambda" {
  name        = "tech-challenge/auth-lambda"
  description = "Credenciais usadas pelo Lambda de autenticacao (db_password, jwt_secret)"
}

resource "aws_secretsmanager_secret_version" "auth_lambda" {
  secret_id = aws_secretsmanager_secret.auth_lambda.id
  secret_string = jsonencode({
    db_password = var.db_password
    jwt_secret  = var.jwt_secret
  })
}
```

- [ ] **Step 2: Validate**

Run: `terraform fmt -check && terraform validate`
Expected: no formatting diffs; `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add secrets.tf
git commit -m "feat: store db_password and jwt_secret in secrets manager"
```

---

## Task 14: Terraform Lambda resource (IAM, package, function)

**Files:**
- Create: `lambda.tf`

**Interfaces:**
- Consumes: `aws_security_group.lambda` (Task 12), `aws_secretsmanager_secret.auth_lambda` (Task 13), `data.aws_subnet.sub_a`/`sub_b`, `data.aws_db_instance.main` (Task 11).
- Produces: `aws_lambda_function.auth` (function_name, invoke_arn) — consumed by Task 15's API Gateway integration.

- [ ] **Step 1: Create `lambda.tf`**

```hcl
data "archive_file" "auth_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/src"
  output_path = "${path.module}/build/auth-lambda.zip"
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "auth_lambda" {
  name               = "tech-challenge-auth-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "vpc_access" {
  role       = aws_iam_role.auth_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "lambda_secrets_access" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.auth_lambda.arn]
  }
}

resource "aws_iam_role_policy" "secrets_access" {
  name   = "tech-challenge-auth-lambda-secrets-access"
  role   = aws_iam_role.auth_lambda.id
  policy = data.aws_iam_policy_document.lambda_secrets_access.json
}

resource "aws_lambda_function" "auth" {
  function_name    = "tech-challenge-auth-login"
  role             = aws_iam_role.auth_lambda.arn
  runtime          = "nodejs24.x"
  handler          = "index.handler"
  filename         = data.archive_file.auth_lambda.output_path
  source_code_hash = data.archive_file.auth_lambda.output_base64sha256
  timeout          = 10
  memory_size      = 256

  vpc_config {
    subnet_ids         = [data.aws_subnet.sub_a.id, data.aws_subnet.sub_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      AUTH_SECRET_ID = aws_secretsmanager_secret.auth_lambda.name
      DB_HOST        = data.aws_db_instance.main.address
      DB_PORT        = tostring(data.aws_db_instance.main.port)
      DB_NAME        = var.db_name
      DB_USER        = var.db_user
      TOKEN_ISSUER   = var.token_issuer
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.vpc_access,
    aws_iam_role_policy.secrets_access,
  ]
}
```

- [ ] **Step 2: Validate**

Run: `terraform fmt -check && terraform validate`
Expected: no formatting diffs; `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add lambda.tf
git commit -m "feat: provision the auth lambda function and its iam role"
```

---

## Task 15: Terraform API Gateway (HTTP API)

**Files:**
- Create: `apigateway.tf`

**Interfaces:**
- Consumes: `aws_lambda_function.auth` (Task 14).
- Produces: `aws_apigatewayv2_stage.default` (invoke_url) — consumed by Task 16's output.

- [ ] **Step 1: Create `apigateway.tf`**

```hcl
resource "aws_apigatewayv2_api" "auth" {
  name          = "tech-challenge-auth-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "auth" {
  api_id                 = aws_apigatewayv2_api.auth.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "login" {
  api_id    = aws_apigatewayv2_api.auth.id
  route_key = "POST /login"
  target    = "integrations/${aws_apigatewayv2_integration.auth.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.auth.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.auth.execution_arn}/*/*"
}
```

- [ ] **Step 2: Validate**

Run: `terraform fmt -check && terraform validate`
Expected: no formatting diffs; `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add apigateway.tf
git commit -m "feat: expose the login lambda through an http api gateway"
```

---

## Task 16: Terraform outputs and full-repo validation

**Files:**
- Create: `outputs.tf`

- [ ] **Step 1: Create `outputs.tf`**

```hcl
output "invoke_url" {
  description = "URL base da API de autenticacao"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "login_url" {
  description = "URL completa do endpoint de login"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}login"
}
```

- [ ] **Step 2: Validate the whole repository**

Run: `terraform fmt -check && terraform validate`
Expected: no formatting diffs; `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add outputs.tf
git commit -m "feat: output the login endpoint invoke url"
```

---

## Task 17: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# tech-challenge-lambda-functions

API de autenticação serverless (API Gateway + AWS Lambda, Node.js 24) que
permite login por **CPF ou e-mail + senha** contra o MySQL do repositório
[`tech-challenge-database`](https://github.com/eduNsantos/tech-challenge-database),
emitindo um JWT compatível com o `php-open-source-saver/jwt-auth` usado pela
aplicação [`tech-challenge-application`](https://github.com/eduNsantos/tech-challenge-application).

Design completo: [`docs/superpowers/specs/2026-08-18-auth-lambda-design.md`](docs/superpowers/specs/2026-08-18-auth-lambda-design.md).

## Pré-requisitos antes do primeiro deploy

1. **`tech-challenge-database`**: precisa de um `identifier` fixo na
   instância RDS. Ver [`REQUEST-TO-DATABASE-REPO.md`](REQUEST-TO-DATABASE-REPO.md).
2. **`tech-challenge-application`**: precisa apontar para essa mesma RDS,
   ter rodado `php artisan migrate` nela, e ter um `JWT_SECRET` definido.
   Ver [`REQUEST-TO-APPLICATION-REPO.md`](REQUEST-TO-APPLICATION-REPO.md).
3. AWS CLI configurado com credenciais que tenham permissão para criar VPC
   endpoint, Security Group, Secrets Manager secret, IAM role, Lambda e API
   Gateway na região alvo.

## Variáveis obrigatórias

| Variável | Descrição |
|---|---|
| `db_name` | Nome do banco MySQL |
| `db_user` | Usuário do MySQL |
| `db_password` | Senha do MySQL — **igual** à usada em `tech-challenge-database` |
| `jwt_secret` | Segredo de assinatura JWT — **igual** ao `JWT_SECRET` da aplicação Laravel |

Passe-as via `-var`, um arquivo `*.tfvars` não versionado, ou variáveis de
ambiente `TF_VAR_*`. Nunca commite esses valores.

## Aplicar

```bash
terraform init
terraform plan \
  -var "db_name=..." \
  -var "db_user=..." \
  -var "db_password=..." \
  -var "jwt_secret=..."
terraform apply \
  -var "db_name=..." \
  -var "db_user=..." \
  -var "db_password=..." \
  -var "jwt_secret=..."
```

Após o apply, o output `login_url` traz a URL completa do endpoint.

## Testar

Testes unitários do Lambda (mockam banco e Secrets Manager, não precisam
de AWS):

```bash
cd src && npm install && npm test
```

Testar o endpoint já implantado:

```bash
curl -X POST "$(terraform output -raw login_url)" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "usuario@example.com", "password": "senha-do-usuario"}'
```

Resposta esperada em caso de sucesso:

```json
{ "access_token": "<jwt>", "token_type": "bearer" }
```

## Estrutura

```
providers.tf, variables.tf   # provider aws/archive, variáveis de entrada
data.tf                      # localiza VPC/subnets/SG/RDS do tech-challenge-database
network.tf                   # security group da lambda + vpc endpoint do Secrets Manager
secrets.tf                   # secret com db_password e jwt_secret
lambda.tf                    # iam role, empacotamento (archive_file) e aws_lambda_function
apigateway.tf                # HTTP API Gateway (POST /login)
outputs.tf                   # invoke_url / login_url
src/                         # código do Lambda (Node.js 24)
test/                        # testes unitários (node:test)
```
```

- [ ] **Step 2: Confirm the referenced files exist**

Run: `ls REQUEST-TO-DATABASE-REPO.md REQUEST-TO-APPLICATION-REPO.md docs/superpowers/specs/2026-08-18-auth-lambda-design.md`
Expected: all three paths listed, no "No such file" errors (the two `REQUEST-TO-*` files and the spec were already created and committed during design — this step only confirms the README's links resolve).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add readme with setup, variables and test instructions"
```

---

## Self-Review Notes

- **Spec coverage:** network/data-source pattern (Task 11–12), Secrets Manager (Task 13), `nodejs24.x` + archive_file packaging (Task 14), identifier/JWT/bcrypt/schema fidelity (Tasks 3–9), response contract (Task 7/9), API Gateway route (Task 15), outputs (Task 16), README + both request docs (Task 17, with the two request docs already delivered during brainstorming) — all spec sections map to a task.
- **Type consistency:** `field` values (`'document'`/`'email'`) are identical across Task 3 (`classifyIdentifier`), Task 5 (`QUERIES` keys), and every consuming test. `userRepository.findByIdentifier` return shape (`{id, password}` or `null`) is identical across Tasks 5, 7, 9. `tokenSigner.sign(userId)` signature is identical across Tasks 4, 7, 9.
- **No placeholders:** every step has runnable code or an exact shell command.
