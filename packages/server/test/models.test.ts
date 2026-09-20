import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.MODEL_ID = "test-model";
process.env.VERTEX_PROJECT = "proj-123";
process.env.VERTEX_LOCATION = "global";
process.env.ZAI_API_KEY = "zai-secret";
process.env.ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";
process.env.LLM_MAX_RETRIES = "2";
process.env.RETRY_BASE_MS = "1";
process.env.LLM_TIMEOUT_MS = "1000";
process.env.LOG_LEVEL = "error";

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getAccessToken() {
      return "fake-adc-token";
    }
  },
}));

const { chatUrl, VertexModel } = await import("../src/models/vertex.js");
const { ZaiModel } = await import("../src/models/zai.js");
const { resetEnvCache } = await import("../src/config/load.js");

function chatOk(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }),
    { status: 200 },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("chatUrl", () => {
  it("uses the global host for the global location", () => {
    expect(chatUrl("p", "global")).toBe(
      "https://aiplatform.googleapis.com/v1beta1/projects/p/locations/global/endpoints/openapi/chat/completions",
    );
  });
  it("uses a regional host otherwise", () => {
    expect(chatUrl("p", "us-central1")).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/p/locations/us-central1/endpoints/openapi/chat/completions",
    );
  });
});

describe("ZaiModel", () => {
  it("posts system+user to the z.ai endpoint with a bearer key", async () => {
    fetchMock.mockResolvedValueOnce(chatOk("hello from glm"));
    const res = await new ZaiModel().generate({ system: "S", user: "U" });

    expect(res).toMatchObject({ text: "hello from glm", channel: "zai", model: "test-model" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer zai-secret" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "U" },
    ]);
  });
});

describe("VertexModel", () => {
  it("posts to the openapi endpoint with an ADC bearer token", async () => {
    fetchMock.mockResolvedValueOnce(chatOk("hello from vertex"));
    const res = await new VertexModel().generate({ system: "S", user: "U" });

    expect(res.text).toBe("hello from vertex");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/locations/global/endpoints/openapi/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer fake-adc-token" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("retries a 500 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("upstream", { status: 500 }))
      .mockResolvedValueOnce(chatOk("recovered"));
    const res = await new VertexModel().generate({ system: "S", user: "U" });
    expect(res.text).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 and surfaces the status", async () => {
    fetchMock.mockResolvedValue(new Response("bad model", { status: 400 }));
    await expect(new VertexModel().generate({ system: "S", user: "U" })).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws on an empty completion", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }),
    );
    await expect(new VertexModel().generate({ system: "S", user: "U" })).rejects.toThrow(/empty completion/);
  });
});

describe("getModel factory", () => {
  afterEach(() => resetEnvCache());

  it("selects the adapter for MODEL_CHANNEL", async () => {
    const { getModel } = await import("../src/models/factory.js");

    process.env.MODEL_CHANNEL = "vertex";
    resetEnvCache();
    expect((await import("../src/models/factory.js")).getModel().channel).toBe("vertex");

    process.env.MODEL_CHANNEL = "zai";
    resetEnvCache();
    expect(getModel().channel).toBe("zai");
  });
});
