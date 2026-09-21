"use strict";

const fs = require("fs");
const path = require("path");
const log = require("../logger/logger");

const ROOT = path.resolve(__dirname, "..");

function resolveFile(config) {
	const configured = (config.onlineStatus && config.onlineStatus.file) || "data/online-status.jsonl";
	return path.isAbsolute(configured) ? configured : path.join(ROOT, configured);
}

function createOnlineStatus({ config, startedAt, stats }) {
	if (!config.onlineStatus || config.onlineStatus.enable !== true) {
		return { start() { }, stop() { }, writeLine() { } };
	}

	const file = resolveFile(config);
	const interval = Number(config.onlineStatus.interval) || 60000;
	let timer = null;

	function writeLine(extra = {}) {
		const line = Object.assign({
			status: "online",
			bot: config.botName,
			time: new Date().toISOString(),
			uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
		}, typeof stats === "function" ? stats() : {}, extra);
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.appendFileSync(file, JSON.stringify(line) + "\n");
		}
		catch (error) {
			log.warn("ONLINE", `Could not write online status: ${error.message}`);
		}
		return line;
	}

	return {
		file,
		writeLine,
		start() {
			writeLine({ event: "started" });
			timer = setInterval(() => writeLine(), interval);
			if (timer.unref) timer.unref();
			log.success("ONLINE", `Online status written to ${path.relative(ROOT, file)} every ${Math.round(interval / 1000)}s`);
		},
		stop() {
			if (timer) clearInterval(timer);
			timer = null;
			writeLine({ event: "stopped" });
		}
	};
}

module.exports = { createOnlineStatus };
