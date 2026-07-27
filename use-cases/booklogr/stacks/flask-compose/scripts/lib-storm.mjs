export function mergeNotifications(payloads) {
	if (payloads.length === 0) return null;

	const alertsMap = new Map();
	for (const p of payloads) {
		if (!p.alerts || !Array.isArray(p.alerts)) continue;
		for (const a of p.alerts) {
			let key = a.fingerprint;
			if (!key) {
				const labels = a.labels || {};
				const labelPairs = Object.entries(labels).sort((x, y) =>
					x[0].localeCompare(y[0]),
				);
				key = JSON.stringify(labelPairs);
			}
			if (!alertsMap.has(key)) {
				alertsMap.set(key, a);
			} else {
				// Keep the earliest activeAt if possible? The spec says deduped, doesn't specify which one to keep, let's keep the first seen
			}
		}
	}

	return {
		schema_version: "storm-capture.v1",
		notifications: payloads,
		alerts: Array.from(alertsMap.values()),
	};
}

export function parseCaptureFile(raw) {
	const parts = raw.split("\x1e").map(s => s.trim()).filter(s => s.length > 0);
	return parts.map((part, index) => {
		try {
			return JSON.parse(part);
		} catch (e) {
			throw new Error(`failed to parse part at index ${index}: ${e.message}`);
		}
	});
}

export function parseTriageFeed(raw) {
	const lines = raw.split("\n").map(s => s.trim()).filter(s => s.length > 0);
	const results = [];
	for (let i = 0; i < lines.length; i++) {
		try {
			results.push(JSON.parse(lines[i]));
		} catch (e) {
			console.warn(`parseTriageFeed: skipping bad line ${i}: ${e.message}`);
		}
	}
	return results;
}
