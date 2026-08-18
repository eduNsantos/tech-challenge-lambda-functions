# Auth Lambda — API Gateway + Lambda (Node.js 24) Design

## Contexto

Este repositório provisiona, via Terraform, uma API de autenticação servless
(API Gateway + AWS Lambda) que permite login por **CPF ou e-mail + senha**
contra o RDS MySQL provisionado no repositório
[`tech-challenge-database`](https://github.com/eduNsantos/tech-challenge-database).

O schema da tabela `users` é definido pelas migrations do Laravel em
[`tech-challenge-application`](https://github.com/eduNsantos/tech-challenge-application),
que já expõe um login próprio (`POST /auth/login`) via
`php-open-source-saver/jwt-auth` (fork mantido do `tymon/jwt-auth`). Este
Lambda deve emitir tokens **compatíveis** com esse mecanismo, para que
possam ser usados nas rotas protegidas (`auth:api`) da aplicação Laravel.

Repositórios relevantes e seus papéis:

| Repositório | Papel |
|---|---|
| `tech-challenge-database` | Cria a RDS MySQL (VPC/subnets/SG localizados por tag: `main`, `sub_a`, `sub_b`, `rds`). Fonte de verdade da infraestrutura de rede/banco. |
| `tech-challenge-application` | Aplicação Laravel; dona do schema (migrations) e da semântica de autenticação (JWT, bcrypt) que este Lambda precisa replicar. Não é a infra de deploy do RDS de produção usada aqui. |
| `tech-challenge-lambda-functions` (este repo) | Provisiona API Gateway + Lambda de login, referenciando a RDS do primeiro repositório. |

## Dependência externa: `tech-challenge-database`

O `aws_db_instance.rds` nesse repo não define `identifier`, então a AWS
gera um nome aleatório, impossibilitando localizar a instância via
`data "aws_db_instance"`. Uma mudança de uma linha é necessária lá antes do
deploy — ver `REQUEST-TO-DATABASE-REPO.md` na raiz deste repositório, que
deve ser repassado para quem mantém aquele repositório.

## Arquitetura

```
Client
  │  POST /login  { "identifier": "<cpf ou email>", "password": "..." }
  ▼
API Gateway (HTTP API, aws_apigatewayv2_api)
  │  proxy integration
  ▼
Lambda (nodejs24.x, dentro da VPC "main", subnets sub_a/sub_b)
  │  1. Busca db_password e jwt_secret no Secrets Manager
  │  2. Detecta se "identifier" é CPF (11 dígitos) ou email
  │  3. SELECT id, password FROM users WHERE document = ? / email = ?
  │  4. bcryptjs.compare(password, hash)
  │  5. Gera JWT (HS256) compatível com php-open-source-saver/jwt-auth
  ▼
RDS MySQL (repo tech-challenge-database)
```

### Rede

- Lambda roda na mesma VPC do RDS (`data "aws_vpc" "main"` por tag,
  replicando o padrão do repo do banco).
- Subnets: `data "aws_subnet" "sub_a"` / `"sub_b"` (mesmas tags).
- Security Group próprio da Lambda (`aws_security_group.lambda`), egress
  liberado para a porta 3306 do SG `data.aws_security_group.rds` (mesma
  tag `rds` usada no outro repo). Não é necessário alterar o SG do RDS:
  ele já teria que aceitar tráfego da própria VPC/SG da app; caso o SG
  `rds` só libere ingress de um SG específico (ex.: o dos nodes EKS da
  aplicação), será necessário adicionar uma regra de ingress nova
  apontando para o SG desta Lambda — **isso é uma alteração no repo
  `tech-challenge-database` e deve ser validado antes do deploy**.

### Segredos (AWS Secrets Manager)

Um secret `tech-challenge/auth-lambda` (JSON) com:

```json
{
  "db_password": "...",
  "jwt_secret": "..."
}
```

- `db_password` deve ser **idêntica** à senha configurada no
  `aws_db_instance.rds` do repo `tech-challenge-database`
  (`var.db_password` lá).
- `jwt_secret` deve ser **idêntica** ao `JWT_SECRET` do `.env` da
  aplicação Laravel em produção (gerado via `php artisan jwt:secret`).
  Não existe forma de descobrir esse valor via código-fonte — é um dado
  operacional que precisa ser copiado manualmente ao aplicar este
  Terraform (`terraform apply -var jwt_secret=... -var db_password=...`
  ou via `.tfvars` não versionado).

O secret é criado por este repositório (`aws_secretsmanager_secret` +
`aws_secretsmanager_secret_version`), populado a partir de variáveis
Terraform marcadas `sensitive = true`. O Lambda recebe apenas o nome/ARN
do secret via variável de ambiente e busca o valor em runtime
(`@aws-sdk/client-secrets-manager`), sem cachear entre invocações frias
de forma insegura (cache em memória do runtime é aceitável entre
invocações quentes).

### Lambda (Node.js 24)

- Runtime: `nodejs24.x` (GA, sem previsão de deprecação — confirmado na
  documentação da AWS em 2026-08).
- Empacotamento: `data.archive_file` zipando o diretório `src/`, sem
  pipeline externo.
- Dependências: `mysql2` (conexão MySQL), `bcryptjs` (compatível com
  hashes `$2y$` do Laravel, pure-JS — evita problemas de build nativo no
  zip), `jsonwebtoken` (assinatura HS256).
- Timeout: 10s. Memória: 256MB (ajustável).
- IAM role: permissão mínima para `secretsmanager:GetSecretValue` no
  secret específico, além das managed policies básicas de execução em
  VPC (`AWSLambdaVPCAccessExecutionRole`).

### Fluxo de autenticação (`src/index.js`)

1. Parse do body: `{ identifier: string, password: string }`. Se
   ausente/mal formado → 400.
2. Normaliza `identifier`: remove tudo que não é dígito. Se o resultado
   tiver 11 dígitos, trata como CPF e consulta `document = ?` com esse
   valor normalizado (mesma normalização usada pela aplicação Laravel,
   que grava `document` sem pontuação). Caso contrário, trata a string
   original como e-mail e consulta `email = ?`.
3. Query: `SELECT id, password FROM users WHERE document = ? LIMIT 1`
   ou `SELECT id, password FROM users WHERE email = ? LIMIT 1`.
4. Se não encontrar linha, ou `bcryptjs.compareSync(password, hash)`
   falhar → `401 { "message": "Credenciais inválidas" }` (mensagem igual
   à do `AuthController` do Laravel, sem distinguir usuário inexistente
   de senha errada).
5. Se autenticado, monta o payload JWT:
   - `sub`: `id` do usuário (inteiro)
   - `iat`: timestamp atual (segundos)
   - `nbf`: timestamp atual
   - `exp`: `iat + 3600` (TTL de 60 min, igual ao default do pacote)
   - `jti`: string aleatória (ex.: `crypto.randomUUID()`)
   - `iss`: URL da rota de login (constante ou derivada do event do API
     Gateway)
   - `prv`: `sha1('App\\Models\\User')` (claim de lock_subject; opcional
     mas incluída para fidelidade total)
   - `user_id`: mesmo valor de `sub` (custom claim que o `User` model do
     Laravel adiciona)
   - Assinado com `jsonwebtoken.sign(payload, jwtSecret, { algorithm: 'HS256', noTimestamp: true })`
     (`noTimestamp: true` porque `iat` já está no payload manualmente,
     evitando que a lib sobrescreva).
6. Resposta `200 { "access_token": "<jwt>", "token_type": "bearer" }`.

### Erros

- Erro de conexão com o banco (timeout, credencial errada) → `500`,
  log estruturado no CloudWatch, sem detalhes sensíveis na resposta.
- Erro de validação do body → `400 { "message": "..." }`.

## Estrutura de arquivos deste repositório

```
providers.tf    # aws provider (>= mesma major do outro repo), backend local
data.tf         # data sources: vpc "main", subnets sub_a/sub_b, sg "rds"
secrets.tf      # aws_secretsmanager_secret + version (db_password, jwt_secret)
lambda.tf       # security group da lambda, iam role/policy, archive_file, aws_lambda_function
apigateway.tf   # aws_apigatewayv2_api (HTTP API), integration, route POST /login, stage, lambda permission
variables.tf    # aws_region, db_name, db_user, db_password (sensitive), jwt_secret (sensitive)
outputs.tf      # invoke_url da API
src/
  index.js      # handler
  package.json  # mysql2, bcryptjs, jsonwebtoken, @aws-sdk/client-secrets-manager
REQUEST-TO-DATABASE-REPO.md  # instrução para adicionar `identifier` fixo no aws_db_instance do outro repo
```

## Fora de escopo

- Rodar as migrations do Laravel contra a RDS (pré-requisito
  operacional, não faz parte deste Terraform).
- Corrigir o `infra/terraform.tfstate` versionado encontrado na branch
  `terraform` de `tech-challenge-application` (risco de segurança
  separado, fora do escopo desta tarefa — deve ser tratado por quem
  mantém aquele repositório).
- Endpoints de `register`, `refresh`, `logout`, `me` — apenas `login` é
  implementado neste Lambda.
- Rotacionar/gerenciar o `jwt_secret` (assume-se o mesmo valor já em uso
  pela aplicação Laravel, fornecido manualmente).

## Testes

- Testes unitários do handler (`src/index.test.js` ou similar) mockando
  `mysql2` e o cliente do Secrets Manager, cobrindo: login por email
  válido, login por CPF válido (com e sem pontuação na entrada), senha
  incorreta, usuário inexistente, body inválido.
- Validação manual pós-deploy: comparar um JWT emitido por este Lambda
  com um emitido pelo `AuthController::login()` do Laravel para o mesmo
  usuário (mesma estrutura de claims, exceto `iat`/`exp`/`jti`), e
  confirmar que uma rota protegida (`auth:api`) do Laravel aceita o
  token do Lambda.
