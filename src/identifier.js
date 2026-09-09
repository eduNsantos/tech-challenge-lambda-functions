function classifyIdentifier(rawIdentifier) {
  if (rawIdentifier.includes('@')) {
    return { field: 'email', value: rawIdentifier };
  }

  const digitsOnly = rawIdentifier.replace(/\D/g, '');

  if (digitsOnly.length === 11) {
    return { field: 'document', value: digitsOnly };
  }

  return { field: 'email', value: rawIdentifier };
}

module.exports = { classifyIdentifier };
