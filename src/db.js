const mysql = require('mysql2/promise');

function createPool({ host, port, user, password, database }) {
  return mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    connectionLimit: 2,
  });
}

module.exports = { createPool };
