"use strict";

const t = require("../../languages").text;

function resolveTarget(args, event) {
	if (args[0] && /^\d+$/.test(args[0])) return { id: String(args[0]), reason: args.slice(1).join(" ") };
	if (event.messageReply && event.messageReply.senderID)
		return { id: String(event.messageReply.senderID), reason: args.join(" ") };
	return { id: null, reason: null };
}

module.exports = {
	config: {
		name: "ban",
		author: "SK-SIDDIK-KHAN",
		version: "1.5.0",
		aliases: ["unban"],
		category: "admin",
		cooldown: 2,
		role: 2,
		noPrefix: true,
		description: { en: "Ban or unban a user from using the bot" },
		usage: { en: "{p}ban [userID] [reason] | {p}unban [userID]" }
	},

	onStart: async function ({ message, args, event, config, commandName, invokedAs, usersData }) {
		const lang = config.language;
		const { id, reason } = resolveTarget(args, event);
		if (!id)
			return message.reply("Provide a numeric user id, or reply to a user's message.");

		usersData.ensure(id, { userID: id });

		
		if ((invokedAs || commandName) === "unban") {
			usersData.update(id, { banned: { status: false, reason: null, date: null } });
			return message.reply(t(lang, "unbanSuccess", id));
		}

		usersData.update(id, { banned: { status: true, reason: reason || "—", date: Date.now() } });
		return message.reply(t(lang, "banSuccess", id, reason || "—"));
	}
};
