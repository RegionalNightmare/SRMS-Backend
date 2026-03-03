require('dotenv').config();

const dbConnection = {
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
};

module.exports = {
  development: {
    client: 'mysql2',
    connection: dbConnection,
    migrations: { directory: './migrations' },
    seeds: { directory: './seeds' },
  },
  production: {
    client: 'mysql2',
    connection: dbConnection,
    migrations: { directory: './migrations' },
    seeds: { directory: './seeds' },
  }
};
