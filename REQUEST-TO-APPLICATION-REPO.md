# Pedido de alteração — repositório `tech-challenge-application`

Este repositório (`tech-challenge-lambda-functions`) implementa um login
serverless (CPF ou e-mail + senha) contra a RDS do `tech-challenge-database`,
emitindo JWTs compatíveis com o `php-open-source-saver/jwt-auth` já usado
pela aplicação Laravel. Para essa integração funcionar de ponta a ponta,
algumas coisas precisam ser ajustadas neste repositório.

## 1. Apontar a aplicação para a RDS do `tech-challenge-database`

Hoje a aplicação usa bancos MySQL diferentes dependendo do ambiente:

- Local/dev: MySQL do `docker-compose.yml` (`DB_HOST=db`).
- K8s (`infra/mysql.tf`): MySQL rodando dentro do próprio cluster.
- Branch `terraform`: uma instância RDS **própria**, criada junto com
  VPC/EKS (`infra/main.tf`, `aws_db_instance.mysql`) — diferente da RDS
  do repositório `tech-challenge-database`.

Nenhum desses é a RDS que o Lambda de autenticação vai consultar. Para o
Lambda e a aplicação Laravel enxergarem os mesmos usuários, é preciso:

1. Definir `DB_HOST` (endpoint), `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`
   e `DB_PASSWORD` do ambiente relevante (produção/homologação) apontando
   para a instância criada em `tech-challenge-database`.
2. Rodar `php artisan migrate` (ou o pipeline de deploy equivalente)
   contra essa RDS, para que a tabela `users` (e as demais) existam lá —
   hoje elas só existem nos bancos locais/k8s/RDS própria descritos acima.

Sem isso, o Lambda vai tentar consultar uma tabela `users` que não existe
na RDS de `tech-challenge-database`.

## 2. Definir um `JWT_SECRET` real e compartilhá-lo

O `.env.example` traz `JWT_SECRET=` em branco (gerado via
`php artisan jwt:secret` em cada ambiente). O Lambda de autenticação
precisa assinar tokens com o **mesmo** valor de `JWT_SECRET` usado pela
aplicação Laravel no ambiente de produção/homologação, senão os tokens
emitidos por um lado não são aceitos pelo outro (middleware `auth:api`
via `Tymon`/`php-open-source-saver` JWT Guard).

Ação: depois de gerar/definir o `JWT_SECRET` real do ambiente, esse valor
precisa ser informado (por canal seguro, não por commit) para ser
cadastrado no AWS Secrets Manager usado pelo `tech-challenge-lambda-functions`.

## 3. Remover `infra/terraform.tfstate` do controle de versão

Na branch `terraform`, o arquivo `infra/terraform.tfstate` está commitado
no Git. Arquivos de state do Terraform costumam conter valores sensíveis
em texto plano (senhas, chaves, outputs sensíveis) mesmo quando as
variáveis de origem são `sensitive = true`. Isso é um risco de segurança
independente da integração com o Lambda.

Ação recomendada:
- `git rm --cached infra/terraform.tfstate` e adicionar `*.tfstate` ao
  `.gitignore`.
- Migrar para um backend remoto (S3 + DynamoDB, por exemplo) em vez de
  state local versionado.
- Considerar rotacionar qualquer credencial que possa ter sido exposta
  nesse arquivo ao longo do histórico do repositório.

## 4. (Opcional) Suporte a login por CPF no `AuthController`

Hoje `AuthController::login()` só aceita `email` + `password`:

```php
public function login()
{
    $credentials = request(['email', 'password']);
    ...
}
```

Para manter paridade entre o login da aplicação Laravel e o do Lambda
(que aceita CPF **ou** e-mail), considerar aceitar também `document`
como identificador ali, usando a mesma normalização (somente dígitos)
já implementada em `App\Domain\Customer\ValueObjects\Document`. Isso não
é bloqueante para a integração — o Lambda funciona de forma independente
— mas evita uma inconsistência de UX entre os dois pontos de entrada.
