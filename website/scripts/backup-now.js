'use strict';
// Writes a database backup into the Backups folder now (works while the website is running).
const fs = require('fs');
const path = require('path');
const DB = require('../server/db');
const backup = require('../server/backup');
const config = JSON.parse(fs.readFileSync(path.join(DB.PATHS.website, 'config.json'), 'utf8'));
const db = DB.open(path.resolve(DB.PATHS.website, config.db));
console.log('Backup written: Backups/' + backup.run(db, true));
db.close();
