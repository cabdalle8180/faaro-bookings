import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BarChart3, Building2, CheckCircle2, CreditCard, FileText, LayoutDashboard, List, LockKeyhole, Plus, RotateCcw, Search, Settings, ShieldCheck, Star, UserRound, Users } from "lucide-react";
import { Link, Outlet } from "react-router-dom";
import { adminApi } from "../api/admin";
import { errorMessage } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Badge, Button, Card, DashboardLayout, EmptyState, ErrorState, Input, LoadingState, Modal, PageHeader, Select, UnavailableState } from "../components/UI";

const navItems = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "User Directory", icon: Users },
  { to: "/admin/owners", label: "Owner Accounts", icon: UserRound },
  { to: "/admin/businesses", label: "Businesses", icon: Building2 },
  { to: "/admin/bookings", label: "Bookings Escrow", icon: LockKeyhole },
  { to: "/admin/payments", label: "Payments", icon: CreditCard },
  { to: "/admin/refunds", label: "Refunds & Disputes", icon: RotateCcw },
  { to: "/admin/reviews", label: "Reviews", icon: Star },
  { to: "/admin/statistics", label: "Platform Analytics", icon: BarChart3 },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminShell() { return <DashboardLayout area="admin" navItems={navItems}><Outlet /></DashboardLayout>; }

