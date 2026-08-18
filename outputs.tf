output "invoke_url" {
  description = "URL base da API de autenticacao"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "login_url" {
  description = "URL completa do endpoint de login"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}login"
}
