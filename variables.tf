variable "aws_region" {
  description = "Região da AWS onde os recursos serão criados"
  type        = string
  default     = "us-east-1"
}

variable "db_identifier" {
  description = "Identifier fixo da instância RDS no repositório tech-challenge-database"
  type        = string
  default     = "techchallenge-rds"
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
