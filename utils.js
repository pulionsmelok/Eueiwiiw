"use strict";

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const MIME_EXT = {
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
	"video/mp4": "mp4",
	"video/quicktime": "mov",
	"video/webm": "webm",
	"audio/mpeg": "mp3",
	"audio/mp4": "m4a",
	"audio/aac": "aac",
	"audio/ogg": "ogg",
	"audio/wav": "wav"
};

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];
const VIDEO_EXT = ["mp4", "mov", "mkv", "webm", "avi"];
const AUDIO_EXT = ["mp3", "m4a", "aac", "ogg", "wav", "opus"];

function getType(value) {
	return Object.prototype.toString.call(value).slice(8, -1);
}

function isStream(value) {
	return Boolean(value) && typeof value === "object" && (value._readableState !== undefined || typeof value.pipe === "function");
}

function isBuffer(value) {
	return Buffer.isBuffer(value) || getType(value) === "Uint8Array";
}

function isUrl(value) {
	return typeof value === "string" && /^https?:\/\//i.test(value);
}

function extensionOf(source) {
	if (source == null) return "";
	if (typeof source === "string") {
		const clean = source.split("?")[0].split("#")[0];
		const dot = clean.lastIndexOf(".");
		return dot > -1 ? clean.slice(dot + 1).toLowerCase() : "";
	}
	return extensionOf(source.path || source.fileName || source.name || "");
}

