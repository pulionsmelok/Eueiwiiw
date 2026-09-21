"use strict";

const t = require("../../languages").text;

module.exports = {
	config: {
		name: "joke",
		author: "SK-SIDDIK-KHAN",
		version: "1.5.0",
		aliases: ["dadjoke"],
		category: "fun",
		cooldown: 3,
		role: 0,
		description: { en: "Tell a random joke" },
		usage: { en: "{p}joke" }
	},

	onStart: async function ({ message, config }) {
		try {
			const response = await fetch("https://official-joke-api.appspot.com/random_joke", { signal: AbortSignal.timeout(10000) });
			const data = await response.json();
			if (!data || !data.setup)
				throw new Error("Empty response");
			return message.reply(`${data.setup}\n\n… ${data.punchline}`);
		}
		catch (error) {
			return message.reply(t(config.language, "errorOccurred", "joke", error.message));
		}
	}
};
