"use strict";

// host/node.js — minimal Node host for the self-hosting compiler.
//
// This is deliberately narrower than the eventual Node platform host. It owns
// only the manifest-backed Node floor required to load source, write artifacts,
// inspect argv/environment, read stdin, and terminate with an exit status.
//
// HTTP, database adapters, browser facilities, and general foreign interop are
// intentionally deferred. They are not needed to compile the compiler with
// itself.

(function attachPfunNode(root, factory) {
  const nodeRequire =
    typeof require === "function" ? require : null;
  const core =
    root.PfunCore ||
    (nodeRequire ? nodeRequire("./core.js") : null);

  if (!core) {
    throw new Error(
      "host/node.js requires PfunCore. Load host/core.js first."
    );
  }

  const api = factory(core, nodeRequire);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.PfunNode = api;
  root.PfunBuiltins = api.$builtins;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildPfunNode(core, nodeRequire) {
    if (!nodeRequire) {
      throw new Error("host/node.js requires the Node CommonJS loader.");
    }

    const fs = nodeRequire("node:fs");
	const os = nodeRequire("node:os");
	const nodePath = nodeRequire("node:path");
	const childProcess = nodeRequire("node:child_process");

    function own(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    }

    function errorMessage(error) {
      if (error instanceof Error) {
        if (typeof error.code === "string" && error.code.length > 0) {
          return error.code + ": " + error.message;
        }
        return error.message;
      }
      return String(error);
    }

    function intToNumber(value, what) {
      const canonical = core.$canonI(value);
      const number = Number(canonical);
      if (!Number.isSafeInteger(number)) {
        throw new Error(what + " is outside the Node safe integer range.");
      }
      return number;
    }

    function pathText(value, what) {
      if (typeof value !== "string") {
        throw new Error(what + " must be a Str.");
      }
      return value;
    }

    function resultOf(thunk) {
      try {
        return core.$ok(thunk());
      } catch (error) {
        return core.$err(errorMessage(error));
      }
    }

    
	function nodeArgs(values) {
		if (!Array.isArray(values)) {
			throw new Error("runNodeBundle arguments must be a List<Str>.");
		}
		return values.map(function nodeArg(value) {
			return pathText(value, "runNodeBundle argument");
		});
	}

	function $runNodeBundle(source, args) {
		source = pathText(source, "runNodeBundle source");
		const childArgs = nodeArgs(args);

		return resultOf(function executeNodeBundle() {
			const tempDir = fs.mkdtempSync(
				nodePath.join(os.tmpdir(), "pfun-run-")
			);
			const scriptPath = nodePath.join(tempDir, "main.js");

			try {
				fs.writeFileSync(scriptPath, source, "utf8");
				const child = childProcess.spawnSync(
					process.execPath,
					[scriptPath, ...childArgs],
					{
						cwd: process.cwd(),
						env: process.env,
						stdio: "inherit"
					}
				);

				if (child.error) {
					throw child.error;
				}
				if (typeof child.status === "number") {
					return core.$canonI(child.status);
				}
				if (child.signal) {
					throw new Error(
						"Node child terminated by signal " + child.signal + "."
					);
				}
				throw new Error("Node child did not report an exit status.");
			} finally {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});
	}
// ── stdin / process ──────────────────────────────────────────────────

    	function $eprint(value) {
		process.stderr.write(core.$str(value));
		return null;
	}

	function $eprintln(value) {
		process.stderr.write(core.$str(value) + "\n");
		return null;
	}

	let stdinText = null;
    let stdinOffset = 0;

    function ensureStdin() {
      if (stdinText === null) {
        stdinText = fs.readFileSync(0, "utf8");
      }
      return stdinText;
    }

    function $scanln() {
      const text = ensureStdin();
      if (stdinOffset >= text.length) {
        return core.$none();
      }

      const newline = text.indexOf("\n", stdinOffset);
      const end = newline < 0 ? text.length : newline;
      let line = text.slice(stdinOffset, end);

      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      stdinOffset = newline < 0 ? text.length : newline + 1;
      return core.$some(line);
    }

    function $scanChar() {
      const text = ensureStdin();
      if (stdinOffset >= text.length) {
        return core.$none();
      }

      const codePoint = text.codePointAt(stdinOffset);
      const value = String.fromCodePoint(codePoint);
      stdinOffset += value.length;
      return core.$some(value);
    }

    function $scriptArgs() {
      return process.argv.slice(2);
    }

    function $getEnv(name) {
      name = pathText(name, "environment variable name");
      if (!own(process.env, name) || process.env[name] === undefined) {
        return core.$none();
      }
      return core.$some(String(process.env[name]));
    }

    function $exit(code) {
      process.exit(intToNumber(code, "exit code"));
    }

    // ── filesystem ───────────────────────────────────────────────────────

    function $readFile(path) {
      path = pathText(path, "readFile path");
      return resultOf(function readText() {
        return fs.readFileSync(path, "utf8");
      });
    }

    function $writeFile(path, content) {
      path = pathText(path, "writeFile path");
      if (typeof content !== "string") {
        throw new Error("writeFile content must be a Str.");
      }

      return resultOf(function writeText() {
        fs.writeFileSync(path, content, "utf8");
                return null;
      });
    }

    function $fileExists(path) {
      path = pathText(path, "fileExists path");
      try {
        return fs.existsSync(path);
      } catch (_error) {
        return false;
      }
    }

    function $mkdirP(path) {
      path = pathText(path, "mkdirP path");
      return resultOf(function makeDirectory() {
        fs.mkdirSync(path, { recursive: true });
        return null;
      });
    }

    function fileModeName(mode) {
      if (mode && typeof mode.$t === "string") {
        return mode.$t;
      }
      if (typeof mode === "string") {
        return mode;
      }
      throw new Error("fileOpen mode must be Read, Write, or Append.");
    }

    function openFlags(modeName) {
      if (modeName === "Read") return "r";
      if (modeName === "Write") return "w";
      if (modeName === "Append") return "a";
      throw new Error("unknown file mode: " + modeName);
    }

    function $fileOpen(path, mode) {
      path = pathText(path, "fileOpen path");
      return resultOf(function openFile() {
        const modeName = fileModeName(mode);
        return {
          $file: true,
          fd: fs.openSync(path, openFlags(modeName)),
          mode: modeName,
          closed: false
        };
      });
    }

    function $fileClose(handle) {
      return resultOf(function closeFile() {
        if (
          !handle ||
          handle.$file !== true ||
          !Number.isInteger(handle.fd)
        ) {
          throw new Error("fileClose expects a FileHandle.");
        }
        if (handle.closed) {
          throw new Error("file handle is already closed.");
        }

        fs.closeSync(handle.fd);
        handle.closed = true;
        return null;
      });
    }

    // ── builtin module registry ──────────────────────────────────────────

    const coreModule = Object.freeze({
      __str__: core.$str,
      str: core.$str,
      length: core.$length,
      reverse: core.$reverse,
      cons: core.$cons,
      nth: core.$nth,
      nthU: core.$nthU,
      slice: core.$slice,
      take: core.$take,
      range: core.$range,
      find: core.$find,
      findSlice: core.$findSlice,
      map: core.$map,
      filter: core.$filter,
      reduce: core.$reduce,
      split: core.$split,
      join: core.$join,
      asc: core.$asc,
      chr: core.$chr,
      chrU: core.$chrU,
      charBytes: core.$charBytes,
      bytesToChar: core.$bytesToChar,
      floor: core.$floor,
      ceil: core.$ceil,
      round: core.$round,
      isNaN: core.$isNaN,
      isFinite: core.$isFinite,
      nonZero: core.$nonZero,
      safeDiv: core.$safeDiv,
      safeMod: core.$safeMod
    });

    const ioModule = Object.freeze({
      print: core.$print,
      println: core.$println,
      eprint: $eprint,
      eprintln: $eprintln,
      flushStdout: core.$flushStdout,
      scanln: $scanln,
      scanChar: $scanChar,
      scriptArgs: $scriptArgs,
      getEnv: $getEnv,
      exit: $exit,
		runNodeBundle: $runNodeBundle
    });

    const fileModule = Object.freeze({
      readFile: $readFile,
      writeFile: $writeFile,
      fileExists: $fileExists,
      mkdirP: $mkdirP,
      fileOpen: $fileOpen,
      fileClose: $fileClose
    });

    const jsonModule = Object.freeze({
      jsonSerialize: core.$jsonSerialize,
      jsonDeserialize: core.$jsonDeserialize
    ,
      jsonDeserializeAs: core.$jsonDeserialize});

    const asyncModule = Object.freeze({
      sleep: core.$sleep
    });

    const mathModule = Object.freeze({
      pi: core.$pi,
      e: core.$e,
      tau: core.$tau,
      sqrt: core.$sqrt,
      pow: core.$pow,
      abs: core.$absInt,
      min: core.$minInt,
      max: core.$maxInt
    });

    const $builtins = Object.freeze({
      "$builtin/core": coreModule,
      core: coreModule,
      io: ioModule,
      file: fileModule,
      json: jsonModule,
      async: asyncModule,
      math: mathModule
    });

    return Object.freeze({
		$eprint,
		$eprintln,
      $scanln,
      $scanChar,
      $scriptArgs,
      $getEnv,
      $exit,
      $readFile,
      $writeFile,
      $fileExists,
      $mkdirP,
      $fileOpen,
      $fileClose,
      $builtins,
		$runNodeBundle,
    });
  }
);
