"use strict";

const { createDatabase } = require("../../database/database");

module.exports = function loadData(config) {
	const database = createDatabase(config);
	if (typeof global !== "undefined" && global.db) {
		global.db.threadsData = database.threads;
		global.db.usersData = database.users;
	}
	return database;
};
