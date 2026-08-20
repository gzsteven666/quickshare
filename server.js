require('dotenv').config();

const app = require('./app');
const config = require('./config');
const { initDatabase } = require('./models/db');

const port = Number(process.env.PORT || config.port);

initDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`服务器运行在 http://localhost:${port}`);
      console.log(`当前环境: ${process.env.NODE_ENV || 'development'}`);
      console.log(`日志级别: ${config.logLevel}`);
    });
  })
  .catch((error) => {
    console.error('数据库初始化失败:', error);
    process.exitCode = 1;
  });
