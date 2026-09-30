import { request } from "./client.js";

export const customerApi = {
  businesses: () => request("/customer/businesses"),
  business: (id) => request(`/customer/business/${encodeURIComponent(id)}`),
  units: () => request("/customer/units"),
  unit: (id) => request(`/customer/units/${encodeURIComponent(id)}`),
  availability: (id, startDate, endDate, options = {}) => {
    const { guests, ...fetchOptions } = options;
    return request(`/customer/units/${encodeURIComponent(id)}/availability?${new URLSearchParams({ startDate, endDate, ...(guests != null ? { guests } : {}) })}`, fetchOptions);
  },
  bookings: () => request("/customer/bookings"),
  syncPayment: (id) => request(`/customer/booking/${encodeURIComponent(id)}/payment-status`, { method: "POST" }),
  booking: (id, includeCheckout = false) => request(`/customer/booking/${encodeURIComponent(id)}${includeCheckout ? "?includeCheckout=true" : ""}`),
  createBooking: (body) => request("/customer/booking", { method: "POST", body }),
  cancelPendingBooking: (id) => request(`/customer/booking/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};
