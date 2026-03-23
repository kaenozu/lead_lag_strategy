'use strict';

function fillForward(arr) {
  const result = [];
  let lastValid = null;

  for (let i = 0; i < arr.length; i++) {
    const val = arr[i];
    if (val !== null && val !== undefined && !isNaN(val)) {
      lastValid = val;
      result.push(val);
    } else if (lastValid !== null) {
      result.push(lastValid);
    } else {
      result.push(0);
    }
  }

  return result;
}

function fillBackward(arr) {
  const result = new Array(arr.length);
  let nextValid = null;

  for (let i = arr.length - 1; i >= 0; i--) {
    const val = arr[i];
    if (val !== null && val !== undefined && !isNaN(val)) {
      nextValid = val;
      result[i] = val;
    } else if (nextValid !== null) {
      result[i] = nextValid;
    } else {
      result[i] = 0;
    }
  }

  return result;
}

function fillLinear(arr) {
  if (!arr || arr.length === 0) return [];

  const result = [...arr];
  const validIndices = [];

  for (let i = 0; i < result.length; i++) {
    const val = result[i];
    if (val !== null && val !== undefined && !isNaN(val)) {
      validIndices.push(i);
    }
  }

  if (validIndices.length === 0) {
    return result.map(() => 0);
  }

  for (let v = 0; v < validIndices.length - 1; v++) {
    const startIdx = validIndices[v];
    const endIdx = validIndices[v + 1];
    const startVal = result[startIdx];
    const endVal = result[endIdx];
    const steps = endIdx - startIdx;

    if (steps > 1) {
      for (let j = 1; j < steps; j++) {
        result[startIdx + j] = startVal + (endVal - startVal) * (j / steps);
      }
    }
  }

  const firstValid = validIndices[0];
  const lastValid = validIndices[validIndices.length - 1];

  for (let i = 0; i < firstValid; i++) {
    result[i] = startVal;
  }

  for (let i = lastValid + 1; i < result.length; i++) {
    result[i] = endVal;
  }

  return result;
}

function dropNA(data, key) {
  return data.filter(row => {
    const val = row[key];
    return val !== null && val !== undefined && !isNaN(val);
  });
}

module.exports = {
  fillForward,
  fillBackward,
  fillLinear,
  dropNA
};
