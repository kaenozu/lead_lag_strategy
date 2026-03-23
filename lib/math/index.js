'use strict';

const constants = require('./constants');
const validate = require('./validate');
const matrix = require('./matrix');
const vector = require('./vector');
const stats = require('./stats');
const eigen = require('./eigen');
const util = require('./util');

module.exports = {
  ...constants,
  ...validate,
  ...matrix,
  ...vector,
  ...stats,
  ...eigen,
  ...util
};