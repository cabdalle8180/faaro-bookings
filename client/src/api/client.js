const API_BASE = (import.meta.env?.VITE_API_URL || "/api").replace(/\/$/, "");

let accessToken = null;
let unauthorizedHandler = null;
let refreshPromise = null;
let sessionHandler = null;
export const setSessionHandler = (handler) => { sessionHandler = handler; };

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const setAccessToken = (token) => {
  accessToken = token || null;
};

export const setUnauthorizedHandler = (handler) => {
  unauthorizedHandler = handler;
};

export const errorMessage = (error) => {
  if (error?.status === 0) return "The server could not be reached. Check your connection and try again.";
  if (error?.status === 401) return error.message || "Your session has expired. Please sign in again.";
  if (error?.status === 403) return error.message || "You do not have access to this section.";
  if (error?.status === 404) return error.message || "The requested information was not found.";
  if (error?.status === 409) return error.message || "This record conflicts with an existing one.";
  if (error?.status >= 500) return error.message || "The server could not complete this request. Please try again.";
  return error?.message || "Something went wrong. Please try again.";
};

const parseResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    await response.text();
    throw new ApiError("The API returned an unexpected response. Please try again.", response.status >= 400 ? response.status : 502);
  }
  return response.json();
};

export function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = request("/auth/refresh", { method: "POST", auth: false, retry: false })
      .then((result) => {
        if (!result.accessToken) throw new ApiError("Your session has expired.", 401);
        setAccessToken(result.accessToken);
        if (result.data) sessionHandler?.(result.data);
        return result.accessToken;
      }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function request(path, options = {}) {
  const { method = "GET", body, headers = {}, auth = true, retry = true, signal } = options;
  const requestHeaders = { ...headers };
  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders["Content-Type"] = "application/json";
  }
  if (auth && accessToken) requestHeaders.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: requestHeaders,
      credentials: "include",
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError("The server could not be reached.", 0);
  }

  if (response.status === 401 && auth && retry) {
    try {
      await refreshAccessToken();
    } catch (error) {
      if ([401, 403].includes(error.status)) {
        setAccessToken(null);
        unauthorizedHandler?.();
      }
      throw error;
    }
    return request(path, { method, body, headers, auth, retry: false, signal });
  }
  if (response.status === 401 && auth && !retry) {
    setAccessToken(null);
    unauthorizedHandler?.();
  }

  const data = await parseResponse(response);
  if (!response.ok || data?.success === false) throw new ApiError(data?.message || `Request failed (${response.status})`, response.ok ? 400 : response.status);
  return data;
}
