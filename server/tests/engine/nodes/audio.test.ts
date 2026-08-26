import { describe, it, expect, vi } from "vitest";
import { handleAudioNode, recordingSecondsOf } from "../../../src/engine/nodes/audio.js";
import type { NodeContext } from "../../../src/engine/types.js";

function makeContext(data: Record<string, unknown>): NodeContext {
  return {
    node: { id: "audio-1", type: "audio", data, position: { x: 0, y: 0 } },
    lead: {
      id: "lead-1", tenant_id: "t-1", bot_id: "b-1", telegram_user_id: 123,
      first_name: "Joao", last_name: null, username: null, tid: null, fbclid: null,
      utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
      current_flow_id: "f-1", current_node_id: "audio-1", active_flow_name: null, state: {},
      created_at: "", updated_at: "",
    },
    edges: [{ id: "e1", source: "audio-1", target: "node-next" }],
    telegram: {
      sendVoice: vi.fn().mockResolvedValue({ message_id: 55, chat: { id: 123 } }),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn(),
    } as any,
    chatId: 123,
  };
}

describe("recordingSecondsOf", () => {
  it("defaults to 2 seconds", () => {
    expect(recordingSecondsOf({})).toBe(2);
  });

  it("returns 0 when the simulation is turned off", () => {
    expect(recordingSecondsOf({ simulate_recording: false, recording_seconds: 5 })).toBe(0);
  });

  it("clamps to the 8s ceiling and rejects junk", () => {
    expect(recordingSecondsOf({ recording_seconds: 999 })).toBe(8);
    expect(recordingSecondsOf({ recording_seconds: -3 })).toBe(0);
    expect(recordingSecondsOf({ recording_seconds: "abc" })).toBe(0);
  });
});

describe("handleAudioNode", () => {
  it("sends the audio as a voice message and advances", async () => {
    const ctx = makeContext({
      audio_url: "https://cdn.test/audio.mp3",
      caption: "ouve isso",
      duration: 12,
      simulate_recording: false,
    });
    const result = await handleAudioNode(ctx);

    expect(ctx.telegram.sendVoice).toHaveBeenCalledWith({
      chatId: 123,
      voice: "https://cdn.test/audio.mp3",
      caption: "ouve isso",
      duration: 12,
    });
    // Simulação desligada = sem "gravando", mas o "enviando áudio…" continua
    // (cobre o tempo de conversão pra OPUS + upload).
    expect(ctx.telegram.sendChatAction).not.toHaveBeenCalledWith(123, "record_voice");
    expect(ctx.telegram.sendChatAction).toHaveBeenCalledWith(123, "upload_voice");
    expect(result.nextNodeId).toBe("node-next");
    expect(result.messageIds).toEqual([55]);
  });

  it("shows the recording indicator before sending", async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext({ audio_url: "https://cdn.test/audio.ogg", recording_seconds: 2 });
      const pending = handleAudioNode(ctx);
      await vi.runAllTimersAsync();
      await pending;
      expect(ctx.telegram.sendChatAction).toHaveBeenCalledWith(123, "record_voice");
      expect(ctx.telegram.sendVoice).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the node (without breaking the flow) when the url is invalid", async () => {
    const ctx = makeContext({ audio_url: "  ", simulate_recording: false });
    const result = await handleAudioNode(ctx);
    expect(ctx.telegram.sendVoice).not.toHaveBeenCalled();
    expect(result.nextNodeId).toBe("node-next");
  });
});
