"use strict";

module.exports = {
	config: {
		name: "unsend",
		author: "SK-SIDDIK-KHAN",
		version: "1.5.0",
		aliases: ["uns", "delete", "del"],
		category: "utility",
		cooldown: 1,
		role: 0,
		description: { en: "Unsend a message: reply to any message and the bot removes it" },
		usage: { en: "Reply to a message with {p}unsend" }
	},

	onStart: async function ({ message, event, api }) {
		const replied = event.messageReply;
		if (!replied || !replied.messageID) return;

		const threadID = event.threadID;
		const target = replied.messageID;

		try {
			await new Promise((resolve, reject) => {
				api.unsendMessage(target, threadID, (error, result) => error ? reject(error) : resolve(result));
			});
		}
		catch (_) { }
	}
};
