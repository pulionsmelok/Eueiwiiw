"use strict";

process.on("unhandledRejection", (error) => console.error(error));
process.on("uncaughtException", (error) => console.error(error));

const path = require("path");
const fs = require("fs");
const log = require("./logger/logger");
const { loadConfig } = require("./bot/config");
const utils = require("./utils");

const dirConfig = path.normalize(path.join(__dirname, "config.json"));
const dirAccount = path.normalize(path.join(__dirname, "account.txt"));

global.GoatBot = {
	startTime: Date.now() - process.uptime() * 1000,
	commands: new Map(),
	eventCommands: new Map(),
	commandFilesPath: [],
	eventCommandsFilesPath: [],
	aliases: new Map(),
	onFirstChat: [],
	onChat: [],
	onEvent: [],
	onReply: new Map(),
	onReaction: new Map(),
	onAnyEvent: [],
	config: null,
	configCommands: null,
	envCommands: {},
	envEvents: {},
	envGlobal: {},
	botID: null,
	api: null,
	Listening: null
};

global.db = {
	allThreadData: [],
	allUserData: [],
	threadsData: null,
	usersData: null
};

global.client = {
	dirConfig,
	dirAccount,
	countDown: {},
	cache: {}
};

global.utils = utils;

let config;
let configCommands = {};
try {
	config = loadConfig();
	global.GoatBot.config = config;
	const dirConfigCommands = path.join(__dirname, "configCommands.json");
	if (fs.existsSync(dirConfigCommands)) {
		configCommands = JSON.parse(fs.readFileSync(dirConfigCommands, "utf8"));
	}
	global.GoatBot.configCommands = configCommands;
	global.GoatBot.envGlobal = configCommands.envGlobal || {};
	global.GoatBot.envCommands = configCommands.envCommands || {};
	global.GoatBot.envEvents = configCommands.envEvents || {};
}
catch (error) {
	log.error("CONFIG", error.message);
	process.exit(1);
}

const BANNER = [
	" ___           _        ____   ___ _____",
	"|_ _|_ __  ___| |_ __ _| __ ) / _ \\_   _|",
	" | || '_ \\/ __| __/ _` |  _ \\| | | || |",
	" | || | | \\__ \\ || (_| | |_) | |_| || |",
	"|___|_| |_|___/\\__\\__,_|____/ \\___/ |_|"
];

function printBanner() {
	log.plain("");
	for (const line of BANNER) log.plain(log.paint("magenta", line));
	log.plain("");
}

(async () => {
	printBanner();

	const login = require("./bot/login/login");

	try {
		const bot = await login();
		const shutdown = async (signal) => {
			log.warn("SYSTEM", `Received ${signal}; shutting down…`);
			if (bot && bot.stop) await bot.stop();
			process.exit(0);
		};
		process.once("SIGINT", () => shutdown("SIGINT"));
		process.once("SIGTERM", () => shutdown("SIGTERM"));
	}
	catch (error) {
		log.error("BOOT", "Failed to start (will keep the process alive)", error);
		await new Promise(() => { });
	}
})();
