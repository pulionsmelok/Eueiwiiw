"use strict";

const { resolveUserTarget } = require("../../utils");

module.exports = {
	config: {
		name: "uid",
		author: "SK-SIDDIK-KHAN",
		version: "1.5.0",
		aliases: ["id"],
		category: "info",
		cooldown: 2,
		role: 0,
		description: { en: "Return an Instagram numeric user id" },
		usage: { en: "{p}uid [userID | @handle | username | profile URL] — or reply to a message" }
	},

	onStart: async function ({ message, args, event, api }) {
		
		const target = await resolveUserTarget(args, event, api);
		if (target.id) return message.reply(String(target.id));
		if (target.rateLimited) return message.reply("Instagram is rate-limiting lookups right now. Please try again in a few minutes.");
		if (target.username) return message.reply(`Could not find @${target.username}.`);
		return message.reply(String(event.senderID));
	}
};
