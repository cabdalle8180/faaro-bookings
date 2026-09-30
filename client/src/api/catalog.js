import { request } from "./client.js";

export const catalogQuery = (filters = {}) => new URLSearchParams(Object.entries(filters)
  .filter(([, value]) => value != null && value !== "")).toString();
export const catalogApi = {
  businesses: (options = {}) => request("/catalog/businesses", { ...options, auth: false }),
  business: (id, options = {}) => request(`/catalog/businesses/${encodeURIComponent(id)}`, { ...options, auth: false }),
  units: (filters = {}, options = {}) => request(`/catalog/units?${catalogQuery(filters)}`, { ...options, auth: false }),
  unit: (id, options = {}) => request(`/catalog/units/${encodeURIComponent(id)}`, { ...options, auth: false }),
  availability: (id, startDate, endDate, options = {}) => {
    const { guests, ...fetchOptions } = options;
    return request(`/catalog/units/${encodeURIComponent(id)}/availability?${catalogQuery({ startDate, endDate, guests })}`,
      { ...fetchOptions, auth: false });
  },
};
