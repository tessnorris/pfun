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
	const NodeBuffer = nodeRequire("node:buffer").Buffer;

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

    function resultOf(variant, operation, thunk) {
      try {
        return core.$ok(thunk());
      } catch (error) {
		return core.$err(
			core.$nativeError(
				variant,
				operation,
				errorMessage(error)
			)
		);
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
		return resultOf(
			"NativeProcessError",
			"runNodeBundle",
			function executeNodeBundle() {
			const checkedSource = pathText(
				source,
				"runNodeBundle source"
			);
			const childArgs = nodeArgs(args);
			const tempDir = fs.mkdtempSync(
				nodePath.join(os.tmpdir(), "pfun-run-")
			);
			const scriptPath = nodePath.join(tempDir, "main.js");

			try {
				fs.writeFileSync(scriptPath, checkedSource, "utf8");
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
			}
		);
	}
// ── stdin / process ──────────────────────────────────────────────────

    	function $eprint(value) {
		return resultOf("NativeIoError", "eprint", function writeStderr() {
			writeStderrSync(core.$str(value));
			return null;
		});
	}

	function $eprintln(value) {
		return resultOf("NativeIoError", "eprintln", function writeStderrLine() {
			writeStderrSync(core.$str(value) + "\n");
			return null;
		});
	}

	function writeStderrSync(text) {
		const bytes = NodeBuffer.from(text, "utf8");
		let offset = 0;

		while (offset < bytes.length) {
			const written = fs.writeSync(
				process.stderr.fd,
				bytes,
				offset,
				bytes.length - offset
			);
			if (!Number.isInteger(written) || written <= 0) {
				throw new Error("stderr write made no progress.");
			}
			offset += written;
		}
	}

	let stdinText = null;
	let stdinOffset = 0;

	function ensureStdin() {
		if (stdinText === null) {
			stdinText = fs.readFileSync(0, "utf8");
		}
		return stdinText;
	}

	function nextLineBreak(text, start) {
		for (let index = start; index < text.length; index += 1) {
			const code = text.charCodeAt(index);
			if (code === 0x0a || code === 0x0d) {
				return index;
			}
		}
		return -1;
	}

	function afterLineBreak(text, index) {
		if (
			text.charCodeAt(index) === 0x0d
				&& text.charCodeAt(index + 1) === 0x0a
		) {
			return index + 2;
		}
		return index + 1;
	}

	function $scanln() {
		return resultOf("NativeIoError", "scanln", function scanLine() {
			const text = ensureStdin();

			if (stdinOffset >= text.length) {
				return core.$none();
			}

			const boundary = nextLineBreak(text, stdinOffset);

			if (boundary < 0) {
				const line = text.slice(stdinOffset);
				stdinOffset = text.length;
				return core.$some(line);
			}

			const line = text.slice(stdinOffset, boundary);
			stdinOffset = afterLineBreak(text, boundary);
			return core.$some(line);
		});
	}

	function $scanChar() {
		return resultOf("NativeIoError", "scanChar", function scanCharacter() {
			const text = ensureStdin();

			if (stdinOffset >= text.length) {
				return core.$none();
			}

			const codePoint = text.codePointAt(stdinOffset);

			if (codePoint === undefined) {
				stdinOffset = text.length;
				return core.$none();
			}

			const value = String.fromCodePoint(codePoint);
			stdinOffset += value.length;
			return core.$some(value);
		});
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

	function $envVars() {
		const snapshot = core.$newDict();

		for (const name of Object.keys(process.env)) {
			const value = process.env[name];

			if (value !== undefined) {
				core.$dictSet(
					snapshot,
					String(name),
					String(value)
				);
			}
		}

		return snapshot;
	}

    function $exit(code) {
      process.exit(intToNumber(code, "exit code"));
    }

    // ── filesystem ───────────────────────────────────────────────────────

	function $readFile(path) {
		return resultOf("NativeIoError", "readFile", function readText() {
			return fs.readFileSync(
				pathText(path, "readFile path"),
				"utf8"
			);
		});
	}

	function $writeFile(path, content) {
		return resultOf("NativeIoError", "writeFile", function writeText() {
			const checkedPath = pathText(path, "writeFile path");
			if (typeof content !== "string") {
				throw new Error("writeFile content must be a Str.");
			}
			fs.writeFileSync(checkedPath, content, "utf8");
			return null;
		});
	}

	function $fileExists(path) {
		try {
			fs.accessSync(
				pathText(path, "fileExists path"),
				fs.constants.F_OK
			);
			return core.$ok(true);
		} catch (error) {
			if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
				return core.$ok(false);
			}
			return core.$err(
				core.$nativeError(
					"NativeIoError",
					"fileExists",
					errorMessage(error)
				)
			);
		}
	}

	function $mkdirP(path) {
		return resultOf("NativeIoError", "mkdirP", function makeDirectory() {
			fs.mkdirSync(
				pathText(path, "mkdirP path"),
				{ recursive: true }
			);
			return null;
		});
	}

	function $removeFile(path) {
		return resultOf("NativeIoError", "removeFile", function removePath() {
			fs.unlinkSync(pathText(path, "removeFile path"));
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

		throw new Error(
			"fileOpen mode must be Read, Write, or Append."
		);
	}

	function openFlags(modeName) {
		if (modeName === "Read") return "r";
		if (modeName === "Write") return "w";
		if (modeName === "Append") return "a";
		throw new Error("unknown file mode: " + modeName);
	}

	function requireFileHandle(handle, operation, modes) {
		if (
			!handle
				|| handle.$file !== true
				|| !Number.isInteger(handle.fd)
		) {
			throw new Error(operation + " expects a FileHandle.");
		}

		if (handle.closed) {
			throw new Error("file handle is already closed.");
		}

		if (modes && !modes.includes(handle.mode)) {
			throw new Error(
				operation
					+ " requires "
					+ modes.join(" or ")
					+ " mode."
			);
		}

		return handle;
	}

    function readOk(value) {
      return core.$makeVariant(
        "ReadOk",
        "ReadResult",
        ["value"],
        [value]
      );
    }

    function readEof() {
      return core.$makeVariant(
        "ReadEof",
        "ReadResult",
        [],
        []
      );
    }

    function readErr(operation, error) {
      return core.$makeVariant(
        "ReadErr",
        "ReadResult",
        ["message"],
		[
			core.$nativeError(
				"NativeIoError",
				operation,
				errorMessage(error)
			)
		]
      );
    }

	function readHandleByte(handle) {
		if (handle.pending.length > 0) {
			return handle.pending.shift();
		}

		const one = Buffer.allocUnsafe(1);
		const count = fs.readSync(
			handle.fd,
			one,
			0,
			1,
			null
		);

		return count === 0 ? null : one[0];
	}

	function unreadHandleByte(handle, byte) {
		handle.pending.unshift(byte);
	}

	function utf8Width(first) {
		if (first <= 0x7f) return 1;
		if (first >= 0xc2 && first <= 0xdf) return 2;
		if (first >= 0xe0 && first <= 0xef) return 3;
		if (first >= 0xf0 && first <= 0xf4) return 4;
		throw new Error("invalid UTF-8 leading byte.");
	}

	function readUtf8Char(handle) {
		const first = readHandleByte(handle);

		if (first === null) {
			return null;
		}

		const width = utf8Width(first);
		const bytes = [first];

		while (bytes.length < width) {
			const next = readHandleByte(handle);

			if (next === null) {
				throw new Error(
					"truncated UTF-8 character at end of file."
				);
			}

			if (next < 0x80 || next > 0xbf) {
				throw new Error(
					"invalid UTF-8 continuation byte."
				);
			}

			bytes.push(next);
		}

		const value = Buffer.from(bytes).toString("utf8");

		if (
			value.length === 0
				|| value.codePointAt(0) === 0xfffd
		) {
			throw new Error("invalid UTF-8 character.");
		}

		return value;
	}

	function writeHandleText(handle, text) {
		const bytes = Buffer.from(text, "utf8");
		let offset = 0;

		while (offset < bytes.length) {
			offset += fs.writeSync(
				handle.fd,
				bytes,
				offset,
				bytes.length - offset,
				null
			);
		}
	}

	function $fileOpen(path, mode) {
		return resultOf("NativeIoError", "fileOpen", function openFile() {
			const checkedPath = pathText(path, "fileOpen path");
			const modeName = fileModeName(mode);

			return {
				$file: true,
				fd: fs.openSync(checkedPath, openFlags(modeName)),
				mode: modeName,
				closed: false,
				pending: []
			};
		});
	}

	function $fileClose(handle) {
		return resultOf("NativeIoError", "fileClose", function closeFile() {
			requireFileHandle(
				handle,
				"fileClose",
				null
			);
			fs.closeSync(handle.fd);
			handle.closed = true;
			handle.pending = [];
			return null;
		});
	}

	function $readChar(handle) {
		try {
			requireFileHandle(
				handle,
				"readChar",
				["Read"]
			);

			const value = readUtf8Char(handle);
			return value === null
				? readEof()
				: readOk(value);
		} catch (error) {
			return readErr("readChar", error);
		}
	}

	function $readLine(handle) {
		try {
			requireFileHandle(
				handle,
				"readLine",
				["Read"]
			);

			const bytes = [];

			while (true) {
				const byte = readHandleByte(handle);

				if (byte === null) {
					return bytes.length === 0
						? readEof()
						: readOk(
							Buffer.from(bytes).toString("utf8")
						);
				}

				if (byte === 0x0a) {
					return readOk(
						Buffer.from(bytes).toString("utf8")
					);
				}

				if (byte === 0x0d) {
					const next = readHandleByte(handle);

					if (next !== null && next !== 0x0a) {
						unreadHandleByte(handle, next);
					}

					return readOk(
						Buffer.from(bytes).toString("utf8")
					);
				}

				bytes.push(byte);
			}
		} catch (error) {
			return readErr("readLine", error);
		}
	}

	function $writeChar(handle, value) {
		return resultOf("NativeIoError", "writeChar", function writeCharacter() {
			if (
				typeof value !== "string"
					|| Array.from(value).length !== 1
			) {
				throw new Error("writeChar value must be a Char.");
			}
			requireFileHandle(
				handle,
				"writeChar",
				["Write", "Append"]
			);
			writeHandleText(handle, value);
			return null;
		});
	}

	function $writeLine(handle, value) {
		return resultOf("NativeIoError", "writeLine", function writeTextLine() {
			if (typeof value !== "string") {
				throw new Error("writeLine value must be a Str.");
			}
			requireFileHandle(
				handle,
				"writeLine",
				["Write", "Append"]
			);
			writeHandleText(handle, value + "\n");
			return null;
		});
	}

	// ── binary file I/O and buffers ──────────────────────────────────────

	function byteNumber(value, what) {
		const number = Number(value);

		if (
			!Number.isInteger(number)
				|| number < 0
				|| number > 255
		) {
			throw new Error(what + " must be a Byte (0..255).");
		}

		return number;
	}

	function byteList(value, what) {
		return core.$listToArray(value).map(
			function validateByte(byte, index) {
				return byteNumber(
					byte,
					what + "[" + index + "]"
				);
			}
		);
	}

	function readCount(value, what) {
		const count = intToNumber(value, what);

		if (count < 0) {
			throw new Error(what + " must not be negative.");
		}

		return count;
	}

	function readHandleBytes(handle, count) {
		const out = [];

		while (out.length < count) {
			const byte = readHandleByte(handle);

			if (byte === null) {
				break;
			}

			out.push(byte);
		}

		return out;
	}

	function writeHandleBytes(handle, bytes) {
		const data = Buffer.from(bytes);
		let offset = 0;

		while (offset < data.length) {
			offset += fs.writeSync(
				handle.fd,
				data,
				offset,
				data.length - offset,
				null
			);
		}
	}

	function bufferModeName(mode) {
		const name = mode && typeof mode.$t === "string"
			? mode.$t
			: String(mode);

		if (name !== "ByteMode" && name !== "CharMode") {
			throw new Error(
				"buffer mode must be ByteMode or CharMode."
			);
		}

		return name;
	}

	function requireBuffer(buffer, operation, expectedMode) {
		if (!buffer || !Array.isArray(buffer.$buf)) {
			throw new Error(operation + " expects a Buffer.");
		}

		if (
			expectedMode !== null
				&& buffer.$mode !== expectedMode
		) {
			throw new Error(
				operation
					+ " requires a "
					+ expectedMode
					+ " buffer."
			);
		}

		return buffer;
	}

	function $readByte(handle) {
		try {
			requireFileHandle(handle, "readByte", ["Read"]);
			const byte = readHandleByte(handle);
			return byte === null ? readEof() : readOk(byte);
		} catch (error) {
			return readErr("readByte", error);
		}
	}

	function $readBytes(handle, count) {
		try {
			requireFileHandle(handle, "readBytes", ["Read"]);
			const wanted = readCount(count, "readBytes count");

			if (wanted === 0) {
				return readOk([]);
			}

			const bytes = readHandleBytes(handle, wanted);
			return bytes.length === 0
				? readEof()
				: readOk(bytes);
		} catch (error) {
			return readErr("readBytes", error);
		}
	}

	function $writeByte(handle, byte) {
		return resultOf("NativeIoError", "writeByte", function writeOneByte() {
			requireFileHandle(
				handle,
				"writeByte",
				["Write", "Append"]
			);
			writeHandleBytes(
				handle,
				[byteNumber(byte, "writeByte value")]
			);
			return null;
		});
	}

	function $writeBytes(handle, bytes) {
		return resultOf("NativeIoError", "writeBytes", function writeManyBytes() {
			requireFileHandle(
				handle,
				"writeBytes",
				["Write", "Append"]
			);
			writeHandleBytes(
				handle,
				byteList(bytes, "writeBytes value")
			);
			return null;
		});
	}

	function $readBuffer(handle, count, mode) {
		return resultOf("NativeIoError", "readBuffer", function readIntoNewBuffer() {
			requireFileHandle(
				handle,
				"readBuffer",
				["Read"]
			);
			const wanted = readCount(count, "readBuffer count");
			const buffer = core.$makeBuffer(bufferModeName(mode));
			core.$appendByteBuffer(
				buffer,
				readHandleBytes(handle, wanted)
			);
			return buffer;
		});
	}

	function $writeBuffer(handle, buffer) {
		return resultOf("NativeIoError", "writeBuffer", function writeWholeBuffer() {
			requireFileHandle(
				handle,
				"writeBuffer",
				["Write", "Append"]
			);
			requireBuffer(buffer, "writeBuffer", null);
			writeHandleBytes(
				handle,
				core.$bufferToBytes(buffer)
			);
			return null;
		});
	}

	function $makeBuffer(mode) {
		return core.$makeBuffer(bufferModeName(mode));
	}

	function $makeStringBuffer() {
		return core.$makeBuffer("CharMode");
	}

	function $appendBuffer(buffer, byte) {
		requireBuffer(buffer, "appendBuffer", "ByteMode");
		core.$appendByteBuffer(
			buffer,
			[byteNumber(byte, "appendBuffer value")]
		);
		return null;
	}

	function $appendChar(buffer, character) {
		requireBuffer(buffer, "appendChar", "CharMode");

		if (
			typeof character !== "string"
				|| Array.from(character).length !== 1
		) {
			throw new Error("appendChar value must be a Char.");
		}

		core.$appendChar(buffer, character);
		return null;
	}

	function $appendString(buffer, text) {
		requireBuffer(buffer, "appendString", "CharMode");

		if (typeof text !== "string") {
			throw new Error("appendString value must be a Str.");
		}

		core.$appendString(buffer, text);
		return null;
	}

	function $bufferLength(buffer) {
		requireBuffer(buffer, "bufferLength", null);
		return core.$bufferLength(buffer);
	}

	function $bufferToBytes(buffer) {
		requireBuffer(buffer, "bufferToBytes", "ByteMode");
		return core.$bufferToBytes(buffer);
	}

	function $bufferToString(buffer) {
		requireBuffer(buffer, "bufferToString", "CharMode");
		return core.$bufferToString(buffer);
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
      safeMod: core.$safeMod,
      nativeErrorOperation: core.$nativeErrorOperation,
      nativeErrorMessage: core.$nativeErrorMessage
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
		runNodeBundle: $runNodeBundle,
      envVars: $envVars
    });

    const fileModule = Object.freeze({
		readFile: $readFile,
		writeFile: $writeFile,
		fileExists: $fileExists,
		mkdirP: $mkdirP,
		removeFile: $removeFile,
		fileOpen: $fileOpen,
		fileClose: $fileClose,
		readChar: $readChar,
		readLine: $readLine,
		readByte: $readByte,
		readBytes: $readBytes,
		writeChar: $writeChar,
		writeLine: $writeLine,
		writeByte: $writeByte,
		writeBytes: $writeBytes,
		readBuffer: $readBuffer,
		writeBuffer: $writeBuffer,
		makeBuffer: $makeBuffer,
		makeStringBuffer: $makeStringBuffer,
		appendBuffer: $appendBuffer,
		appendChar: $appendChar,
		appendString: $appendString,
		bufferLength: $bufferLength,
		bufferToBytes: $bufferToBytes,
		bufferToString: $bufferToString,
	});

    const jsonModule = Object.freeze({
      jsonSerialize: core.$jsonSerialize,
      jsonDeserialize: core.$jsonDeserialize
    ,
      jsonDeserializeAs: core.$jsonDeserialize});

    const asyncModule = Object.freeze({
      sleep: core.$sleep
    });

    const timerModule = Object.freeze({
      setTimer: core.$setTimer,
      setAsyncTimer: core.$setAsyncTimer,
      clearTimer: core.$clearTimer
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
      timer: timerModule,
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
      $removeFile,
      $readChar,
      $readLine,
      $writeChar,
      $writeLine,
      $readByte,
      $readBytes,
      $writeByte,
      $writeBytes,
      $readBuffer,
      $writeBuffer,
      $makeBuffer,
      $makeStringBuffer,
      $appendBuffer,
      $appendChar,
      $appendString,
      $bufferLength,
      $bufferToBytes,
      $bufferToString,
      $builtins,
		$runNodeBundle,
		$envVars
    });
  }
);
