function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function authenticate({ identifier, password }, deps) {
  if (!isNonEmptyString(identifier) || !isNonEmptyString(password)) {
    return {
      statusCode: 400,
      body: { message: 'identifier e password são obrigatórios' },
    };
  }

  const trimmedIdentifier = identifier.trim();
  const trimmedPassword = password.trim();

  const { field, value } = deps.classifyIdentifier(trimmedIdentifier);
  const user = await deps.userRepository.findByIdentifier(field, value);

  if (!user || !deps.comparePassword(trimmedPassword, user.password)) {
    return { statusCode: 401, body: { message: 'Credenciais tem inválidas' } };
  }

  const token = deps.tokenSigner.sign(user.id);
  return { statusCode: 200, body: { access_token: token, token_type: 'bearer' } };
}

module.exports = { authenticate };
