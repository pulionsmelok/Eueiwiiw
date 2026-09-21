"use strict";

const log = require("../../logger/logger");
const { loadAccount } = require("../config");
const { createDatabase } = require("../../database/database");
const { createRegistry, loadAll } = require("./loadScripts");
const { createDispatcher } = require("../handler/handlerEvents");
const { createOnlineStatus } = require("../autoUptime");

const serverLogin = require("./auth");

function loadServerCookies() {
	if (process.env.IG_COOKIES && process.env.IG_COOKIES.trim()) return process.env.IG_COOKIES.trim();
	try {
		return loadAccount();
	}
	catch (_) {
		return null;
	}
}

function resolveLogin(config) {
	const server = config.server || {};
	if (server.url && server.token) return { login: serverLogin, mode: "server" };
	try {
		return { login: require("ig-chat-api"), mode: "direct" };
	}
	catch (error) {
		throw new Error(
			"No server configured and the direct 'ig-chat-api' package is not installed.\n" +
			"Recommended: set server.url + server.token in config.json (or IG_API_SERVER / IG_API_TOKEN).\n" +
			"Mode B (development): install ig-chat-api into node_modules and place cookies in account.txt."
		);
	}
}

function normalizeEvent(event) {
	if (!event || typeof event !== "object") return event;
	const normalized = Object.assign({}, event);

	if (Array.isArray(normalized.attachments)) {
		normalized.attachments = normalized.attachments.map(att => {
			if (!att || typeof att !== "object") return att;
			const type = att.type === "image" ? "photo" : att.type === "gif" ? "animated_image" : att.type;
			return Object.assign({}, att, { type });
		});
	}

	if (normalized.repliedToMessage) {
		const replied = normalized.repliedToMessage;
		normalized.messageReply = {
			messageID: replied.messageID || null,
			senderID: replied.senderID != null ? String(replied.senderID) : null,
			body: replied.body != null ? String(replied.body) : "",
			attachments: Array.isArray(replied.attachments) ? replied.attachments : [],
			timestamp: replied.timestamp || null
		};
		if (normalized.type === "message") normalized.type = "message_reply";
	}

	if (normalized.senderID != null && normalized.userID == null) normalized.userID = normalized.senderID;
	if (normalized.userID != null && normalized.senderID == null) normalized.senderID = normalized.userID;

	
	const added = firstArray(normalized.userIDs, normalized.addedParticipants, normalized.added_participants,
		normalized.added_users, normalized.added_user_ids, normalized.usersAdded, normalized.users_added,
		normalized.participantsAdded, normalized.participants_added);
	const removed = firstArray(normalized.removedParticipants, normalized.removed_participants,
		normalized.removed_users, normalized.removed_user_ids, normalized.left_users, normalized.usersRemoved,
		normalized.users_removed, normalized.participantsRemoved, normalized.participants_removed);

	if (normalized.type === "join" && !normalized.userIDs) normalized.userIDs = added || [];
	if (normalized.type === "leave" && !normalized.userIDs) normalized.userIDs = removed || [];

	
	
	if (normalized.isGroup !== true) {
		const members = [...(added || []), ...(removed || []), ...(normalized.userIDs || []),
			...(normalized.participantIDs || []), ...(normalized.participants || [])];
		const unique = new Set(members.map(String).filter(Boolean));
		const legacyGroup = String(normalized.threadID || "").includes(":");
		const isMembership = normalized.type === "join" || normalized.type === "leave";
		const looksGroup = Array.isArray(added) || Array.isArray(removed) ||
			isMembership || legacyGroup || unique.size > 2;
		if (looksGroup) normalized.isGroup = true;
	}

	return normalized;
}

function firstArray(...candidates) {
	for (const value of candidates) {
		if (Array.isArray(value)) return value;
	}
	return null;
}

