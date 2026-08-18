# tech-challenge-lambda-functions

API de autenticação serverless (API Gateway + AWS Lambda, Node.js 24) que
permite login por **CPF ou e-mail + senha** contra o MySQL do repositório
[`tech-challenge-database`](https://github.com/eduNsantos/tech-challenge-database),
emitindo um JWT compatível com o `php-open-source-saver/jwt-auth` usado pela
aplicação [`tech-challenge-application`](https://github.com/eduNsantos/tech-challenge-application).

Design completo: [`docs/superpowers/specs/2026-08-18-auth-lambda-design.md`](docs/superpowers/specs/2026-08-18-auth-lambda-design.md).

## Pré-requisitos antes do primeiro deploy

1. **`tech-challenge-database`**: ✅ `identifier` fixo e regra de ingress
   temporária (libera 3306 para todo o CIDR da VPC) já implementados na
   branch `development`,
   [PR aberto](https://github.com/eduNsantos/tech-challenge-database/pull/1).
   Falta mergear/aplicar. Este repositório **não** gerencia o Security
   Group da RDS — ele só tem uma referência `data`, nunca um `resource`,
   exatamente para não correr o risco de reverter ou conflitar com regras
   adicionadas no outro repositório. Ver
   [`REQUEST-TO-DATABASE-REPO.md`](REQUEST-TO-DATABASE-REPO.md).
2. **`tech-challenge-application`**: precisa apontar para essa mesma RDS,
   ter rodado `php artisan migrate` nela, e ter um `JWT_SECRET` definido.
   Ver [`REQUEST-TO-APPLICATION-REPO.md`](REQUEST-TO-APPLICATION-REPO.md).
3. AWS CLI configurado com credenciais que tenham permissão para criar VPC
   endpoint, Security Group, Secrets Manager secret, IAM role, Lambda e API
   Gateway na região alvo.
4. A VPC referenciada por `data.aws_vpc.main` (tag `Name = "main"`)
   precisa ter os atributos `enableDnsSupport = true` e
   `enableDnsHostnames = true` habilitados — sem os dois, o
   `terraform apply` falha ao criar o `aws_vpc_endpoint.secretsmanager`
   (em `network.tf`) com `private_dns_enabled = true`. Essa VPC não é
   criada nem por este repositório nem por `tech-challenge-database`
   (ambos só a referenciam via `data source`) — provavelmente já existe
   assim fora de qualquer um dos dois repos. Vale conferir direto no
   Console da AWS antes do primeiro apply; a maioria das VPCs já vem com
   isso habilitado por padrão.

## Variáveis obrigatórias

| Variável | Descrição |
|---|---|
| `db_name` | Nome do banco MySQL |
| `db_user` | Usuário do MySQL |
| `db_password` | Senha do MySQL — **igual** à usada em `tech-challenge-database` |
| `jwt_secret` | Segredo de assinatura JWT — **igual** ao `JWT_SECRET` da aplicação Laravel |

Copie [`terraform.tfvars.example`](terraform.tfvars.example) para
`terraform.tfvars` (já gitignored) e preencha os valores reais — o
Terraform carrega esse arquivo automaticamente, sem precisar de `-var` em
cada comando. Nunca commite `terraform.tfvars` com valores reais.

## Aplicar

```bash
cp terraform.tfvars.example terraform.tfvars
# edite terraform.tfvars com os valores reais
cd src && npm ci && cd ..
terraform init
terraform plan
terraform apply
```

O `npm ci` (não `npm install`) instala as dependências em `src/node_modules`
exatamente como travadas em `package-lock.json`. Sem esse passo, o
`data.archive_file` empacota o Lambda sem dependências e toda invocação
falha em runtime com um erro do tipo `Cannot find module 'bcryptjs'`,
mesmo com o `terraform apply` tendo sido bem-sucedido.

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
