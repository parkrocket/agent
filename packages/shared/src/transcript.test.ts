import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAgentId, parseUsageLine } from "./transcript";
import { formatTokens, mergeModelConfig, messageCost, promptTokens, resolveModel, type ModelConfig } from "./models";

const SECRET = "SECRET-PROMPT-TEXT-7f3a";

/** A fake assistant line shaped like Claude Code's, with secrets in every free-text field. */
function assistantLine(over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "assistant",
    sessionId: "sess-1",
    timestamp: "2026-10-24T10:00:00.000Z",
    uuid: "u1",
    cwd: "/home/u/proj",
    lastPrompt: SECRET,
    attachment: { text: SECRET },
    rendered: [{ content: SECRET }],
    wireToolInputs: { t1: { command: SECRET } },
    toolUseResult: { stdout: SECRET },
    message: {
      id: "msg_1",
      role: "assistant",
      type: "message",
      model: "claude-opus-5-5",
      content: [
        { type: "text", text: SECRET },
        { type: "thinking", thinking: SECRET, signature: SECRET },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: SECRET } },
      ],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 12,
        output_tokens: 340,
        cache_read_input_tokens: 50_000,
        cache_creation_input_tokens: 3_000,
        cache_creation: { ephemeral_5m_input_tokens: 1_000, ephemeral_1h_input_tokens: 2_000 },
        service_tier: "standard",
        ...usage,
      },
    },
    ...over,
  });
}

test("extracts only usage metadata; no free text survives", () => {
  const r = parseUsageLine(assistantLine());
  assert.ok(r);
  assert.deepEqual(r, {
    messageId: "msg_1",
    sessionId: "sess-1",
    model: "claude-opus-5-5",
    ts: Date.parse("2026-10-24T10:00:00.000Z"),
    tokens: { input: 12, output: 340, cacheRead: 50_000, cacheWrite5m: 1_000, cacheWrite1h: 2_000 },
    cwd: "/home/u/proj",
  });
  assert.ok(!JSON.stringify(r).includes(SECRET));
});

test("sub-agent lines keep the agent id without an agent- prefix", () => {
  assert.equal(parseUsageLine(assistantLine({ agentId: "a1b2c3", isSidechain: true }))!.agentId, "a1b2c3");
  assert.equal(parseUsageLine(assistantLine({ agentId: "agent-a1b2c3" }))!.agentId, "a1b2c3");
  assert.equal(normalizeAgentId("agent-xyz"), "xyz");
  assert.equal(normalizeAgentId("xyz"), "xyz");
});

test("ignores non-assistant lines, unknown types and malformed input", () => {
  for (const line of [
    "",
    "not json",
    '{"type":"assistant","message":{"usage":',
    JSON.stringify({ type: "user", message: { role: "user", content: SECRET, usage: {} } }),
    JSON.stringify({ type: "api-request", usage: { input_tokens: 5 } }),
    JSON.stringify({ type: "some-future-type", message: { usage: { input_tokens: 1 } } }),
    assistantLine({ sessionId: undefined }),
    assistantLine({ timestamp: "yesterday-ish" }),
    assistantLine({ message: { id: "m", role: "assistant", usage: {} } }), // no model
    assistantLine({ message: { id: "bad id with spaces", role: "assistant", model: "x", usage: {} } }),
  ]) {
    assert.equal(parseUsageLine(line), null, line.slice(0, 60));
  }
});

test("odd numbers count as zero; cache writes without a TTL breakdown count as 5-minute writes", () => {
  const r = parseUsageLine(assistantLine({}, { input_tokens: -5, output_tokens: 1.5, cache_read_input_tokens: "9", cache_creation: undefined }))!;
  assert.deepEqual(r.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 3_000, cacheWrite1h: 0 });
  const mismatched = parseUsageLine(assistantLine({}, { cache_creation: { ephemeral_5m_input_tokens: 1, ephemeral_1h_input_tokens: 1 } }))!;
  assert.deepEqual([mismatched.tokens.cacheWrite5m, mismatched.tokens.cacheWrite1h], [3_000, 0], "breakdown that doesn't add up is not trusted");
});

test("a model name that isn't a short identifier is rejected", () => {
  assert.equal(parseUsageLine(assistantLine({ message: { id: "m", role: "assistant", model: SECRET + " " + SECRET, usage: { input_tokens: 1 } } })), null);
});

const config: ModelConfig = {
  defaultContextLimit: 200_000,
  models: {
    "claude-opus-5-5": { contextLimit: 1_000_000, contextVerified: true, price: { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 } },
    "claude-haiku-5-5": {
      contextLimit: 1_000_000,
      contextVerified: true,
      price: { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },
      priceOverThreshold: { promptTokens: 100_000, input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 },
    },
  },
};

test("resolveModel tolerates suffixes and falls back to an unverified default", () => {
  assert.equal(resolveModel(config, "claude-opus-5-5[1m]").key, "claude-opus-5-5");
  assert.equal(resolveModel(config, "claude-opus-5-5-20260101").key, "claude-opus-5-5");
  const unknown = resolveModel(config, "claude-mystery-9");
  assert.deepEqual([unknown.key, unknown.contextLimit, unknown.contextVerified], [undefined, 200_000, false]);
});

test("costs use per-request threshold pricing", () => {
  const small = { input: 1_000, output: 1_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
  const big = { input: 1_000, output: 1_000, cacheRead: 150_000, cacheWrite5m: 0, cacheWrite1h: 0 };
  const haiku = resolveModel(config, "claude-haiku-5-5");
  assert.ok(Math.abs(messageCost(haiku, small)! - (1_000 * 0.1 + 1_000 * 0.5) / 1e6) < 1e-12);
  assert.ok(promptTokens(big) > 100_000);
  assert.ok(Math.abs(messageCost(haiku, big)! - (1_000 * 0.5 + 150_000 * 0.05 + 1_000 * 2.5) / 1e6) < 1e-12);
  assert.equal(messageCost(resolveModel(config, "unknown"), small), undefined);
});

test("user overrides merge per model and per price field", () => {
  const merged = mergeModelConfig(config, {
    pricesAsOf: "2027-01-01",
    models: { "claude-opus-5-5": { contextLimit: 500_000, contextVerified: false, price: { output: 30 } as never }, "my-model": { contextLimit: 64_000, contextVerified: true } },
  });
  assert.equal(merged.pricesAsOf, "2027-01-01");
  assert.equal(merged.models["claude-opus-5-5"]!.contextLimit, 500_000);
  assert.equal(merged.models["claude-opus-5-5"]!.price!.output, 30);
  assert.equal(merged.models["claude-opus-5-5"]!.price!.input, 4, "unspecified price fields keep their defaults");
  assert.equal(merged.models["my-model"]!.contextLimit, 64_000);
});

test("formatTokens", () => {
  assert.deepEqual([0, 999, 1_234, 12_345, 120_000, 1_000_000, 1_234_567, 12_500_000].map(formatTokens), [
    "0", "999", "1.2K", "12K", "120K", "1M", "1.23M", "12.5M",
  ]);
});
