"use strict";

const utils = require("../../utils");

function createMessageContext({ api, event, log }) {
	const threadID = event.threadID;
	const eventMessageID = event.messageID;

	function sendPlain(form, replyTarget) {
		const body = typeof form === "string" ? form : (form && form.body != null ? String(form.body) : "");
		const payload = { body };
		if (form && typeof form === "object") {
			if (form.url) payload.url = form.url;
			if (form.effect != null) payload.effect = form.effect;
			if (form.avatarEffect != null) payload.avatarEffect = form.avatarEffect;
		}
		return new Promise((resolve, reject) => {
			api.sendMessage(payload, threadID, (error, result) => error ? reject(error) : resolve(result), replyTarget);
		});
	}

	function sendWithMedia(form, replyTarget) {
		const sources = (Array.isArray(form.attachment) ? form.attachment : [form.attachment]).filter(Boolean);
		if (!sources.length) return sendPlain(form, replyTarget);

		

		
		const hasBody = form.body != null && String(form.body) !== "";
		const textFirst = hasBody && form.textFirst !== false;

		return new Promise((resolve, reject) => {
			let index = 0;
			let firstResult = null;
			let textResult = null;
			const sendMedia = () => {
				if (index >= sources.length) return resolve(textResult || firstResult);
				const current = index++;
				const raw = sources[current];
				const kind = utils.mediaKind(raw);
				const source = utils.toSource(raw);
				const caption = current === 0 && !textFirst && form.body != null ? String(form.body) : "";
				const done = (error, result) => {
					if (error) return reject(error);
					if (current === 0) firstResult = result;
					sendMedia();
				};
				try {

					
					if (kind === "video") {
						const videoReply = current === 0 ? replyTarget : undefined;
						return api.sendVideo(source, threadID, (error, result) => {
							if (error || !caption) return done(error, result);
							api.sendMessage({ body: caption }, threadID, () => done(null, result), videoReply);
						}, videoReply);
					}
					if (kind === "audio") {

						const audioReply = current === 0 ? replyTarget : undefined;
						return api.sendAudio(source, threadID, (error, result) => {
							if (error || !caption) return done(error, result);
							api.sendMessage({ body: caption }, threadID, () => done(null, result), audioReply);
						}, audioReply);
					}
					return api.sendImage(source, threadID, "", (error, result) => {
						if (error || !caption) return done(error, result);
						api.sendMessage({ body: caption }, threadID, () => done(null, result), current === 0 ? replyTarget : undefined);
					}, current === 0 ? replyTarget : undefined);
				}
				catch (error) {
					return reject(error);
				}
			};
			if (!textFirst) return sendMedia();
			
			api.sendMessage({ body: String(form.body) }, threadID, (error, result) => {
				if (error) return reject(error);
				textResult = result;
				sendMedia();
			}, replyTarget);
		});
	}

	function dispatch(form, replyTarget) {
		if (form == null) return Promise.reject(new Error("Nothing to send"));
		if (typeof form === "object" && !Array.isArray(form) && form.attachment != null)
			return sendWithMedia(form, replyTarget);
		return sendPlain(form, replyTarget);
	}

	const context = {
		threadID,
		event,

		send(form, callback) {
			if (typeof callback === "function")
				return dispatch(form, undefined).then(r => callback(null, r), e => callback(e));
			return dispatch(form, undefined);
		},

		reply(form, callback) {
			if (typeof callback === "function")
				return dispatch(form, eventMessageID).then(r => callback(null, r), e => callback(e));
			return dispatch(form, eventMessageID);
		},

		unsend(messageID = eventMessageID, callback) {
			if (typeof callback === "function")
				return api.unsendMessage(messageID, threadID, callback);
			return new Promise((resolve, reject) => {
				api.unsendMessage(messageID, threadID, (error, result) => error ? reject(error) : resolve(result));
			});
		},

		react(emoji, messageID = eventMessageID, callback) {
			const reaction = emoji == null ? "" : emoji;
			if (typeof callback === "function")
				return api.setMessageReaction(reaction, messageID, threadID, callback);
			return new Promise((resolve, reject) => {
				api.setMessageReaction(reaction, messageID, threadID, (error, result) => error ? reject(error) : resolve(result));
			});
		},

		effect(text, effect, callback) {
			if (typeof callback === "function")
				return api.sendTextEffect(text, threadID, effect, callback);
			return new Promise((resolve, reject) => {
				api.sendTextEffect(text, threadID, effect, (error, result) => error ? reject(error) : resolve(result));
			});
		},

		avatarEffect(text, effect, callback) {

			

			
			
			const attempt = new Promise((resolve, reject) => {
				api.sendAvatarTextEffect(text, threadID, effect, (error, result) => error ? reject(error) : resolve(result));
			});
			if (typeof callback === "function")
				attempt.then(result => callback(null, result), error => callback(error));
			return attempt;
		},

		music(track, callback) {
			if (typeof callback === "function")
				return api.sendMusic(threadID, track, callback);
			return new Promise((resolve, reject) => {
				api.sendMusic(threadID, track, (error, result) => error ? reject(error) : resolve(result));
			});
		},

		musicSearch(query, callback) {
			if (typeof callback === "function")
				return api.musicSearch(query, callback);
			return new Promise((resolve, reject) => {
				api.musicSearch(query, (error, result) => error ? reject(error) : resolve(result));
			});
		},

		typing() {
			return api.sendTypingIndicator(threadID, () => { });
		}
	};

	return context;
}

module.exports = { createMessageContext };
