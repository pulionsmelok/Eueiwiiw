"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { Readable } = require("stream");

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });

if (httpAgent.unref) httpAgent.unref();
if (httpsAgent.unref) httpsAgent.unref();

const METHODS = [
	"getUserInfo", "getThreadInfo", "getThreadList", "getThreadHistory",
	"sendMessage", "sendImage", "sendAudio", "sendVideo",
	"sendTextEffect", "sendAvatarTextEffect", "sendMusic", "musicSearch",
	"sendTypingIndicator", "stopTypingIndicator", "setMessageReaction", "unsendMessage", "deleteMessage",
	"markAsRead", "markAsDelivered", "setTitle", "addUserToThread", "removeUserFromThread",
	"changeThreadMute", "changeBio", "changeProfilePicture", "changeAvatar",
	"getAppState", "setOptions", "logout"
];

const MAX_MEDIA_BYTES = Math.max(256 * 1024, Number(process.env.IG_MAX_MEDIA_BYTES) || 5 * 1024 * 1024);

function isReadable(value) {
	return value instanceof Readable ||
		(value && typeof value === "object" && typeof value.pipe === "function" && typeof value.on === "function");
}

function encodeBuffer(buffer, filename, contentType) {
	if (buffer.length > MAX_MEDIA_BYTES)
		throw new Error(`Media is ${Math.round(buffer.length / 1048576)} MB, above the ${Math.round(MAX_MEDIA_BYTES / 1048576)} MB limit`);
	return { __type: "buffer", base64: buffer.toString("base64"), filename: filename || null, contentType: contentType || null };
}

function drain(stream, callback) {
	const chunks = [];
	stream.on("data", chunk => chunks.push(chunk));
	stream.on("end", () => callback(null, Buffer.concat(chunks)));
	stream.on("error", callback);
}

