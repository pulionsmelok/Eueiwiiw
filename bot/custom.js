"use strict";

const http = require("http");
const log = require("../logger/logger");

function createStatusServer(options) {
	const port = options && options.port != null ? Number(options.port) : Number(process.env.PORT || 8080);
	const host = (options && options.host) || "0.0.0.0";
	const info = (options && options.info) || (() => ({}));

	if (!port) {
		return { start() { }, stop() { }, enabled: false };
	}

	let server = null;

	function payload() {
		let extra = {};
		try { extra = info() || {}; } catch (_) { extra = {}; }
		return Object.assign({
			ok: true,
			service: "instabot",
			uptime: Math.round(process.uptime())
		}, extra);
	}

	function handler(req, res) {
		try {
			const body = JSON.stringify(payload());
			res.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Content-Length": Buffer.byteLength(body)
			});
			res.end(body);
		}
		catch (_) {
			
			try { res.destroy(); } catch (_) {  }
		}
	}

	return {
		enabled: true,
		start() {
			if (server) return Promise.resolve(server);
			server = http.createServer(handler);

			
			server.on("error", error => log.warn("HTTP", `status server error: ${error && error.message ? error.message : error}`));
			return new Promise((resolve, reject) => {
				const onListenError = error => { server.removeListener("error", onListenError); reject(error); };
				server.once("error", onListenError);
				server.listen(port, host, () => {
					server.removeListener("error", onListenError);
					log.info("HTTP", `status server listening on http://${host}:${port}`);
					resolve(server);
				});
			});
		},
		stop() {
			return new Promise(resolve => {
				if (!server) return resolve();
				server.close(() => resolve());
				server = null;
			});
		}
	};
}

module.exports = { createStatusServer };