function useAdminList(loader, emptyMessage) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await loader();
      setData(Array.isArray(result.data) ? result.data : []);
    } catch (requestError) {
      if (requestError.status === 404 && requestError.message === emptyMessage) setData([]);
      else setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [loader, emptyMessage]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

function AdminMetric({ label, value = "—", note, icon: Icon, warm = false }) {
  return <Card className={`metric-card admin-metric ${warm ? "metric-warm" : ""}`}><div><span className="metric-label">{label}</span><strong>{value}</strong><small>{note}</small></div><span className="metric-icon"><Icon size={19} /></span></Card>;
}

function BusinessTable({ businesses, compact = false }) {
  if (!businesses.length) return <EmptyState title="No businesses found" description="The admin API returned no business records." />;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>BUSINESS</th><th>CATEGORY</th><th>CITY</th><th>CONTACT</th><th>STATUS</th>{!compact && <th>OWNER ID</th>}</tr></thead><tbody>{businesses.map((business) => <tr key={business._id}><td><strong>{business.name}</strong><small>{business.address}</small></td><td>{business.category?.replace("_", " ") || "—"}</td><td>{business.city || "—"}</td><td>{business.contactPhone || "—"}</td><td><Badge tone={business.status === "active" ? "green" : "orange"}>{business.status || "—"}</Badge></td>{!compact && <td className="mono-cell">{business.ownerId || "—"}</td>}</tr>)}</tbody></table></div>;
}

export function AdminDashboard() {
  const users = useAdminList(adminApi.users, "No users found");
  const businesses = useAdminList(adminApi.businesses, "No businesses found");
  return <><PageHeader eyebrow="GOVERNANCE HUB / CENTRAL PLATFORM OVERSIGHT" title="Platform Operations & Financial Escrow" description="Operational information available from the current admin API." action={<div className="flex gap-2"><Button variant="secondary" disabled>Escrow Audit Log</Button><Button disabled>Force System Recalculation</Button></div>} /><div className="admin-metrics"><AdminMetric label="PLATFORM GROSS VOLUME" icon={CreditCard} note="Payments API unavailable" /><AdminMetric label="TOTAL ACTIVE BOOKINGS" icon={FileText} note="Bookings API unavailable" /><AdminMetric label="REGISTERED BUSINESSES" value={businesses.loading ? "…" : businesses.error ? "—" : businesses.data.length} icon={Building2} note="From admin businesses API" /><AdminMetric label="REFUND REQUESTS" icon={AlertTriangle} note="Refund API unavailable" warm /></div><div className="admin-queues"><Card className="p-6"><div className="panel-heading"><div><h2>Escrow &amp; Refund Review Queue</h2><p>Review claims before settlement.</p></div><Badge tone="orange">Unavailable</Badge></div><UnavailableState compact title="Refund queue unavailable" description="The backend has no refund or escrow review endpoint." /></Card><Card className="p-6"><div className="panel-heading"><div><h2>Owner Approval Queue</h2><p>Business validation and approval.</p></div><Badge>Unavailable</Badge></div><UnavailableState compact title="Approval queue unavailable" description="Business creation exists, but approval state and approval actions do not." /></Card></div><Card className="admin-directory"><div className="table-panel-head"><div><h2>Platform Business Directory</h2><p>Real businesses returned by the admin API.</p></div><Link to="/admin/businesses" className="text-link">Manage businesses <ArrowRight size={15} /></Link></div>{businesses.loading ? <LoadingState label="Loading businesses…" /> : businesses.error ? <ErrorState error={businesses.error} onRetry={businesses.reload} /> : <BusinessTable businesses={businesses.data} compact />}</Card><div className="admin-queues mt-6"><Card className="p-6"><h2 className="panel-title">User Directory</h2>{users.loading ? <LoadingState label="Loading users…" /> : users.error ? <ErrorState error={users.error} onRetry={users.reload} /> : <div className="quick-directory"><strong>{users.data.length}</strong><span>real users returned by the admin API</span><Link className="text-link" to="/admin/users">Open directory <ArrowRight size={15} /></Link></div>}</Card><Card className="p-6"><h2 className="panel-title">Core Infrastructure &amp; System Status</h2><UnavailableState compact title="Service telemetry unavailable" description="The backend does not expose infrastructure or webhook health metrics." /></Card></div></>;
}

export function AdminUsers({ ownersOnly = false }) {
  const { user: currentUser } = useAuth();
  const { data, loading, error, reload } = useAdminList(adminApi.users, "No users found");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const filtered = useMemo(() => data.filter((user) => (!ownersOnly || user.role === "owner") && `${user.fullName} ${user.email} ${user.phone || ""}`.toLowerCase().includes(search.toLowerCase())), [data, ownersOnly, search]);
  const suspend = async () => {
    setBusy(true); setActionError("");
    try { await adminApi.suspendUser(target._id); setTarget(null); await reload(); }
    catch (requestError) { setActionError(errorMessage(requestError)); }
    finally { setBusy(false); }
  };
  return <><PageHeader eyebrow="PLATFORM GOVERNANCE" title={ownersOnly ? "Owner Accounts" : "User Directory"} description={ownersOnly ? "Owners are filtered from the real user directory." : "Manage users returned by the admin API."} /><Card className="admin-directory"><div className="table-panel-head"><div><h2>{ownersOnly ? "Business Owners" : "All Users"}</h2><p>{loading ? "Loading…" : `${filtered.length} account${filtered.length === 1 ? "" : "s"} shown`}</p></div><label className="table-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users" /></label></div>{loading ? <LoadingState label="Loading users…" /> : error ? <ErrorState error={error} onRetry={reload} /> : !filtered.length ? <EmptyState title={search ? "No matching users" : "No users found"} description={search ? "Try a different search term." : "The admin API returned no matching records."} /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>USER</th><th>PHONE</th><th>ROLE</th><th>VERIFIED</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{filtered.map((account) => <tr key={account._id}><td><strong>{account.fullName}</strong><small>{account.email}</small></td><td>{account.phone || "—"}</td><td><Badge tone={account.role === "admin" ? "orange" : "blue"}>{account.role}</Badge></td><td>{account.isVerified ? <span className="text-emerald-700 flex items-center gap-1"><CheckCircle2 size={15} /> Yes</span> : "No"}</td><td><Badge tone={account.status === "active" ? "green" : "orange"}>{account.status}</Badge></td><td><Button variant="danger" disabled={account.status !== "active" || account._id === currentUser?._id} onClick={() => setTarget(account)}>Suspend</Button></td></tr>)}</tbody></table></div>}</Card>{target && <Modal title="Suspend user" onClose={() => setTarget(null)} footer={<><Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button><Button variant="danger" loading={busy} onClick={suspend}>Suspend account</Button></>}><p>Are you sure you want to suspend <strong>{target.fullName}</strong>? Their current access will be denied by the backend.</p>{actionError && <div className="form-alert error mt-4">{actionError}</div>}</Modal>}</>;
}

function BusinessCreateModal({ customers, onClose, onCreated }) {
  const [form, setForm] = useState({ userId: "", name: "", description: "", category: "hotel", contactPhone: "", city: "", address: "", openHours: "" });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!form.userId) return setError("Select an active customer.");
    if (files.length > 5) return setError("Select no more than five images.");
    const body = new FormData();
    for (const key of ["name", "description", "category", "contactPhone", "city", "address", "openHours"]) body.append(key, form[key]);
    for (const file of files) body.append("images", file);
    setBusy(true);
    try { await adminApi.createBusiness(form.userId, body); await onCreated(); onClose(); }
    catch (requestError) { setError(errorMessage(requestError)); }
    finally { setBusy(false); }
  };
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Modal title="Create business owner" onClose={onClose}><form onSubmit={submit} className="business-form"><p className="text-sm text-slate-600">This uses the existing admin API and promotes the selected active customer to owner.</p><Select label="Customer account" value={form.userId} onChange={(event) => update("userId", event.target.value)} required><option value="">Select a customer</option>{customers.map((customer) => <option key={customer._id} value={customer._id}>{customer.fullName} · {customer.email}</option>)}</Select><div className="two-fields"><Input label="Business name" value={form.name} onChange={(event) => update("name", event.target.value)} required /><Select label="Category" value={form.category} onChange={(event) => update("category", event.target.value)}><option value="hotel">Hotel</option><option value="car_rental">Car rental</option><option value="apartment">Apartment</option></Select></div><Input label="Description" value={form.description} onChange={(event) => update("description", event.target.value)} /><div className="two-fields"><Input label="Contact phone" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} required /><Input label="City" value={form.city} onChange={(event) => update("city", event.target.value)} required /></div><Input label="Address" value={form.address} onChange={(event) => update("address", event.target.value)} required /><Input label="Open hours" value={form.openHours} onChange={(event) => update("openHours", event.target.value)} required /><label className="field"><span className="field-label">Images (up to five, optional)</span><input className="input file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} /></label>{error && <div className="form-alert error">{error}</div>}<div className="flex justify-end gap-3"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Create Business <ArrowRight size={16} /></Button></div></form></Modal>;
}