function encodeArgs(args) {
	return Promise.all(args.map(arg => new Promise((resolve, reject) => {
		if (arg == null) return resolve(arg);
		if (Buffer.isBuffer(arg)) return resolve(encodeBuffer(arg));
		if (typeof arg === "string") {
			if (/^https?:\/\//i.test(arg)) return resolve(arg);
			try {
				if (fs.existsSync(arg) && fs.statSync(arg).isFile()) {
					return resolve(encodeBuffer(fs.readFileSync(arg), path.basename(arg)));
				}
			}
			catch (_) {  }
			return resolve(arg);
		}
		if (isReadable(arg)) {
			return drain(arg, (error, buffer) => {
				if (error) return reject(error);
				resolve(encodeBuffer(buffer, arg.path ? path.basename(arg.path) : null));
			});
		}
		if (typeof arg === "object") {
			if (arg.stream != null) {
				return drain(arg.stream, (error, buffer) => {
					if (error) return reject(error);
					resolve(encodeBuffer(buffer, arg.filename || null, arg.contentType || null));
				});
			}
			if (arg.buffer != null && Buffer.isBuffer(arg.buffer)) {
				return resolve(encodeBuffer(arg.buffer, arg.filename, arg.contentType));
			}
			if (arg.path != null && typeof arg.path === "string") {
				try { return resolve(encodeBuffer(fs.readFileSync(arg.path), path.basename(arg.path))); }
				catch (error) { return reject(new Error(`Cannot read media path "${arg.path}": ${error.message}`)); }
			}
		}
		resolve(arg);
	})));
}

function splitCallback(args) {
	for (let i = args.length - 1; i >= 0; i--) {
		if (typeof args[i] === "function") {
			const rest = args.slice(0, i).concat(args.slice(i + 1));
			return { index: i, args: rest };
		}
	}
	return { index: -1, args };
}

function createError(payload) {
	const error = new Error((payload && payload.message) || "ig-chat-api server request failed");
	if (payload && payload.error) error.error = payload.error;
	if (payload && payload.type) error.type = payload.type;
	return error;
}

function parseServer(server) {
	if (!server) throw new Error("A server URL is required (config.server.url or IG_API_SERVER).");
	let url = String(server).trim().replace(/\/+$/, "");
	if (!/^https?:\/\//i.test(url)) url = "http://" + url;
	return new URL(url);
}

function normalizeSettings(options) {
	const server = options.server || process.env.IG_API_SERVER;
	const token = options.token || process.env.IG_API_TOKEN;
	if (!token) throw new Error("A server token is required (config.server.token or IG_API_TOKEN).");
	return {
		base: parseServer(server),
		token,

		
		
		botId: "",

		sessionToken: "",
		timeout: Number(options.timeout) || 60000,
		selfListen: options.selfListen === true || options.selfListen === "true"
	};
}

function sessionHeaders(settings) {
	const headers = {};
	if (settings.botId) headers["X-Bot-Id"] = settings.botId;
	if (settings.sessionToken) headers["X-Session-Token"] = settings.sessionToken;
	return headers;
}

function request(settings, method, args, callbackIndex) {
	return new Promise((resolve, reject) => {
		const target = settings.base;
		const lib = target.protocol === "https:" ? https : http;
		const payload = JSON.stringify({ method, args, callbackIndex: callbackIndex == null ? -1 : callbackIndex });

		const req = lib.request({
			protocol: target.protocol,
			hostname: target.hostname,
			port: target.port || (target.protocol === "https:" ? 443 : 80),
			path: "/rpc",
			method: "POST",

			agent: target.protocol === "https:" ? httpsAgent : httpAgent,
			headers: Object.assign({
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(payload),
				Authorization: "Bearer " + settings.token
			}, sessionHeaders(settings)),
			timeout: settings.timeout
		}, res => {
			const chunks = [];
			res.on("data", chunk => chunks.push(chunk));
			res.on("end", () => {
				const text = Buffer.concat(chunks).toString("utf8");
				let body;
				try { body = text ? JSON.parse(text) : {}; }
				catch (_) { return reject(new Error(`Invalid server response (${res.statusCode}): ${text.slice(0, 200)}`)); }
				if (res.statusCode === 401) return reject(new Error("Unauthorized: check your server token"));
				if (res.statusCode >= 400 || body.ok === false) return reject(createError(body.error || {}));
				resolve(body.result);
			});
		});

		req.on("timeout", () => req.destroy(new Error(`Request timed out after ${settings.timeout}ms`)));
		req.on("error", reject);
		req.write(payload);
		req.end();
	});
}

function pushCookies(settings, cookies) {
	return new Promise(resolve => {
		const target = settings.base;
		const lib = target.protocol === "https:" ? https : http;
		const payload = JSON.stringify({ cookies });
		const headers = Object.assign({
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(payload),
			Authorization: "Bearer " + settings.token
		}, sessionHeaders(settings));
		const req = lib.request({
			protocol: target.protocol,
			hostname: target.hostname,
			port: target.port || (target.protocol === "https:" ? 443 : 80),
			path: "/cookies",
			method: "POST",
			agent: target.protocol === "https:" ? httpsAgent : httpAgent,
			headers,
			timeout: settings.timeout
		}, res => {
			const chunks = [];
			res.on("data", chunk => chunks.push(chunk));
			res.on("end", () => {
				let botId = null;
				let sessionToken = null;
				try {
					const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
					const result = body && body.result;
					if (result && result.botId) botId = String(result.botId);
					if (result && result.sessionToken) sessionToken = String(result.sessionToken);
				}
				catch (_) {  }
				resolve({ status: res.statusCode, botId, sessionToken });
			});
		});
		req.on("timeout", () => req.destroy(new Error("cookie push timed out")));
		req.on("error", () => resolve({ error: true, botId: null }));
		req.write(payload);
		req.end();
	});
}

class EventStream {
	constructor(settings, callback) {
		this.settings = settings;
		this.callback = callback;
		this.req = null;
		this.buffer = "";
		this.stopped = false;
		this.retry = 3000;
		this.baseRetry = 3000;
		this.maxRetry = 60000;
		this.attempts = 0;
		this.timer = null;
		this.lastChunkAt = 0;
		this.connectedAt = 0;
		this.stallTimer = null;
	}

	start() { this._connect(); this._armStallWatch(); }

	stop() {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		if (this.stallTimer) clearInterval(this.stallTimer);
		this.stallTimer = null;
		if (this.req) {
			try { this.req.destroy(); }
			catch (_) {  }
			this.req = null;
		}
	}

	
	
	_isStalled(now) {
		if (this.stopped || !this.req) return false;

		
		
		const since = this.lastChunkAt || this.connectedAt;
		return !!since && now - since > 90000;
	}

	_armStallWatch() {
		if (this.stallTimer) return;
		this.stallTimer = setInterval(() => {
			if (!this._isStalled(Date.now())) return;
			try { this.req.destroy(); } catch (_) {  }
			this.req = null;
			this._scheduleReconnect();
		}, 15000);
		if (this.stallTimer.unref) this.stallTimer.unref();
	}

	_connect() {
		if (this.stopped) return;
		const target = this.settings.base;
		const lib = target.protocol === "https:" ? https : http;

		
		this.lastChunkAt = 0;
		this.connectedAt = Date.now();
		this.req = lib.request({
			protocol: target.protocol,
			hostname: target.hostname,
			port: target.port || (target.protocol === "https:" ? 443 : 80),
			path: "/events?botId=" + encodeURIComponent(this.settings.botId) + (this.settings.selfListen ? "&selfListen=1" : ""),
			method: "GET",
			headers: Object.assign({
				Accept: "text/event-stream",
				Authorization: "Bearer " + this.settings.token
			}, sessionHeaders(this.settings))
		}, res => {
			if (res.statusCode === 401) {
				this.callback(new Error("Unauthorized: check your server token and session"));
				return this.stop();
			}
			if (res.statusCode !== 200) {
				this.callback(new Error(`Event stream failed with status ${res.statusCode}`));
				return this._scheduleReconnect();
			}
			
			this.attempts = 0;
			this.retry = this.baseRetry;
			res.setEncoding("utf8");
			res.on("data", chunk => { this.lastChunkAt = Date.now(); this._onData(chunk); });
			res.on("end", () => this._scheduleReconnect());
			res.on("error", error => { if (!this.stopped) this.callback(error); this._scheduleReconnect(); });
		});
		this.req.on("error", error => { if (this.stopped) return; this.callback(error); this._scheduleReconnect(); });
		this.req.end();
	}

	_onData(chunk) {
		this.buffer += chunk;
		let index;
		while ((index = this.buffer.indexOf("\n\n")) !== -1) {
			const raw = this.buffer.slice(0, index);
			this.buffer = this.buffer.slice(index + 2);
			this._onEvent(raw);
		}
		
		if (this.buffer.length > 8 * 1024 * 1024) this.buffer = "";
	}

	_onEvent(raw) {
		const dataLines = [];
		for (const line of raw.split(/\r?\n/)) {
			if (line.startsWith(":")) continue;
			if (line.startsWith("retry:")) {
				const value = Number(line.slice(6).trim());
				if (value > 0) { this.retry = value; this.baseRetry = value; }
				continue;
			}
			if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
		}
		if (!dataLines.length) return;
		let event;
		try { event = JSON.parse(dataLines.join("\n")); }
		catch (error) { return this.callback(new Error("Malformed event from server: " + error.message)); }
		this.callback(null, event);
	}

	_scheduleReconnect() {
		if (this.stopped || this.timer) return;
		
		const delay = Math.min(this.maxRetry, this.retry * Math.pow(2, Math.min(5, this.attempts)));
		this.attempts++;
		this.timer = setTimeout(() => { this.timer = null; this._connect(); }, delay);
		if (this.timer.unref) this.timer.unref();
	}
}

function login(options, callback) {
	if (typeof options === "function") { callback = options; options = {}; }
	options = options || {};

	let settings;
	try { settings = normalizeSettings(options); }
	catch (error) {
		if (typeof callback === "function") { callback(error); return Promise.reject(error); }
		return Promise.reject(error);
	}

	const api = {};
	for (const method of METHODS) api[method] = makeMethod(settings, method);

	
	
	api.sendTypingIndicator = function (threadID, callback) {
		const promise = encodeArgs([threadID]).then(encoded => request(settings, "sendTypingIndicator", encoded));
		if (typeof callback === "function") promise.then(r => callback(null, r), e => callback(e));
		return function stop(cb) {
			const p = encodeArgs([threadID]).then(encoded => request(settings, "stopTypingIndicator", encoded));
			if (typeof cb === "function") p.then(r => cb(null, r), e => cb(e));
			return p;
		};
	};

	api.getCurrentUserID = function () { return api._userID || null; };
	api.getAppState = function () { return []; };
	api.listen = api.listenMqtt = function (cb) {
		if (typeof cb !== "function") throw new Error("listenMqtt requires a callback");
		const stream = new EventStream(settings, cb);
		stream.start();
		return function stop() { stream.stop(); };
	};

	let resolveFunc = () => { };
	let rejectFunc = () => { };
	const promise = new Promise((resolve, reject) => { resolveFunc = resolve; rejectFunc = reject; });

	
	const seed = options.cookies != null ? Promise.resolve(options.cookies)
		: Array.isArray(options.appState) && options.appState.length ? Promise.resolve(options.appState)
		: null;

	
	
	function connect(attemptsLeft) {
		return request(settings, "getCurrentUserID", []).catch(error => {
			const message = String(error && (error.message || error) || "");
			const warming = /still logging in|not logged in|no cookies/i.test(message);
			if (warming && attemptsLeft > 0) {
				return new Promise(resolve => setTimeout(resolve, 3000)).then(() => connect(attemptsLeft - 1));
			}
			throw error;
		});
	}

	(seed ? seed : Promise.resolve(null))
		.then(value => pushCookies(settings, value))
		.then(outcome => {

			

			

			if (outcome && outcome.botId) settings.botId = outcome.botId;
			if (outcome && outcome.sessionToken) settings.sessionToken = outcome.sessionToken;
		}).catch(() => { })
		.then(() => connect(Math.max(1, Math.floor(settings.timeout / 3000))))
		.then(id => {
			api._userID = id != null ? String(id) : null;
			if (typeof callback === "function") callback(null, api);
			resolveFunc(api);
		})
		.catch(error => {
			if (typeof callback === "function") callback(error);
			rejectFunc(error);
		});

	return promise;
}

function makeMethod(settings, method) {
	return function (...args) {
		const { index, args: callArgs } = splitCallback(args);

		const promise = encodeArgs(callArgs).then(encoded => request(settings, method, encoded, index));
		if (index !== -1) {
			const callback = args[index];
			promise.then(result => callback(null, result), error => callback(error));
			return undefined;
		}
		return promise;
	};
}

module.exports = login;
module.exports.login = login;
module.exports.METHODS = METHODS.slice();
module.exports.EventStream = EventStream;
module.exports.pushCookies = pushCookies;
