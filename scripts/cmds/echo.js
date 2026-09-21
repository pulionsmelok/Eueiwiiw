"use strict";

const t = require("../../languages").text;

module.exports = {
	config: {
		name: "echo",
		author: "SK-SIDDIK-KHAN",
		version: "1.5.0",
		aliases: ["say"],
		category: "utility",
		cooldown: 2,
		role: 0,
		description: { en: "Repeat whatever you type after the command" },
		usage: { en: "{p}echo <text>" }
	},

	onStart: async function ({ message, args, config }) {
		if (!args.length)
			return message.reply(t(config.language, "echoEmpty"));
		return message.reply(args.join(" "));
	}
};