export function AdminBusinesses() {
  const businesses = useAdminList(adminApi.businesses, "No businesses found");
  const users = useAdminList(adminApi.users, "No users found");
  const [open, setOpen] = useState(false);
  const customers = users.data.filter((user) => user.role === "customer" && user.status === "active");
  return <><PageHeader eyebrow="PLATFORM GOVERNANCE" title="Businesses" description="Real businesses and owner assignments from the admin API." action={<Button onClick={() => setOpen(true)} disabled={users.loading || !!users.error || !customers.length}><Plus size={16} /> Create Business</Button>} /><Card className="admin-directory"><div className="table-panel-head"><div><h2>Registered Businesses</h2><p>Category, contact, and status come from the backend.</p></div><Badge tone="blue">{businesses.loading ? "Loading" : businesses.error ? "Unavailable" : `${businesses.data.length} records`}</Badge></div>{businesses.loading ? <LoadingState label="Loading businesses…" /> : businesses.error ? <ErrorState error={businesses.error} onRetry={businesses.reload} /> : <BusinessTable businesses={businesses.data} />}</Card><Card className="p-6 mt-6"><h2 className="panel-title">Business Management</h2><p className="text-sm text-slate-600 mt-2">Creating a business for an active customer is supported. Approval, editing, publication, and status changes have no API.</p><UnavailableState compact title="Additional business actions unavailable" description="The current admin API only supports creating and listing businesses." /></Card>{users.error && <ErrorState error={users.error} onRetry={users.reload} />}{!users.loading && !users.error && !customers.length && <div className="form-alert info mt-4">No active customer is available for business creation.</div>}{open && <BusinessCreateModal customers={customers} onClose={() => setOpen(false)} onCreated={async () => { await Promise.all([businesses.reload(), users.reload()]); }} />}</>;
}

function UnsupportedAdminPage({ title, description, columns }) {
  return <><PageHeader eyebrow="PLATFORM GOVERNANCE" title={title} description={description} /><Card className="admin-directory"><div className="table-panel-head"><div><h2>{title}</h2><p>Live platform data will appear when the corresponding API is available.</p></div><Badge tone="orange">API unavailable</Badge></div><div className="table-wrap"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody><tr><td colSpan={columns.length}><UnavailableState compact title={`${title} are not available yet`} description="The existing backend has no endpoint for this section. No records or totals are simulated." /></td></tr></tbody></table></div></Card></>;
}

export function AdminBookings() { return <UnsupportedAdminPage title="Bookings & Escrow" description="Manage reservations and held funds." columns={["BOOKING", "CUSTOMER", "BUSINESS", "STATUS", "ESCROW"]} />; }
export function AdminPayments() { return <UnsupportedAdminPage title="Payments" description="View payment transactions and settlements." columns={["TRANSACTION", "BOOKING", "AMOUNT", "STATUS"]} />; }
export function AdminRefunds() { return <UnsupportedAdminPage title="Refunds & Disputes" description="Review refund requests and dispute decisions." columns={["REQUEST", "CUSTOMER", "AMOUNT", "STATUS", "ACTION"]} />; }
export function AdminReviews() { return <UnsupportedAdminPage title="Reviews" description="Moderate customer feedback across the platform." columns={["REVIEW", "CUSTOMER", "BUSINESS", "STATUS"]} />; }
export function AdminStatistics() { return <UnsupportedAdminPage title="Platform Analytics" description="Financial and operational reports need backend aggregation APIs." columns={["METRIC", "PERIOD", "VALUE", "TREND"]} />; }
export function AdminSettings() { return <UnsupportedAdminPage title="Settings" description="Platform settings and audit controls." columns={["SETTING", "DESCRIPTION", "VALUE", "ACTION"]} />; }
