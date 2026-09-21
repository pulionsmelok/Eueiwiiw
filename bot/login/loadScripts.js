"use strict";

const fs = require("fs");
const path = require("path");
const log = require("../../logger/logger");

const ROOT = path.resolve(__dirname, "../..");

const REQUIRED = ["name", "category"];

function validate(script, file, type) {
	if (!script || typeof script !== "object")
		throw new Error(`${file}: ${type} must export an object`);
	if (typeof script.config !== "object" || !script.config)
		throw new Error(`${file}: missing "config" object`);
	for (const key of REQUIRED) {
		if (!script.config[key])
			throw new Error(`${file}: config.${key} is required`);
	}
	if (typeof script.onStart !== "function" && typeof script.onEvent !== "function")
		throw new Error(`${file}: define onStart (commands) or onEvent (events)`);
}

function loadDirectory(dirName, type) {
	const dir = path.join(ROOT, dirName);
	if (!fs.existsSync(dir)) return [];
	const results = [];
	for (const file of fs.readdirSync(dir).sort()) {
		if (!file.endsWith(".js") || file.endsWith(".eg.js")) continue;
		const full = path.join(dir, file);
		try {
			delete require.cache[require.resolve(full)];
			const script = require(full);
			validate(script, file, type);
			script.location = full;
			results.push({ file, script, commandName: script.config.name });
		}
		catch (error) {
			log.error("LOADER", `Could not load ${type} ${file}`, error);
		}
	}
	return results;
}

function createRegistry() {
	return {
		commands: new Map(),
		aliases: new Map(),
		events: [],

		registerCommand(entry) {
			const name = entry.script.config.name.toLowerCase();
			if (this.commands.has(name))
				return `command "${name}" already exists`;
			this.commands.set(name, entry.script);
			this.aliases.set(name, name);
			for (const alias of entry.script.config.aliases || []) {
				const key = String(alias).toLowerCase();
				if (!this.aliases.has(key)) this.aliases.set(key, name);
			}
			return null;
		},

		unregisterCommand(name) {
			const key = String(name || "").toLowerCase();
			const canonical = this.aliases.get(key);
			if (!canonical) return false;
			this.commands.delete(canonical);
			for (const [alias, target] of this.aliases) {
				if (target === canonical) this.aliases.delete(alias);
			}
			return true;
		},

		unregisterEvent(name) {
			const key = String(name || "").toLowerCase();
			const index = this.events.findIndex(script => String(script.config.name).toLowerCase() === key);
			if (index === -1) return false;
			this.events.splice(index, 1);
			return true;
		},

		resolve(name) {
			if (!name) return null;
			const key = String(name).toLowerCase();
			const canonical = this.aliases.get(key);
			return canonical ? this.commands.get(canonical) : null;
		}
	};
}

function loadAll(registry) {
	registry.commands.clear();
	registry.aliases.clear();
	registry.events.length = 0;

	let commandCount = 0;
	let eventCount = 0;

	for (const entry of loadDirectory("scripts/cmds", "command")) {
		const error = registry.registerCommand(entry);
		if (error) {
			log.warn("LOADER", error);
			continue;
		}
		commandCount++;
	}

	for (const entry of loadDirectory("scripts/events", "event")) {
		registry.events.push(entry.script);
		eventCount++;
	}

	if (typeof global !== "undefined" && global.GoatBot) {
		global.GoatBot.commands = registry.commands;
		global.GoatBot.aliases = registry.aliases;
		global.GoatBot.eventCommands = new Map(
			registry.events.map(script => [String(script.config.name).toLowerCase(), script])
		);
		global.GoatBot.onChat = registry.events
			.filter(s => s.config && s.config.eventType === "message")
			.map(s => s.config.name);
		global.GoatBot.onEvent = registry.events.map(s => s.config.name);
	}

	log.success("LOADED", `commands: ${commandCount}, events: ${eventCount}`);
	return { commandCount, eventCount };
}

module.exports = { createRegistry, loadAll, loadDirectory, validate };
