resource "null_resource" "auth_lambda_deps" {
  triggers = {
    package_lock = filemd5("${path.module}/src/package-lock.json")
    package_json = filemd5("${path.module}/src/package.json")
  }

  provisioner "local-exec" {
    command     = "cd ${path.module}/src && npm ci --no-fund --no-audit"
    interpreter = ["bash", "-c"]
  }
}

data "archive_file" "auth_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/src"
  output_path = "${path.module}/build/auth-lambda.zip"
  excludes    = ["test"]

  depends_on = [null_resource.auth_lambda_deps]
}

# AWS Academy não permite iam:CreateRole; usa a LabRole pré-existente
# (mesmo padrão do tech-challenge-payment-service).
data "aws_iam_role" "lab_role" {
  name = "LabRole"
}

resource "aws_lambda_function" "auth" {
  function_name    = "tech-challenge-auth-login"
  role             = data.aws_iam_role.lab_role.arn
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
}
