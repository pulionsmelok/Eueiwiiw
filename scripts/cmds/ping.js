"use strict";

const t = require("../../languages").text;

module.exports = {
	config: {
		name: "ping",
		author: "SK-SIDDIK-KHAN",
		version: "1.5.0",
		aliases: ["pong"],
		category: "info",
		cooldown: 2,
		role: 0,
		description: { en: "Check whether the bot is online" },
		usage: { en: "{p}ping" }
	},

	onStart: async function ({ message, config }) {
		const start = Date.now();
		await message.reply(t(config.language, "pingProcessing"));
		return message.send(t(config.language, "pingResult", Date.now() - start));
	}
};
