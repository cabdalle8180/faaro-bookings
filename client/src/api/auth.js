import { request } from "./client";

export const authApi = {
  register: (body) => request("/auth/register", { method: "POST", body, auth: false }),
  verifyEmail: (token) => request("/auth/verify-email", { method: "POST", body: { token }, auth: false }),
  resendVerification: (email) => request("/auth/resend-verification", { method: "POST", body: { email }, auth: false }),
  login: (body) => request("/auth/login", { method: "POST", body, auth: false }),
  forgotPassword: (body) => request("/auth/forgot-password", { method: "POST", body, auth: false }),
  resetPassword: (body) => request("/auth/reset-password", { method: "POST", body, auth: false }),
  refresh: () => request("/auth/refresh", { method: "POST", auth: false }),
  logout: () => request("/auth/logout", { method: "POST", auth: false }),
};