function mediaKind(source) {
	if (source == null) return "image";
	if (typeof source === "object") {
		const mime = source.mimetype || source.mimeType || "";
		if (/^video\//i.test(mime)) return "video";
		if (/^audio\//i.test(mime)) return "audio";
		if (/^image\//i.test(mime)) return "image";
	}
	const ext = extensionOf(source);
	if (VIDEO_EXT.includes(ext)) return "video";
	if (AUDIO_EXT.includes(ext)) return "audio";
	if (IMAGE_EXT.includes(ext)) return "image";
	return "image";
}

function toSource(value) {
	if (value == null) return value;
	if (isUrl(value) || typeof value === "string" || isBuffer(value) || isStream(value)) return value;
	if (typeof value === "object") {
		if (value.url) return value.url;
		if (value.path) return value.path;
		if (value.buffer) return value.buffer;
		if (value.stream) return value.stream;
	}
	return value;
}

function download(url, options = {}) {
	return new Promise((resolve, reject) => {
		const client = url.startsWith("https:") ? https : http;
		const request = client.get(url, { headers: options.headers || {} }, response => {
			if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
				response.resume();
				return resolve(download(new URL(response.headers.location, url).toString(), options));
			}
			if (response.statusCode < 200 || response.statusCode >= 300) {
				response.resume();
				return reject(new Error(`Download failed with HTTP ${response.statusCode}`));
			}
			const chunks = [];
			response.on("data", chunk => chunks.push(chunk));
			response.on("end", () => resolve(Buffer.concat(chunks)));
			response.on("error", reject);
		});
		request.on("error", reject);
		request.setTimeout(options.timeout || 60000, () => request.destroy(new Error("Download timed out")));
	});
}

function extensionFromMime(mime) {
	if (!mime) return "bin";
	return MIME_EXT[String(mime).split(";")[0].trim().toLowerCase()] || "bin";
}

function randomString(length = 10, allow = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") {
	let out = "";
	for (let i = 0; i < length; i++)
		out += allow[Math.floor(Math.random() * allow.length)];
	return out;
}

function formatTime(milliseconds) {
	if (!milliseconds || milliseconds < 0) milliseconds = 0;
	const seconds = Math.floor(milliseconds / 1000);
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	const parts = [];
	if (days) parts.push(`${days}d`);
	if (hours || days) parts.push(`${hours}h`);
	if (minutes || hours || days) parts.push(`${minutes}m`);
	parts.push(`${secs}s`);
	return parts.join(" ");
}

function replaceArgs(template, ...args) {
	let text = String(template == null ? "" : template);
	args.forEach((value, index) => {
		text = text.split(`%${index + 1}`).join(value == null ? "" : String(value));
	});
	return text;
}

function isNumericID(value) {
	return value != null && String(value).length > 0 && !Number.isNaN(Number(value));
}

function instagramUsername(input) {
	if (input == null) return null;
	let value = String(input).trim();
	if (!value) return null;

	if (/^https?:\/\//i.test(value) || /^(www\.)?instagram\.com\//i.test(value)) {
		let url = value;
		if (!/^https?:\/\//i.test(url)) url = "https://" + url;
		try {
			const parsed = new URL(url);
			if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;
			const segment = parsed.pathname.split("/").filter(Boolean)[0] || "";
			const reserved = ["p", "reel", "reels", "stories", "explore", "tv", "accounts", "direct"];
			if (!segment || reserved.includes(segment.toLowerCase())) return null;
			return segment.replace(/^@/, "");
		}
		catch (_) {
			return null;
		}
	}

	if (/^@[A-Za-z0-9._]{1,30}$/.test(value)) return value.slice(1);

	return null;
}

const USERNAME_CACHE_FILE = path.join(__dirname, "..", "data", "username-cache.json");
let usernameCache = null;

function loadUsernameCache() {
	if (usernameCache) return usernameCache;
	try {
		usernameCache = JSON.parse(fs.readFileSync(USERNAME_CACHE_FILE, "utf8")) || {};
	}
	catch (_) {
		usernameCache = {};
	}
	return usernameCache;
}

function saveUsernameCache() {
	try {
		fs.mkdirSync(path.dirname(USERNAME_CACHE_FILE), { recursive: true });
		fs.writeFileSync(USERNAME_CACHE_FILE, JSON.stringify(usernameCache));
	}
	catch (_) { }
}

function cachedHandleForID(userID) {
	const wanted = String(userID || "");
	if (!wanted) return null;
	const cache = loadUsernameCache();
	for (const [handle, profile] of Object.entries(cache)) {
		if (profile && String(profile.userID) === wanted) return handle;
	}
	return null;
}

async function fetchInstagramProfile(username, timeout = 15000) {
	const handle = instagramUsername(username) || (username ? String(username).replace(/^@/, "") : null);
	if (!handle) return null;

	const cache = loadUsernameCache();
	const cached = cache[handle.toLowerCase()];
	if (cached && cached.userID) return Object.assign({}, cached);

	const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
	const headers = {
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
		"Accept": "application/json, text/plain, */*",
		"X-IG-App-ID": "936619743392459"
	};
	let buffer;
	try {
		buffer = await module.exports.download(url, { headers, timeout });
	}
	catch (_) {
		return null;
	}
	try {
		const data = JSON.parse(buffer.toString("utf8"));
		const user = data && data.data && data.data.user;
		if (!user) return null;
		const profile = {
			userID: user.id != null ? String(user.id) : null,
			username: user.username || handle,
			name: user.full_name || user.username || null,
			biography: user.biography || "",
			followers: user.edge_followed_by ? user.edge_followed_by.count : undefined,
			following: user.edge_follow ? user.edge_follow.count : undefined,
			posts: user.edge_owner_to_timeline_media ? user.edge_owner_to_timeline_media.count : undefined,
			isPrivate: !!user.is_private,
			isVerified: !!user.is_verified,
			profilePicture: user.profile_pic_url_hd || user.profile_pic_url || null
		};
		if (profile.userID) {
			cache[handle.toLowerCase()] = profile;
			saveUsernameCache();
		}
		return profile;
	}
	catch (_) {
		return null;
	}
}

async function resolveInstagramUserID(username, timeout = 15000) {
	const profile = await fetchInstagramProfile(username, timeout);
	return profile ? profile.userID : null;
}

function isRateLimitError(error) {
	const text = String(error && (error.error || error.message) || error);
	return /\b429\b|too many requests|rate.?limit|please wait|try again later|something went wrong/i.test(text);
}

async function resolveUserTarget(args, event, api) {
	if (event && event.messageReply && event.messageReply.senderID)
		return { id: String(event.messageReply.senderID), source: "reply" };

	const numeric = (args || []).find(arg => /^\d+$/.test(arg));
	if (numeric) return { id: String(numeric), source: "id" };

	const raw = (args || []).find(arg => /^@?[A-Za-z0-9._]{1,30}$/.test(arg) || /instagram\.com\//i.test(arg));
	const username = instagramUsername(raw) || (raw && /^@?[A-Za-z0-9._]{1,30}$/.test(raw) ? raw.replace(/^@/, "") : null);
	if (username) {
		let rateLimited = false;

		
		if (api) {
			try {
				const info = await new Promise((resolve, reject) =>
					api.getUserInfo(username, (error, result) => error ? reject(error) : resolve(result)));
				const profile = info && Object.values(info)[0];

				if (profile && profile.userID) {

					
					const cache = loadUsernameCache();
					cache[username.toLowerCase()] = {
						userID: String(profile.userID),
						username: profile.vanity || profile.username || username,
						name: profile.name || profile.firstName || null,
						biography: profile.biography || "",
						followers: profile.followerCount,
						following: profile.followingCount,
						isPrivate: profile.isPrivate,
						isVerified: profile.isVerified,
						profilePicture: profile.profilePicture || profile.thumbSrc || null
					};
					saveUsernameCache();
					return { id: String(profile.userID), source: "mention", profile };
				}
			}
			catch (error) {
				if (isRateLimitError(error)) rateLimited = true;
			}
		}

		
		if (!rateLimited) {
			const id = await resolveInstagramUserID(username);
			if (id) return { id, source: "mention" };
		}
		return { id: null, username, rateLimited };
	}

	return { id: null };
}

async function resolveProfile(args, event, api) {
	const target = await resolveUserTarget(args, event, api);
	if (!target.id) {
		return target.rateLimited ? { rateLimited: true } : null;
	}

	
	if (target.profile) {
		const p = target.profile;
		return {
			userID: String(p.userID || target.id),
			username: p.vanity || null,
			name: p.name || p.firstName || null,
			biography: p.biography || "",
			followers: p.followerCount,
			following: p.followingCount,
			posts: undefined,
			isPrivate: p.isPrivate,
			isVerified: p.isVerified,
			profilePicture: p.profilePicture || p.thumbSrc || null
		};
	}

	let rateLimited = false;
	let authenticated = null;

	const lookupAuthed = () => new Promise((resolve, reject) =>
		api.getUserInfo(String(target.id), (error, result) => error ? reject(error) : resolve(result)));
	if (api) {
		for (let attempt = 0; attempt < 2 && !authenticated; attempt++) {
			try {
				const info = await lookupAuthed();
				const profile = info && Object.values(info)[0];
				if (profile) {
					authenticated = {
						userID: String(profile.userID || target.id),
						username: profile.vanity || profile.username || null,
						name: profile.name || profile.firstName || null,
						biography: profile.biography || "",
						followers: profile.followerCount,
						following: profile.followingCount,
						posts: undefined,
						isPrivate: profile.isPrivate,
						isVerified: profile.isVerified,
						profilePicture: profile.profilePicture || profile.thumbSrc || null
					};
				}
			}
			catch (error) {
				if (isRateLimitError(error)) {
					rateLimited = true;

					if (attempt === 0) await new Promise(r => setTimeout(r, 1200));
				}
			}
		}
	}

	

	
	
	const incomplete = (p) => !p || p.followers == null || p.following == null || !p.biography;
	if (incomplete(authenticated)) {
		const raw = (args || []).find(arg => instagramUsername(arg) || /^@?[A-Za-z0-9._]{1,30}$/.test(arg) && !/^\d+$/.test(arg));
		const handle = (raw && (instagramUsername(raw) || raw.replace(/^@/, ""))) ||
			(authenticated && authenticated.username) ||

			cachedHandleForID(target.id) || null;
		if (handle) {
			const publicProfile = await fetchInstagramProfile(handle);
			const sameUser = publicProfile && String(publicProfile.userID) === String(target.id);
			if (publicProfile && (!authenticated || sameUser)) {

				
				return authenticated ? Object.assign({ }, authenticated, publicProfile) : publicProfile;
			}
		}
	}
	if (authenticated) return authenticated;

	const result = { userID: String(target.id) };
	if (rateLimited) result.rateLimited = true;
	return result;
}

module.exports = {
	getType,
	isStream,
	isBuffer,
	isUrl,
	isNumericID,
	extensionOf,
	extensionFromMime,
	mediaKind,
	toSource,
	download,
	randomString,
	formatTime,
	replaceArgs,
	instagramUsername,
	fetchInstagramProfile,
	resolveInstagramUserID,
	resolveUserTarget,
	resolveProfile,
	isRateLimitError,
	_resetUsernameCache() {
		usernameCache = {};
		try { fs.rmSync(USERNAME_CACHE_FILE, { force: true }); }
		catch (_) { }
	}
};
