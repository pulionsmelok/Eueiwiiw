"use strict";

const t = require("../../languages").text;
const log = require("../../logger/logger");
const { createMessageContext } = require("./message");

const ROLE_USER = 0;
const ROLE_ADMIN_BOX = 1;
const ROLE_ADMIN_BOT = 2;

function createDispatcher({ api, config, registry, database }) {
	const cooldowns = new Map();
	const onReply = new Map(); 
	const onReaction = new Map(); 
	const refreshedUsers = new Set();

	

	
	const HANDLER_TTL_MS = 30 * 60 * 1000;
	function pruneHandlers(now) {
		for (const map of [onReply, onReaction]) {
			if (map.size < 256) continue;
			for (const [key, value] of map) {
				if (now - (value.at || 0) > HANDLER_TTL_MS) map.delete(key);
			}
		}
	}

	function senderIDOf(event) {
		return String(event.senderID || event.userID || "");
	}

	function isBotAdmin(id) {
		return config.adminBot.includes(String(id));
	}

	function roleOf(event, threadData) {
		const senderID = senderIDOf(event);
		if (isBotAdmin(senderID)) return ROLE_ADMIN_BOT;
		const admins = (threadData && threadData.adminIDs) || [];
		if (admins.map(String).includes(senderID)) return ROLE_ADMIN_BOX;
		return ROLE_USER;
	}

	function requiredRole(command, threadData) {
		const configured = command.config.role;
		let role = 0;
		if (typeof configured === "number") role = configured;
		else if (configured && typeof configured === "object" && typeof configured.onStart === "number") role = configured.onStart;
		if (threadData && threadData.settings && typeof threadData.settings.setRole === "object")
			return threadData.settings.setRole[command.config.name] ?? role;
		return role;
	}

	function allowedByWhitelist(event) {
		if (!config.whiteList.enable) return true;
		const senderID = senderIDOf(event);
		if (isBotAdmin(senderID)) return true;
		return config.whiteList.userIDs.includes(senderID) || config.whiteList.threadIDs.includes(String(event.threadID));
	}

	function cooldownRemaining(command, senderID) {
		const seconds = Number(command.config.countDown ?? command.config.cooldown ?? (config.cooldown && config.cooldown.default)) || 0;
		if (seconds <= 0) return 0;
		const key = `${command.config.name}:${senderID}`;
		const last = cooldowns.get(key) || 0;
		const remaining = last + seconds * 1000 - Date.now();
		if (remaining > 0) return Math.ceil(remaining / 1000);
		cooldowns.set(key, Date.now());
		return 0;
	}

	function registerOnReply(messageID, commandName, handler) {
		onReply.set(String(messageID), { commandName, handler, at: Date.now() });
		return handler;
	}

	function registerOnReaction(messageID, commandName, handler) {
		onReaction.set(String(messageID), { commandName, handler, at: Date.now() });
		return handler;
	}

	function suggestionFor(name) {
		if (!name) return null;
		const candidates = new Set(registry.commands.keys());
		for (const alias of registry.aliases.keys()) candidates.add(alias);

		let best = null;
		let bestDistance = Infinity;
		for (const candidate of candidates) {
			const distance = levenshtein(name, candidate);
			
			if (distance < bestDistance || (distance === bestDistance && best && candidate.length < best.length)) {
				bestDistance = distance;
				best = candidate;
			}
		}
		
		const limit = name.length <= 3 ? 1 : 2;
		return bestDistance <= limit ? best : null;
	}

	function levenshtein(a, b) {
		const rows = Array.from({ length: b.length + 1 }, (_, i) => i);
		for (let i = 1; i <= a.length; i++) {
			let previous = rows[0];
			rows[0] = i;
			for (let j = 1; j <= b.length; j++) {
				const temp = rows[j];
				rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
				previous = temp;
			}
		}
		return rows[b.length];
	}

	async function runCommands(event, message, threadData, userData) {
		const body = typeof event.body === "string" ? event.body : "";
		if (!body) return;
		const senderID = senderIDOf(event);
		const hasPrefix = config.prefix && body.startsWith(config.prefix);

		const rawBody = hasPrefix ? body.slice(config.prefix.length).trim() : body.trim();
		const rawArgs = rawBody ? rawBody.split(/\s+/) : [];
		const rawName = (rawArgs[0] || "").toLowerCase();

		

		const bare = registry.resolve(rawName);
		const bareAllowed = !!bare && bare.config.noPrefix === true &&
			(isBotAdmin(senderID) || bare.config.noPrefixRole === 0);
		const noPrefixAllowed = config.noPrefix === true && isBotAdmin(senderID);

		if (!hasPrefix && !bareAllowed && !noPrefixAllowed) return;

		const args = rawArgs.slice();
		const name = (args.shift() || "").toLowerCase();
		const command = registry.resolve(name);

		if (!command) {
			if (config.hideNotiMessage.commandNotFound || !hasPrefix) return;
			const suggestion = suggestionFor(name);
			
			const key = suggestion ? "commandNotFoundSuggestion" : "commandNotFound";
			const text = t(config.language, key, suggestion || "");
			return message.reply(text.replace(/\{pn\}/g, config.prefix));
		}

		const commandName = command.config.name.toLowerCase();

		if (userData && userData.banned && userData.banned.status) {
			if (!config.hideNotiMessage.userBanned)
				return message.reply(t(config.language, "userBanned", config.botName, userData.banned.reason || "—"));
			return;
		}

		if (config.adminOnly.enable && !isBotAdmin(senderID) && !config.adminOnly.ignoreCommands.includes(commandName)) {
			if (!config.hideNotiMessage.adminOnly)
				return message.reply(t(config.language, "onlyAdminBot", commandName));
			return;
		}

		const role = roleOf(event, threadData);
		const needRole = requiredRole(command, threadData);
		if (needRole > role) {
			if (!config.hideNotiMessage.needRoleToUseCommand) {
				const key = needRole === ROLE_ADMIN_BOT ? "onlyAdminBot" : "onlyAdmin";
				return message.reply(t(config.language, key, commandName));
			}
			return;
		}

		const wait = cooldownRemaining(command, senderID);
		if (wait) return message.reply(t(config.language, "cooldown", wait, commandName));

		const commandApi = {
			api,
			message,
			event,
			args,
			commandName,

			
			invokedAs: name,
			role,
			usersData: database.users,
			threadsData: database.threads,
			userData,
			threadData,
			config,
			registry,
			
			setReplyHandler(handler, messageID) {
				const key = messageID != null ? messageID : event.messageID;
				if (key == null) return handler;
				onReply.set(String(key), { commandName, handler, at: Date.now() });
				return handler;
			},
			setReactionHandler(handler, messageID) {
				const key = messageID != null ? messageID : event.messageID;
				if (key == null) return handler;
				onReaction.set(String(key), { commandName, handler, at: Date.now() });
				return handler;
			}
		};

		try {
			await command.onStart(commandApi);
			log.info("COMMAND", `${commandName} | ${senderID} | ${event.threadID} | ${args.join(" ")}`);
		}
		catch (error) {
			log.error("COMMAND", `Error in "${commandName}"`, error);
			await message.reply(t(config.language, "errorOccurred", commandName, String(error.message || error)));
		}
	}

	async function runReplyHandlers(event, message, threadData, userData) {
		const repliedID = event.messageReply && event.messageReply.messageID;
		if (!repliedID) return false;
		const entry = onReply.get(String(repliedID));
		if (!entry) return false;

		
		onReply.delete(String(repliedID));

		
		
		if (userData && userData.banned && userData.banned.status) {
			if (!config.hideNotiMessage.userBanned)
				await message.reply(t(config.language, "userBanned", config.botName, userData.banned.reason || "—"));
			return true;
		}

		try {
			await entry.handler({
				api,
				message,
				event,
				args: event.body ? event.body.split(/\s+/) : [],
				usersData: database.users,
				threadsData: database.threads,
				userData,
				threadData,
				config,
				commandName: entry.commandName,

				setReplyHandler(handler, messageID) {
					const key = messageID != null ? messageID : event.messageID;
					if (key == null) return handler;
					onReply.set(String(key), { commandName: entry.commandName, handler, at: Date.now() });
					return handler;
				},
				setReactionHandler(handler, messageID) {
					const key = messageID != null ? messageID : event.messageID;
					if (key == null) return handler;
					onReaction.set(String(key), { commandName: entry.commandName, handler, at: Date.now() });
					return handler;
				}
			});
		}
		catch (error) {
			log.error("REPLY", `Error in reply handler for "${entry.commandName}"`, error);
		}
		return true;
	}

	async function runReactionHandlers(event, message, threadData, userData) {
		const entry = onReaction.get(String(event.messageID));
		if (!entry) return false;
		
		if (userData && userData.banned && userData.banned.status) return true;
		try {
			await entry.handler({
				api,
				message,
				event,
				usersData: database.users,
				threadsData: database.threads,
				userData,
				threadData,
				config,
				commandName: entry.commandName,
				setReplyHandler(handler, messageID) {
					const key = messageID != null ? messageID : event.messageID;
					if (key == null) return handler;
					onReply.set(String(key), { commandName: entry.commandName, handler, at: Date.now() });
					return handler;
				},
				setReactionHandler(handler, messageID) {
					const key = messageID != null ? messageID : event.messageID;
					if (key == null) return handler;
					onReaction.set(String(key), { commandName: entry.commandName, handler, at: Date.now() });
					return handler;
				}
			});
		}
		catch (error) {
			log.error("REACTION", `Error in reaction handler for "${entry.commandName}"`, error);
		}
		return true;
	}

	async function runEventScripts(event, message, threadData, userData) {
		for (const script of registry.events) {

			const wanted = script.config.eventType;
			if (wanted) {
				const list = Array.isArray(wanted) ? wanted : [wanted];
				if (!list.includes(event.type)) continue;
			}
			try {
				await script.onEvent({ api, message, event, usersData: database.users, threadsData: database.threads, userData, threadData, config, role: roleOf(event, threadData) });
			}
			catch (error) {
				log.error("EVENT", `Error in event "${script.config.name}"`, error);
			}
		}
	}

	function refreshUserIfNeeded(userData, userID) {
		if (!userData || userData.name || refreshedUsers.has(userID)) return;
		refreshedUsers.add(userID);
		api.getUserInfo(userID, (error, info) => {
			if (error || !info || !info[userID]) return;
			const profile = info[userID];
			database.users.update(userID, {
				name: profile.name || profile.firstName || null,
				username: profile.vanity || null
			});
		});
	}

	async function resolveThreadGroup(event, threadData) {
		if (event.isGroup === true) return { isGroup: true, known: true };
		if (event.isGroup === false) return { isGroup: false, known: true };
		const members = new Set();
		for (const list of [event.participantIDs, event.userIDs]) {
			if (Array.isArray(list)) for (const id of list) if (id != null && String(id)) members.add(String(id));
		}
		if (members.size > 1) return { isGroup: true, known: true };
		if (threadData.groupKnown) return { isGroup: threadData.isGroup === true, known: true };
		try {
			const info = await new Promise((resolve, reject) =>
				api.getThreadInfo(event.threadID, (error, result) => error ? reject(error) : resolve(result)));
			const isGroup = !!(info && (info.isGroup === true || Number(info.threadType) === 2 ||
				(Array.isArray(info.participantIDs) && info.participantIDs.length > 2)));
			database.threads.update(event.threadID, { isGroup, groupKnown: true, name: info && info.name || undefined });
			return { isGroup, known: true };
		}
		catch (_) {
			
			return { isGroup: false, known: false };
		}
	}

	async function handle(event) {
		if (!event || !event.threadID) return;
		pruneHandlers(Date.now());
		const senderID = senderIDOf(event);
		if (!senderID && (event.type === "message" || event.type === "message_reply")) return;

		if (!allowedByWhitelist(event)) return;

		const threadData = database.threads.ensure(event.threadID, { threadID: event.threadID });
		let userData = null;
		if (senderID) userData = database.users.ensure(senderID, { userID: senderID });

		
		
		const group = await resolveThreadGroup(event, threadData);
		event.isGroup = group.isGroup;
		threadData.isGroup = group.isGroup;
		if (group.known) threadData.groupKnown = true;

		const message = createMessageContext({ api, event, log });

		switch (event.type) {
			case "message":
			case "message_reply":
				refreshUserIfNeeded(userData, senderID);
				await runEventScripts(event, message, threadData, userData);
				if (await runReplyHandlers(event, message, threadData, userData)) break;
				await runCommands(event, message, threadData, userData);
				break;
			case "message_reaction":
				await runEventScripts(event, message, threadData, userData);
				await runReactionHandlers(event, message, threadData, userData);
				break;
			default:
				await runEventScripts(event, message, threadData, userData);
				break;
		}

		database.threads.flush();
		database.users.flush();
	}

	return { handle, roleOf, registerOnReply, registerOnReaction, ROLE_USER, ROLE_ADMIN_BOX, ROLE_ADMIN_BOT };
}

module.exports = { createDispatcher, ROLE_USER, ROLE_ADMIN_BOX, ROLE_ADMIN_BOT };
