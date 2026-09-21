"use strict";

const util = require("util");

function chunk(text, size = 1500) {
	const parts = [];
	for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
	return parts.length ? parts : [""];
}

function render(value) {
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "function")
		return value.toString();
	if (value instanceof Map) {
		const object = {};
		value.forEach((v, k) => { object[k] = v; });
		return `Map(${value.size}) ` + JSON.stringify(object, null, 2);
	}
	if (typeof value === "undefined") return "undefined";
	if (typeof value === "object" && value !== null) {
		if (value instanceof Error) return value.stack || String(value);
		try { return JSON.stringify(value, null, 2); }
		catch (_) { return util.inspect(value, { depth: 2 }); }
	}
	return String(value);
}

module.exports = {
	config: {
		name: "eval",
		author: "SK-SIDDIK-KHAN",
		version: "1.5.0",
		aliases: ["ev", "js"],
		category: "admin",
		cooldown: 0,
		role: 2,
		noPrefix: true,
		hidden: true,
		description: { en: "Evaluate JavaScript in the bot process" },
		usage: { en: "{p}eval <code>" }
	},

	onStart: async function (ctx) {
		const { message, args, api, event, config, registry, usersData, threadsData } = ctx;
		const log = require("../../logger/logger");
		if (!args.length) return message.reply("Usage: eval <code>");

		const code = args.join(" ");
		let sent = false;

		async function output(value) {
			sent = true;
			const text = render(value);
			for (const part of chunk(text)) await message.reply(part);
		}

		const sandbox = {
			api,
			message,
			event,
			args,
			config,
			registry,
			usersData,
			threadsData,
			commandName: ctx.commandName,
			role: ctx.role,
			out: output,
			output,
			module: { exports: {} },
			exports: {},
			require,
			console,
			Buffer,
			process,
			setTimeout,
			setInterval,
			clearTimeout,
			clearInterval
		};
		const names = Object.keys(sandbox);
		const values = names.map(key => sandbox[key]);

		
		const looksLikeStatement = /^(const|let|var|return|if|for|while|switch|try|throw|class|function|async)\b/.test(code) || code.includes(";");
		const body = looksLikeStatement || code.includes("await") ? code : `return (${code})`;

		let result;
		try {
			const fn = new Function(...names, `"use strict"; return (async () => { ${body} })();`);
			result = await fn(...values);
		}
		catch (error) {
			log.error("eval command", error);
			return output((error && error.stack) ? error.stack : String(error));
		}

		if (!sent && typeof result !== "undefined") await output(result);
		else if (!sent) return message.reply("undefined");
	}
};
