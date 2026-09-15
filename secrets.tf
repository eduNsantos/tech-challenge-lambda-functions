resource "aws_secretsmanager_secret" "auth_lambda" {
  name                    = "tech-challenge/auth-lambda"
  description             = "Credenciais usadas pelo Lambda de autenticacao (db_password, jwt_secret)"
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "auth_lambda" {
  secret_id = aws_secretsmanager_secret.auth_lambda.id
  secret_string = jsonencode({
    db_password = var.db_password
    jwt_secret  = var.jwt_secret
  })
}