function createBot(config) {
	const startedAt = Date.now();
	global.instabotStartedAt = startedAt;
	const database = createDatabase(config);
	const registry = createRegistry();
	const state = {
		api: null,
		botID: null,
		listening: null,
		stopListening: null,
		listenerGeneration: 0,
		restartTimer: null,
		retireListener: null,
		running: false,
		stopping: false,
		commandCount: 0,
		eventCount: 0,
		messagesHandled: 0
	};

	const autoUptime = createOnlineStatus({
		config,
		startedAt,
		stats: () => ({
			botID: state.botID,
			commands: state.commandCount,
			events: state.eventCount,
			messagesHandled: state.messagesHandled
		})
	});

	let dispatcher = null;

	function loadCommands() {
		const { commandCount, eventCount } = loadAll(registry);
		state.commandCount = commandCount;
		state.eventCount = eventCount;
	}

	function startServer() {
		let login, mode;
		try {
			({ login, mode } = resolveLogin(config));
		}
		catch (error) {
			return Promise.reject(error);
		}

		return new Promise((resolve, reject) => {
			const finish = async (error, api) => {
				if (error) return reject(error);
				state.api = api;
				state.botID = api.getCurrentUserID();
				dispatcher = createDispatcher({ api, config, registry, database });

				try {
					const info = await api.getUserInfo(state.botID);
					const profile = info && info[state.botID];
					log.success("LOGIN", `Logged in as ${state.botID}${profile && profile.vanity ? ` (@${profile.vanity})` : ""}`);
				}
				catch (_) {
					log.success("LOGIN", `Logged in as ${state.botID}`);
				}

				startListening();
				autoUptime.start();
				resolve(api);
			};

			if (mode === "server") {
				const options = {
					server: config.server.url,
					token: config.server.token,
					botId: config.server.botId,
					timeout: Number(config.server.timeout) || 60000,
					selfListen: config.selfListen === true,

					
					cookies: loadServerCookies()
				};
				log.info("LOGIN", `Connecting to ig-chat-api server at ${options.server} as "${options.botId || "default"}"${options.selfListen ? " (selfListen on)" : ""}`);
				Promise.resolve(login(options)).then(api => finish(null, api), finish);
				return;
			}

			login({ appState: loadAccount() }, buildOptions(), finish);
		});
	}

	function buildOptions() {
		const options = {
			listenEvents: config.listenEvents,
			selfListen: config.selfListen,
			autoMarkRead: config.autoMarkRead,
			autoMarkDelivery: config.autoMarkDelivery,
			autoReconnect: config.autoReconnect,
			logLevel: "silent"
		};
		if (config.account && config.account.proxy) options.proxy = config.account.proxy;
		if (config.account && config.account.userAgent) options.userAgent = config.account.userAgent;
		return options;
	}

	function handleListenerEvent(error, rawEvent) {
		if (error) return handleListenerError(error);
		
		if (rawEvent && rawEvent.__internal) {
			if (rawEvent.__internal === "relogin") {
				log.warn("LISTEN", "Server is re-logging in; waiting for the stream to resume");
				autoUptime.writeLine({ event: "relogin", reason: rawEvent.reason || null });
			}
			else if (rawEvent.__internal === "error") {
				handleListenerError(rawEvent.error || { message: "server error" });
			}
			return;
		}
		const event = normalizeEvent(rawEvent);
		if (!event || event.type === "ready") return;

		state.messagesHandled++;

		if (shouldLog(event.type)) {
			const shown = Object.assign({}, event);
			if (Array.isArray(shown.participantIDs)) shown.participantIDs = `Array(${shown.participantIDs.length})`;
			log.info(String(event.type).toUpperCase(), JSON.stringify(shown));
		}

		Promise.resolve(dispatcher.handle(event)).catch(err => log.error("DISPATCH", "Unhandled error", err));
	}

	function shouldLog(type) {
		const settings = config.logEvents || {};
		if (settings.disableAll === true) return false;
		return settings[type] === true;
	}

	function handleListenerError(error) {
		const message = String(error && (error.error || error.message) || error);
		if (/connection closed|closed by user/i.test(message)) return;
		autoUptime.writeLine({ event: "listener_error", error: message });
		if (/not logged in|login_required|logged.?out/i.test(message)) {
			log.error("LISTEN", "Session is no longer valid. Re-reading account.txt…", message);
			scheduleRelogin();
		}
		else {
			log.error("LISTEN", "Listener error", message);
		}
	}

	function startListening() {
		state.listenerGeneration++;
		const generation = state.listenerGeneration;

		if (state.retireListener) clearTimeout(state.retireListener);
		try {
			if (typeof state.stopListening === "function") state.stopListening();
		}
		catch (_) {  }
		state.stopListening = state.api.listenMqtt((error, event) => {
			if (generation !== state.listenerGeneration) return;
			handleListenerEvent(error, event);
		});
		state.listening = true;
		log.success("LISTEN", "Realtime listener started");

		if (state.restartTimer) clearInterval(state.restartTimer);
		const interval = Number(config.restartListenInterval) || 0;
		if (interval > 0) {
			state.restartTimer = setInterval(() => restartListening(), interval);
			if (state.restartTimer.unref) state.restartTimer.unref();
		}
	}

	function restartListening() {
		try {
			if (typeof state.stopListening === "function") state.stopListening();
		}
		catch (_) {  }
		if (state.retireListener) clearTimeout(state.retireListener);
		state.retireListener = setTimeout(() => { state.retireListener = null; startListening(); }, 1000);
		if (state.retireListener.unref) state.retireListener.unref();
		log.info("LISTEN", "Listener restarted");
	}

	function scheduleRelogin() {
		if (state.retireListener) return;
		state.retireListener = setTimeout(() => {
			state.retireListener = null;
			log.info("LOGIN", "Reconnecting the realtime listener");
			startListening();
		}, 5000);
		if (state.retireListener.unref) state.retireListener.unref();
	}

	async function start() {
		log.master("BOOT", `${config.botName} starting…`);

		loadCommands();

		
		let attempt = 0;
		for (;;) {
			if (state.stopping) return;
			try {
				await startServer();
				break;
			}
			catch (error) {
				attempt++;
				const message = String(error && (error.error || error.message) || error);
				const delay = Math.min(60000, 5000 * attempt);
				autoUptime.writeLine({ event: "boot_retry", attempt, error: message });
				log.warn("BOOT", `Could not connect (attempt ${attempt}): ${message}. Retrying in ${Math.round(delay / 1000)}s…`);

				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
		if (state.stopping) return;
		state.running = true;
		log.success("BOOT", `${config.botName} is online. Type ${config.prefix}help in a chat.`);
	}

	async function stop() {
		state.running = false;
		state.stopping = true;
		autoUptime.writeLine({ event: "stopping" });
		try {
			if (typeof state.stopListening === "function") state.stopListening();
		}
		catch (_) {  }

		
		if (state.restartTimer) { clearInterval(state.restartTimer); state.restartTimer = null; }
		if (state.retireListener) { clearTimeout(state.retireListener); state.retireListener = null; }
		database.flush();

		

		
		
		log.master("BOOT", `${config.botName} stopped`);
	}

	return { start, stop, state, database, registry, normalizeEvent };
}

module.exports = { createBot, normalizeEvent };

const { loadConfig: __loadConfig } = require("../config");
const { createStatusServer: __createStatusServer } = require("../custom");

async function login() {
	const config = __loadConfig();
	const bot = createBot(config);
	const statusServer = __createStatusServer({
		info: () => ({
			bot: config.botName,
			online: bot.state.running === true,
			userID: bot.state.botID || null,
			commands: bot.state.commandCount,
			events: bot.state.eventCount
		})
	});
	try { await statusServer.start(); } catch (error) {
		log.error("HTTP", "Could not start the status server", error);
	}
	await bot.start();
	return bot;
}

const __prev = module.exports;
module.exports = login;
module.exports.createBot = __prev.createBot;
module.exports.normalizeEvent = __prev.normalizeEvent;
module.exports.login = login;
