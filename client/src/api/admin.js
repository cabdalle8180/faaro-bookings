import { request } from "./client";

export const adminApi = {
  users: () => request("/admin/users/"),
  businesses: () => request("/admin/users/owners"),
  suspendUser: (id) => request(`/admin/users/suspend/${encodeURIComponent(id)}`, { method: "POST" }),
  createBusiness: (userId, formData) =>
    request(`/admin/users/businessOwner/${encodeURIComponent(userId)}`, {
      method: "POST",
      body: formData,
    }),
};
