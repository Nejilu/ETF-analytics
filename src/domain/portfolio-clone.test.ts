import assert from "node:assert/strict";
import test from "node:test";
import { buildCloneAllocation, validateCloneDraft, type PortfolioCloneDraft, type CloneSourceComposition } from "./portfolio-clone";

const source = (id: string, weights: Array<[string, number]>): CloneSourceComposition => ({ id, ticker: id, name: id, asOf: "2026-10-09", positions: weights.map(([securityId, weight]) => ({ securityId, weight })) });
test("blends sources in the chosen currency, merges overlap and preserves unallocated cash", () => {
  const draft: PortfolioCloneDraft = { amount: 100_000, currency: "EUR", sources: [{ sourceId: "portfolio", allocation: 50 }, { sourceId: "ETF", allocation: 40 }] };
  const compositions = [source("portfolio", [["A", 50], ["B", 25]]), source("ETF", [["A", 60], ["C", 40]])];
  const frozen = JSON.stringify(compositions);
  const allocation = buildCloneAllocation(draft, compositions, 1.2);
  assert.deepEqual(allocation.positions, [{ securityId: "A", valueUsd: 58_800 }, { securityId: "B", valueUsd: 15_000 }, { securityId: "C", valueUsd: 19_200 }]);
  assert.equal(allocation.cashAmount, 22_500);
  assert.deepEqual(allocation.sources.map((entry) => entry.amount), [50_000, 40_000]);
  assert.equal(JSON.stringify(compositions), frozen);
  assert.ok(allocation.positions.every((position) => !["portfolio", "ETF"].includes(position.securityId)));
});
test("preserves shorts and leveraged financing instead of normalizing them away", () => {
  const allocation = buildCloneAllocation({ amount: 50_000, currency: "USD", sources: [{ sourceId: "leveraged", allocation: 100 }] }, [source("leveraged", [["A", 250], ["B", -50]])], 1);
  assert.deepEqual(allocation.positions.map((entry) => entry.valueUsd), [125_000, -25_000]);
  assert.equal(allocation.cashAmount, -50_000);
  assert.equal(allocation.positions.reduce((sum, position) => sum + position.valueUsd, allocation.cashAmount), 50_000);
});
test("nets matching long and short positions before creating quantities", () => {
  const allocation = buildCloneAllocation({ amount: 10_000, currency: "USD", sources: [{ sourceId: "long", allocation: 50 }, { sourceId: "short", allocation: 50 }] }, [source("long", [["A", 100]]), source("short", [["A", -100]])], 1);
  assert.deepEqual(allocation.positions, []);
  assert.equal(allocation.cashAmount, 10_000);
});
test("validates amounts, allocations, source references and currencies before loading data", () => {
  const valid: PortfolioCloneDraft = { amount: 50_000, currency: "USD", sources: [{ sourceId: "a", allocation: 100 }] };
  for (const amount of [0, -1, NaN, Infinity]) assert.throws(() => validateCloneDraft({ ...valid, amount }));
  for (const allocation of [0, -1, NaN, Infinity, 101]) assert.throws(() => validateCloneDraft({ ...valid, sources: [{ sourceId: "a", allocation }] }));
  assert.throws(() => validateCloneDraft({ ...valid, sources: [{ sourceId: "a", allocation: 60 }, { sourceId: "b", allocation: 60 }] }));
  assert.throws(() => validateCloneDraft({ ...valid, sources: [{ sourceId: "a", allocation: 50 }, { sourceId: "a", allocation: 50 }] }));
  assert.throws(() => validateCloneDraft({ ...valid, currency: "XXX" as "USD" }));
  assert.throws(() => validateCloneDraft({ ...valid, sources: [] }));
  assert.throws(() => buildCloneAllocation(valid, [], 1));
  assert.throws(() => buildCloneAllocation(valid, [source("a", [["X", 100]])], 0));
  assert.equal(buildCloneAllocation(valid, [source("a", Array.from({ length: 501 }, (_, index) => [`s${index}`, 100 / 501]))], 1).positions.length, 501);
});
