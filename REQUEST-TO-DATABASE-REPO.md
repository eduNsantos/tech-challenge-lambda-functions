# Pedido de alteração — repositório `tech-challenge-database`

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

O Lambda de autenticação vai rodar na mesma VPC (`data.aws_vpc` filtrada
pela tag `Name = "main"`) e vai precisar alcançar a porta 3306 da RDS.
Se o Security Group `rds` (tag `Name = "rds"`) só libera ingress de
origens específicas (em vez de todo o CIDR da VPC), será necessário
adicionar uma regra de ingress permitindo o Security Group que a Lambda
vai usar. Avisaremos o ID/nome desse SG assim que este repositório for
aplicado pela primeira vez — pode ser necessário um ajuste de ingress
aqui depois disso.

## Senha do banco

O Lambda vai precisar da mesma senha configurada em `var.db_password`
para autenticar no MySQL (vamos guardá-la em um AWS Secrets Manager
próprio deste outro repo, fornecida manualmente — não fica hardcoded em
nenhum dos dois repositórios).
