'use strict';
// Cloud entry point: restore the private data first (database, private translation table), then start the website.
const path = require('path');
const STORE = require('./store');
const DB = require('./db');
(async () => {
  const file = path.resolve(__dirname, '..', process.env.PDA_DB || 'data/production.db');
  await STORE.restoreDb(file);
  await STORE.fetchTo('translations-ar.json', process.env.PDA_TRANSLATIONS || path.join(DB.PATHS.data, 'translations-ar.json'));
  require('./index');
})();
