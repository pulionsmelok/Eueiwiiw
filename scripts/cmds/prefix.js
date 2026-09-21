"use strict";

const t = require("../../languages").text;
const { saveConfig } = require("../../bot/config");

const ROLE_ADMIN_BOT = 2;

module.exports = {
	config: {
		name: "prefix",
		author: "SK-SIDDIK-KHAN",
		version: "1.5.0",
		aliases: ["setprefix"],
		category: "admin",
		cooldown: 2,
		role: 0,
		noPrefix: true,
		noPrefixRole: 0,
		description: { en: "Show the command prefix (bot admins can change it)" },
		usage: { en: "{p}prefix [newPrefix] — or just `prefix` / `prefix !`" }
	},

	onStart: async function ({ message, args, config, role }) {
		const lang = config.language;

		if (!args.length)
			return message.reply(t(lang, "prefixCurrent", config.prefix));

		
		
		if (Number(role) < ROLE_ADMIN_BOT)
			return message.reply(t(lang, "prefixOnlyAdmin", config.prefix));

		const next = args[0];
		if (next.length > 3)
			return message.reply("The prefix must be 1–3 characters.");
		config.prefix = next;
		saveConfig(config);
		return message.reply(t(lang, "prefixChanged", next));
	}
};
