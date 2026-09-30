import { request } from "./client.js";

export const ownerApi = {
  business: () => request("/owner/business"),
  createBusiness: (body) => request("/owner/business", { method: "POST", body }),
  updateBusiness: (body) => request("/owner/business", { method: "PATCH", body }),
  units: () => request("/owner/units"),
  unit: (id) => request(`/owner/units/${encodeURIComponent(id)}`),
  bookings: () => request("/owner/booking"),
  booking: (id) => request(`/owner/booking/${encodeURIComponent(id)}`),
  createUnit: (formData) => request("/owner/units", { method: "POST", body: formData }),
  updateUnit: (id, formData) => request(`/owner/units/${encodeURIComponent(id)}`, { method: "PATCH", body: formData }),
  deactivateUnit: (id) => request(`/owner/units/${encodeURIComponent(id)}`, { method: "DELETE" }),
  checkBooking: (id, booking_code) => request(`/owner/check-booking/${encodeURIComponent(id)}`,
    { method: "POST", body: { booking_code } }),
};
