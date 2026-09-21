"use strict";

const t = require("../../languages").text;
const { resolveUserTarget } = require("../../utils");

module.exports = {
	config: {
		name: "adduser",
		author: "SK-SIDDIK-KHAN",
		version: "1.5.0",
		aliases: ["addtouser", "addmember"],
		category: "admin",
		cooldown: 2,
		role: 2,
		noPrefix: true,
		description: { en: "Add a user to the current thread" },
		usage: { en: "{p}adduser <userID | @handle | username | profile URL> — or reply to a message" }
	},

	onStart: async function ({ message, args, event, config, api }) {
		const lang = config.language;
		if (!event.isGroup)
			return message.reply("This command only works in a group thread.");

		const target = await resolveUserTarget(args, event, api);
		if (!target.id) {
			if (target.rateLimited)
				return message.reply("Instagram is rate-limiting lookups right now. Please try again in a few minutes.");
			if (target.username)
				return message.reply(`Could not find @${target.username}.`);
			return message.reply("Provide a numeric user id or @mention, or reply to a user's message.");
		}

		try {
			await new Promise((resolve, reject) =>
				api.addUserToThread(target.id, event.threadID, (error, result) => error ? reject(error) : resolve(result)));
		}
		catch (error) {
			return message.reply(`Could not add ${target.id} to the thread. (${error.message || error})`);
		}

		return message.reply(t(lang, "addUserSuccess", target.id));
	}
};
