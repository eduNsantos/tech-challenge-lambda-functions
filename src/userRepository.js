const QUERIES = {
  document: 'SELECT id, password FROM users WHERE document = ? LIMIT 1',
  email: 'SELECT id, password FROM users WHERE email = ? LIMIT 1',
};

function createUserRepository(pool) {
  return {
    async findByIdentifier(field, value) {
      const sql = QUERIES[field];
      if (!sql) {
        throw new Error(`Unsupported identifier field: ${field}`);
      }

      const [rows] = await pool.execute(sql, [value]);
      return rows[0] ?? null;
    },
  };
}

module.exports = { createUserRepository };
