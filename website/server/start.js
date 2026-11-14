'use strict';
// Cloud entry point: restore the saved database first, then start the website.
const path = require('path');
const HF = require('./hfsync');
(async () => {
  const file = path.resolve(__dirname, '..', process.env.PDA_DB || 'data/production.db');
  await HF.restore(file);
  require('./index');
})();
