'use strict';

const fetch = require('./fetch');
const returns = require('./returns');
const alignment = require('./alignment');
const csv = require('./csv');
const matrix = require('./matrix');
const imputation = require('./imputation');
const calendar = require('./calendar');

module.exports = {
  ...fetch,
  ...returns,
  ...alignment,
  ...csv,
  ...matrix,
  ...imputation,
  ...calendar
};
