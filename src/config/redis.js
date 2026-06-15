const { createClient } = require('redis');
const config = require('./index');

let redisClient = null;
let redisSubscriber = null;

const getRedisClient = async () => {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  const options = {
    socket: {
      host: config.redis.host,
      port: config.redis.port,
    },
  };

  if (config.redis.password) {
    options.password = config.redis.password;
  }

  redisClient = createClient(options);
  
  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  await redisClient.connect();
  return redisClient;
};

const getRedisSubscriber = async () => {
  if (redisSubscriber && redisSubscriber.isOpen) {
    return redisSubscriber;
  }

  const options = {
    socket: {
      host: config.redis.host,
      port: config.redis.port,
    },
  };

  if (config.redis.password) {
    options.password = config.redis.password;
  }

  redisSubscriber = createClient(options);
  await redisSubscriber.connect();
  return redisSubscriber;
};

const closeRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
  }
  if (redisSubscriber) {
    await redisSubscriber.quit();
  }
};

module.exports = {
  getRedisClient,
  getRedisSubscriber,
  closeRedis,
};
