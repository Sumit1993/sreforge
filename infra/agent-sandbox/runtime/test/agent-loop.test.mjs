import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDegradation } from "../agent-loop.mjs";

describe("adaptive degradation unit tests (#35)", () => {
	it("1. below threshold -> shouldDegrade: false", () => {
		const res = computeDegradation({
			currentWindow: 22,
			currentOutMax: 3000,
			windowFloor: 6,
			outMaxFloor: 500,
			consecutive500s: 1,
			degradationCount: 0,
			maxDegradations: 3,
			degradeThreshold: 2,
		});
		assert.equal(res.shouldDegrade, false);
		assert.equal(res.reason, "below_threshold");
	});

	it("2. threshold hit -> shouldDegrade: true, parameters halved", () => {
		const res = computeDegradation({
			currentWindow: 22,
			currentOutMax: 3000,
			windowFloor: 6,
			outMaxFloor: 500,
			consecutive500s: 2,
			degradationCount: 0,
			maxDegradations: 3,
			degradeThreshold: 2,
		});
		assert.equal(res.shouldDegrade, true);
		assert.equal(res.newWindow, 11);
		assert.equal(res.newOutMax, 1500);
		assert.equal(res.degradationStep, 1);
	});

	it("3. halving respects floors", () => {
		const res = computeDegradation({
			currentWindow: 7,
			currentOutMax: 600,
			windowFloor: 6,
			outMaxFloor: 500,
			consecutive500s: 2,
			degradationCount: 1,
			maxDegradations: 3,
			degradeThreshold: 2,
		});
		assert.equal(res.shouldDegrade, true);
		assert.equal(res.newWindow, 6); // max(6, floor(7/2)=3) = 6
		assert.equal(res.newOutMax, 500); // max(500, floor(600/2)=300) = 500
		assert.equal(res.degradationStep, 2);
	});

	it("4. max degradations reached -> shouldDegrade: false", () => {
		const res = computeDegradation({
			currentWindow: 12,
			currentOutMax: 1000,
			windowFloor: 6,
			outMaxFloor: 500,
			consecutive500s: 2,
			degradationCount: 3,
			maxDegradations: 3,
			degradeThreshold: 2,
		});
		assert.equal(res.shouldDegrade, false);
		assert.equal(res.reason, "max_degradations_reached");
	});

	it("5. parameters at floors -> shouldDegrade: false", () => {
		const res = computeDegradation({
			currentWindow: 6,
			currentOutMax: 500,
			windowFloor: 6,
			outMaxFloor: 500,
			consecutive500s: 2,
			degradationCount: 1,
			maxDegradations: 3,
			degradeThreshold: 2,
		});
		assert.equal(res.shouldDegrade, false);
		assert.equal(res.reason, "at_floors");
	});
});
