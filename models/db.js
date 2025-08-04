const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// --- 代码修改开始 ---
// 原来的代码试图在项目的 'db' 文件夹中创建数据库文件。
// 在 Vercel 的只读文件系统中，这是不允许的，并导致了程序崩溃。
// 我们将数据库文件路径修改为 Vercel 唯一允许写入的临时目录 '/tmp'。
// 注意：'/tmp' 目录中的文件是临时的，服务重启后会丢失。
// const dbPath = path.join(__dirname, '../db/html-go.db');
const dbPath = path.join('/tmp', 'html-go.db');

// 确保数据库目录存在
const dbDir = path.dirname(dbPath);
// 我们不再需要检查和创建目录，因为 Vercel 的 '/tmp' 目录总是存在的。
// 下面的代码块是导致崩溃的根源，我们将其完全注释掉。
/*
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
*/
// --- 代码修改结束 ---


// 创建数据库连接
const db = new sqlite3.Database(dbPath);

// 初始化数据库
function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 创建页面表
      db.run(`
        CREATE TABLE IF NOT EXISTS pages (
          id TEXT PRIMARY KEY,
          html_content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          password TEXT,
          is_protected INTEGER DEFAULT 0,
          code_type TEXT DEFAULT 'html'
        )
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('数据库初始化成功 (在 /tmp 目录中)');
          resolve();
        }
      });
    });
  });
}

// 执行查询的辅助函数
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// 执行单行查询的辅助函数
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// 执行更新的辅助函数
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
}

module.exports = {
  db,
  initDatabase,
  query,
  get,
  run
};
