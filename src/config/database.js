const { Sequelize } = require('sequelize');
const config = require('../config');

const sequelize = new Sequelize(
  config.database.name,
  config.database.user,
  config.database.password,
  {
    host: config.database.host,
    port: config.database.port,
    dialect: 'mysql',
    pool: {
      max: 50,
      min: 5,
      acquire: 60000,
      idle: 10000,
    },
    logging: config.env === 'development' ? console.log : false,
    timezone: '+08:00',
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
    },
  }
);

module.exports = sequelize;
