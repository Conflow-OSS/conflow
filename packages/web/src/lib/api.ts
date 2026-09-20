// Every request goes through the BFF's /api prefix — in dev, Vite's own
// proxy forwards it to the local BFF; in production, the BFF serves this
// same origin. Neither the build nor this client ever sees the API token —
// only the BFF does.
const BASE = "/api";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(body.error ?? res.statusText, res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  return handleResponse<T>(res);
}

// No Content-Type header here — fetch sets `multipart/form-data; boundary=...`
// itself from the FormData body, so setting one manually would omit the
// boundary and break parsing on the server.
async function requestForm<T>(path: string, method: "POST" | "PATCH", body: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, body });
  return handleResponse<T>(res);
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
  postForm: <T>(path: string, body: FormData): Promise<T> => requestForm<T>(path, "POST", body),
  patchForm: <T>(path: string, body: FormData): Promise<T> => requestForm<T>(path, "PATCH", body),
};
