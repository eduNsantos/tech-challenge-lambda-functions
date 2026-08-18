# Pedido de alteração — repositório `tech-challenge-database`

## Status (2026-08-18)

- ✅ **`identifier` fixo**: implementado na branch `development`, PR
  ["Add fixed RDS identifier and default MySQL ingress rule"](https://github.com/eduNsantos/tech-challenge-database/pull/1)
  aberto. `identifier = "tech-challenge-db"` bate exatamente com o que
  este repositório espera (`var.db_identifier` em `variables.tf`).
- ✅ **Ingress do Security Group `rds`**: o mesmo PR adiciona uma regra
  de ingress liberando a porta 3306 para todo o CIDR da VPC, como
  default temporário, até sabermos o Security Group específico do
  Lambda. Suficiente por enquanto — pode ser restringido depois (ver
  seção abaixo).
- ⚠️ **DNS da VPC**: a seção original abaixo atribuía essa
  responsabilidade a este repositório por engano — corrigido mais
  abaixo. Provavelmente não exige nenhuma ação (ver nota).
- ⏳ Falta: mergear/aplicar o PR acima para a RDS existir de fato com o
  identifier fixo.

---

Este repositório (`tech-challenge-lambda-functions`) precisa localizar a
instância RDS criada por vocês via Terraform (`data source`), para que o
Lambda de autenticação consiga descobrir o endpoint de conexão sem
depender de remote state (que hoje não existe — o state desse repo é
local, sem backend S3 configurado).

## O que muda

Hoje, `rds.tf` cria a instância assim:

```hcl
resource "aws_db_instance" "rds" {
  allocated_storage       = 10
  db_name                 = var.db_name
  engine                  = "mysql"
  engine_version          = "8.0.46"
  instance_class          = "db.t3.micro"
  username                = var.db_user
  password                = var.db_password
  parameter_group_name    = "default.mysql8.0"
  skip_final_snapshot     = true
  publicly_accessible     = false
  vpc_security_group_ids = [data.aws_security_group.rds.id]

  db_subnet_group_name = aws_db_subnet_group.default.name
}
```

Como não há `identifier` fixo, a AWS gera um nome aleatório para a
instância a cada criação, o que impede localizá-la de fora por um nome
previsível.

**Pedido:** adicionar a linha `identifier` com um valor fixo:

```hcl
resource "aws_db_instance" "rds" {
  identifier              = "tech-challenge-db"
  allocated_storage       = 10
  db_name                 = var.db_name
  engine                  = "mysql"
  engine_version          = "8.0.46"
  instance_class          = "db.t3.micro"
  username                = var.db_user
  password                = var.db_password
  parameter_group_name    = "default.mysql8.0"
  skip_final_snapshot     = true
  publicly_accessible     = false
  vpc_security_group_ids = [data.aws_security_group.rds.id]

  db_subnet_group_name = aws_db_subnet_group.default.name
}
```

> Atenção: alterar `identifier` em uma instância RDS já existente força
> a recriação do recurso (Terraform vai destruir e recriar a instância).
> Se essa RDS já tem dados importantes, planeje uma janela/backup antes
> de aplicar, ou aplique isso só em uma instância nova/ainda não usada
> em produção.

Com isso, o repositório `tech-challenge-lambda-functions` conseguirá usar:

```hcl
data "aws_db_instance" "main" {
  db_instance_identifier = "tech-challenge-db"
}
```

para obter `endpoint`, `address` e `port` sem precisar de remote state
nem de outputs adicionais.

## Segurança do Security Group

**Resolvido por enquanto** — o PR já citado no Status abre a porta 3306
para todo o CIDR da VPC como default temporário, então a conectividade
do Lambda com a RDS já está coberta.

Quando o Lambda de `tech-challenge-lambda-functions` for aplicado pela
primeira vez e tivermos o ID do Security Group dele, pode valer a pena
restringir essa regra para admitir só esse SG específico, em vez do CIDR
inteiro da VPC — mais por princípio de menor privilégio do que por
necessidade funcional imediata. Não é bloqueante.

## DNS da VPC — correção

**Isto foi documentado errado na primeira versão deste pedido.** A VPC
`main` não é criada por este repositório — `data.tf` aqui também só a
referencia via `data source` (`data "aws_vpc" "main"` filtrando por tag),
exatamente como `tech-challenge-lambda-functions` faz. Ou seja,
**nenhum dos dois repositórios é dono da VPC** para poder habilitar
`enableDnsSupport`/`enableDnsHostnames` nela via Terraform.

Essa VPC provavelmente já existe fora de qualquer um desses repositórios
(criada manualmente no Console da AWS, ou por infraestrutura
compartilhada da conta/curso). Vale a pena checar diretamente no Console
(VPC → a VPC com tag `Name = "main"` → "Edit VPC settings") se os dois
atributos já estão habilitados — a maioria das VPCs (inclusive a VPC
default de qualquer conta AWS) já vem com isso ligado por padrão, então é
provável que nenhuma ação seja necessária aqui.

## Senha do banco

O Lambda vai precisar da mesma senha configurada em `var.db_password`
para autenticar no MySQL (vamos guardá-la em um AWS Secrets Manager
próprio deste outro repo, fornecida manualmente — não fica hardcoded em
nenhum dos dois repositórios).
