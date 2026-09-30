export const roleHome = (role) => ({ customer: "/customer", owner: "/owner", admin: "/admin" })[role] || "/";

// Only restore local routes that the authenticated role is allowed to open.
export function loginDestination(role, from) {
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//") || from.includes("\\")) {
    return roleHome(role);
  }
  const path = from.split(/[?#]/, 1)[0];
  if (path === `/${role}` || path.startsWith(`/${role}/`)) return from;
  if (role === "customer" && ["/checkout", "/payment/success", "/payment/cancel"].includes(path)) return from;
  return roleHome(role);
}
