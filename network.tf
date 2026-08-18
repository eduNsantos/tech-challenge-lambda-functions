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
  description                  = "MySQL para o RDS do tech-challenge-database"
  from_port                    = 3306
  to_port                      = 3306
  ip_protocol                  = "tcp"
  referenced_security_group_id = data.aws_security_group.rds.id
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_secretsmanager_endpoint" {
  security_group_id            = aws_security_group.lambda.id
  description                  = "HTTPS para o VPC endpoint do Secrets Manager"
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.secretsmanager_endpoint.id
}

resource "aws_vpc_security_group_ingress_rule" "secretsmanager_endpoint_from_lambda" {
  security_group_id            = aws_security_group.secretsmanager_endpoint.id
  description                  = "HTTPS do Lambda de autenticacao"
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.lambda.id
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
