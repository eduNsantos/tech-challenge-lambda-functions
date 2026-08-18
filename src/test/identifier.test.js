const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIdentifier } = require('../identifier');

test('classifies an 11-digit CPF as document', () => {
  const result = classifyIdentifier('12345678901');
  assert.deepEqual(result, { field: 'document', value: '12345678901' });
});

test('classifies a formatted CPF as document, stripping punctuation', () => {
  const result = classifyIdentifier('123.456.789-01');
  assert.deepEqual(result, { field: 'document', value: '12345678901' });
});

test('classifies an email as email, unchanged', () => {
  const result = classifyIdentifier('user@example.com');
  assert.deepEqual(result, { field: 'email', value: 'user@example.com' });
});

test('classifies a non-11-digit numeric-looking string as email', () => {
  const result = classifyIdentifier('123456');
  assert.deepEqual(result, { field: 'email', value: '123456' });
});
