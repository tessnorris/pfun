"use strict";

// host/browser.js — minimal browser platform host for compiler-produced pages.
//
// C4 needs the target boundary and platform-neutral builtin floor. DOM mounting,
// TEA events, fetch, and sandbox messaging land in later browser slices. The
// shared core provides sleep and cancellable one-shot timers.

(function attachPfunBrowser(root, factory) {
	const core = root.PfunCore;

	if (!core) {
		throw new Error(
			"host/browser.js requires PfunCore. Load host/core.js first."
		);
	}

	const api = factory(core, root);

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}

	root.PfunBrowser = api;
	root.PfunBuiltins = api.$builtins;
})(
	typeof globalThis !== "undefined" ? globalThis : this,
	function buildPfunBrowser(core, root) {
		function ioError(operation, error) {
			const message = error
				&& typeof error.message === "string"
				&& error.message.length > 0
					? error.message
					: String(error);
			return core.$err(
				core.$nativeError(
					"NativeIoError",
					operation,
					message
				)
			);
		}

		function writeConsole(value, newline, operation) {
			try {
				const text = core.$str(value);

				if (
					!root.console
						|| typeof root.console.log !== "function"
				) {
					throw new Error(
						"browser console is not available."
					);
				}

				if (newline) {
					root.console.log(text);
				} else if (
					typeof root.console.info === "function"
				) {
					root.console.info(text);
				} else {
					root.console.log(text);
				}

				return core.$ok(null);
			} catch (error) {
				return ioError(operation, error);
			}
		}

		function $print(value) {
			return writeConsole(value, false, "print");
		}

		function $println(value) {
			return writeConsole(value, true, "println");
		}

		function $flushStdout() {
			return core.$ok(null);
		}

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
			nativeErrorMessage: core.$nativeErrorMessage,
		});

		const ioModule = Object.freeze({
			print: $print,
			println: $println,
			flushStdout: $flushStdout,
		});

		const jsonModule = Object.freeze({
			jsonSerialize: core.$jsonSerialize,
			jsonDeserialize: core.$jsonDeserialize,
			jsonDeserializeAs: core.$jsonDeserialize,
		});

		const asyncModule = Object.freeze({
			sleep: core.$sleep,
		});

		const timerModule = Object.freeze({
			setTimer: core.$setTimer,
			setAsyncTimer: core.$setAsyncTimer,
			clearTimer: core.$clearTimer,
		});

		const mathModule = Object.freeze({
			pi: core.$pi,
			e: core.$e,
			tau: core.$tau,
			sqrt: core.$sqrt,
			pow: core.$pow,
			abs: core.$absInt,
			min: core.$minInt,
			max: core.$maxInt,
		});

		const $builtins = Object.freeze({
			"$builtin/core": coreModule,
			core: coreModule,
			io: ioModule,
			json: jsonModule,
			async: asyncModule,
			timer: timerModule,
			math: mathModule,
		});

		return Object.freeze({
			$print,
			$println,
			$flushStdout,
			$builtins,
		});
	}
);
