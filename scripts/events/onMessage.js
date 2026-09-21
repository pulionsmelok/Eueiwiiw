"use strict";

module.exports = {
	config: {
		name: "onMessage",
		category: "system",

		eventType: ["message", "message_reply"]
	},

	onEvent: async function ({ event, threadsData }) {
		const patch = { lastActivity: Date.now() };
		if (event.isGroup != null) patch.isGroup = event.isGroup;
		if (Array.isArray(event.participantIDs) && event.participantIDs.length)
			patch.members = event.participantIDs.map(String);
		threadsData.update(event.threadID, patch);
	}
};
