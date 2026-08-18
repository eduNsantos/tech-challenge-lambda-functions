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
src/                         # código do Lambda (Node.js 24) + package.json
src/test/                    # testes unitários (node:test), excluídos do zip de deploy
```
