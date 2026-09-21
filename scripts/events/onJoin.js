"use strict";

const log = require("../../logger/logger");

function fill(template, values) {
	return String(template).replace(/%(\d+)/g, (match, index) => {
		const value = values[Number(index) - 1];
		return value == null ? "" : String(value);
	});
}

module.exports = {
	config: {
		name: "onJoin",
		category: "system",
		eventType: "join",
		description: { en: "Welcome members added to a group thread" }
	},

	onEvent: async function ({ api, event, message, config, threadsData }) {
		const settings = config.welcome || {};
		if (settings.enable === false) return;

		const threadID = event.threadID;
		if (Array.isArray(settings.threadIDs) && settings.threadIDs.length &&
			!settings.threadIDs.map(String).includes(String(threadID))) return;

		

		

		
		const usernames = Array.isArray(event.usernames) ? event.usernames.map(String).filter(Boolean) : [];
		const ids = (event.userIDs && event.userIDs.length
			? event.userIDs
			: (event.participantID ? [event.participantID] : []))
			.filter(Boolean).map(String);

		if (!usernames.length && !ids.length) return;

		const thread = threadsData.get(threadID) || {};
		let threadName = thread.name;
		if (!threadName) {
			try {
				const info = await new Promise((resolve, reject) =>
					api.getThreadInfo(threadID, (error, result) => error ? reject(error) : resolve(result)));
				threadName = info && (info.name || (info.threadName));
				if (threadName) threadsData.update(threadID, { name: threadName });
			}
			catch (_) {  }
		}

		
		let selfID = null;
		try {
			selfID = String(api.getCurrentUserID() || api._userID || "") || null;
		}
		catch (_) { selfID = null; }
		const selfHandles = new Set();
		try {
			const info = selfID ? await new Promise((resolve) =>
				api.getUserInfo(selfID, (error, result) => resolve(error ? null : result))) : null;
			const self = info && info[selfID];
			if (self && (self.vanity || self.username)) selfHandles.add(String(self.vanity || self.username).toLowerCase());
		}
		catch (_) {  }

		const isSelf = (target) =>
			(selfID && target.userID && String(target.userID) === selfID) ||
			(target.username && selfHandles.has(String(target.username).replace(/^@/, "").toLowerCase()));

		
		const targets = [];
		for (const name of usernames) targets.push({ username: name, userID: null });
		for (const id of ids) {
			if (targets.some(t => t.userID === id)) continue;

			
			targets.push({ username: null, userID: id });
		}
		if (!targets.length) return;

		const selfTargets = targets.filter(isSelf);
		const memberTargets = targets.filter(t => !isSelf(t));
		if (selfTargets.length) {
			const selfTemplate = settings.selfMessage ||
				"Thanks for inviting me to %2 💋. Type {prefix}help to see all available commands.";
			const text = fill(selfTemplate, [null, threadName || threadID])
				.replace(/\{prefix\}/g, String(config.prefix == null ? "-" : config.prefix));
			try {
				await message.send(text);
			}
			catch (error) {
				log.warn("JOIN", `Could not thank the inviter: ${error.message}`);
			}
		}
		if (!memberTargets.length) return;

		const template = settings.message || "Welcome %1 to %2! 👋";
		const seen = new Set();

		for (const target of memberTargets) {
			let username = target.username;
			let display = null;

			if (!username && target.userID) {
				try {
					const info = await new Promise((resolve, reject) =>
						api.getUserInfo(target.userID, (error, result) => error ? reject(error) : resolve(result)));
					const profile = info && info[target.userID];
					username = (profile && (profile.vanity || profile.username)) || null;
					display = profile && (profile.name || profile.firstName) || null;
				}
				catch (_) {  }
			}

			
			const handle = username ? "@" + String(username).replace(/^@/, "") : null;
			const mention = handle || display || target.userID;
			if (!mention) continue;
			if (seen.has(mention)) continue;
			seen.add(mention);

			try {
				await message.send(fill(template, [mention, threadName || threadID]));
			}
			catch (error) {
				log.warn("JOIN", `Could not welcome ${mention}: ${error.message}`);
			}
		}
	}
};
