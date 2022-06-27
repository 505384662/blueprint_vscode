/**
 * @function is
 * @param {string} type
 * @param {val}
 */

"use strict";

const typeHits = require("./type/type_hits");

/** @lends is */
function is(type, val) {
  if (arguments.length !== 2) {
    throw new Error("Invalid arguments");
  }
  return typeHits(val, type);
}

module.exports = is;
