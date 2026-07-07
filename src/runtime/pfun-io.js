'use strict';
// pfun-io.js — exports io names for `import { println } from "io"` or
// `import * as IO from "io"`. For `import * from "io"` the transpiler
// silently drops the import since io names are already in pfun-runtime.js.

const rt = require('./pfun-runtime');

module.exports = {
  println:    rt.$println,
  print:      rt.$println,
  flushStdout: () => {},  // stdout is unbuffered in Node; no-op
  scanChar:   () => { throw new Error('scanChar: interactive I/O not supported in compiled output.'); },
  scanln:     () => { throw new Error('scanln: interactive I/O not supported in compiled output.'); },
  // Deprecated V1 aliases for scanChar/scanln:
  readChar:   () => { throw new Error('readChar: interactive I/O not supported in compiled output.'); },
  readln:     () => { throw new Error('readln: interactive I/O not supported in compiled output.'); },
  scriptArgs: () => process.argv.slice(2),
  getEnv:     (name) => {
    const v = process.env[typeof name === 'string' ? name : String(name)];
    return v === undefined
      ? { __type: 'None', __union: 'Option' }
      : { __type: 'Some', __union: 'Option', value: v };
  },
  envVars: () => Object.entries(process.env).map(([k, v]) => ({ __type: 'Pair', key: k, value: v ?? '' })),
};
