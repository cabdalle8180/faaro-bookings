import { ArrowRight, CalendarDays, FileText, LayoutDashboard, LockKeyhole, RotateCcw, Settings, ShieldCheck, Star, UserRound } from "lucide-react";
import { Link, Outlet } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { customerApi } from "../api/customer";
import { errorMessage } from "../api/client";
import { paidBooking } from "../utils/booking";
import { Badge, Button, Card, DashboardLayout, EmptyState, ErrorState, LoadingState, PageHeader, UnavailableState } from "../components/UI";

const navItems = [
  { to: "/customer", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/customer/catalog", label: "Explore Units", icon: ShieldCheck },
  { to: "/customer/bookings", label: "My Bookings", icon: CalendarDays },
  { to: "/customer/refunds", label: "Refund Requests", icon: RotateCcw },
  { to: "/customer/reviews", label: "Reviews & Ratings", icon: Star },
  { to: "/customer/profile", label: "Profile & Security", icon: UserRound },
  { to: "/customer/settings", label: "Settings", icon: Settings },
];

export function CustomerShell() {
  return <DashboardLayout area="customer" navItems={navItems}><Outlet /></DashboardLayout>;
}

function Metric({ label, icon: Icon, note, value }) {
  return <Card className="metric-card"><div><span className="metric-label">{label}</span><strong>{value}</strong><small>{note}</small></div><span className="metric-icon"><Icon size={19} /></span></Card>;
}

export function CustomerDashboard() {
  const { user } = useAuth();
  const firstName = user?.fullName?.split(" ")[0] || "traveler";
  const [state, setState] = useState({ loading: true, bookings: [], error: "" });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try { const result = await customerApi.bookings(); setState({ loading: false, bookings: result.data || [], error: "" }); }
    catch (cause) { setState((current) => ({ ...current, loading: false, error: errorMessage(cause) })); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const active = state.bookings.filter((booking) => paidBooking(booking) && new Date(booking.endDate) >= new Date());
  const completed = state.bookings.filter((booking) => booking.status === "completed" ||
    (paidBooking(booking) && new Date(booking.endDate) < new Date()));
  const pending = state.bookings.filter((booking) => booking.status === "progress" && !paidBooking(booking));
  return <><Card className="customer-welcome"><div><span className="eyebrow text-[#a83c03]">TRAVELER WORKSPACE</span><h1>Welcome back, {firstName}</h1><p>Review your bookings and payment status.</p></div><Link to="/customer/bookings" className="btn btn-soft">Manage reservations <ArrowRight size={16} /></Link><div className="customer-metrics"><Metric label="ACTIVE BOOKINGS" icon={CalendarDays} value={state.loading || state.error ? "—" : active.length} note="Confirmed reservations" /><Metric label="COMPLETED STAYS" icon={ShieldCheck} value={state.loading || state.error ? "—" : completed.length} note="Booking history" /><Metric label="PENDING PAYMENT" icon={LockKeyhole} value={state.loading || state.error ? "—" : pending.length} note="Awaiting Stripe confirmation" /></div></Card><section className="dashboard-section"><div className="dashboard-section-heading"><h2>Upcoming &amp; Active Bookings</h2><Badge>{active.length} active</Badge></div>{state.loading ? <LoadingState /> : state.error ? <ErrorState error={state.error} onRetry={load} /> : active.length === 0 ? <EmptyState title="No active bookings" description="Explore real available units to start a reservation." action={<Link to="/customer/catalog" className="btn btn-primary">Explore units <ArrowRight size={16} /></Link>} /> : <div className="booking-list">{active.map((booking) => <Link className="booking-list-row card" to={`/customer/bookings/${booking._id}`} key={booking._id}><div><Badge tone="green">Confirmed</Badge><h2>{booking.unitId?.title || "Unit"}</h2><p>{booking.businessId?.name} · {new Date(booking.startDate).toLocaleDateString()} – {new Date(booking.endDate).toLocaleDateString()}</p></div><ArrowRight size={18} /></Link>)}</div>}</section><Card className="receipt-card"><div className="receipt-head"><div><FileText size={23} /><div><h2>Booking Details &amp; Receipt</h2><p>Open a confirmed booking to see its historical price and status.</p></div></div><Link to="/customer/bookings" className="btn btn-secondary">My bookings</Link></div></Card><div className="customer-lower"><Card><div className="customer-card-head"><Star size={20} /><h2>Review Management</h2></div><UnavailableState compact title="Reviews unavailable" description="Review history and submission need a reviews API." /></Card><Card><div className="customer-card-head"><RotateCcw size={20} /><h2>Refund &amp; Cancellation Policy</h2></div><UnavailableState compact title="Paid refunds unavailable" description="Only unpaid pending holds can currently be cancelled. Paid booking refunds require a refund API and policy." /></Card></div></>;
}

export function CustomerRefunds() {
  return <><PageHeader eyebrow="CUSTOMER SPACE" title="Refund Requests" description="Track cancellation and refund requests here." /><Card className="p-6"><div className="tabs-line"><span className="active">All requests</span><span>Pending</span><span>Resolved</span></div><UnavailableState title="Refund requests are unavailable" description="The backend does not provide refund creation or tracking APIs." /></Card></>;
}

export function CustomerReviews() {
  return <><PageHeader eyebrow="CUSTOMER SPACE" title="Reviews & Ratings" description="Manage reviews linked to completed stays and rides." /><Card className="p-6"><UnavailableState title="Reviews are unavailable" description="The backend has no review list or submission endpoint." /></Card></>;
}

export function CustomerProfile() {
  const { user } = useAuth();
  return <><PageHeader eyebrow="CUSTOMER SPACE" title="Profile & Security" description="Account information from your latest real login." /><div className="two-column-panels"><Card className="p-6"><h2 className="panel-title">Personal Information</h2><div className="profile-fields"><div><span>Full name</span><strong>{user?.fullName || "—"}</strong></div><div><span>Email</span><strong>{user?.email || "—"}</strong></div><div><span>Phone</span><strong>{user?.phone || "—"}</strong></div><div><span>Account role</span><Badge tone="green">{user?.role}</Badge></div></div></Card><Card className="p-6"><h2 className="panel-title">Security</h2><p className="text-sm text-slate-600 mt-2">Password changes are available through the email reset flow. Profile editing has no backend endpoint yet.</p><Link className="btn btn-secondary mt-5" to="/forgot-password">Reset password <ArrowRight size={16} /></Link><UnavailableState compact title="Profile editing unavailable" description="An authenticated profile update API is required." /></Card></div></>;
}

export function CustomerSettings() {
  return <><PageHeader eyebrow="CUSTOMER SPACE" title="Account Settings" description="Preferences and notification controls for your account." /><Card className="p-6"><h2 className="panel-title">Preferences</h2><div className="settings-row"><div><strong>Email notifications</strong><p>Manage booking and account updates.</p></div><input type="checkbox" disabled /></div><div className="settings-row"><div><strong>Currency</strong><p>Display currency for marketplace prices.</p></div><span>USD</span></div><UnavailableState compact title="Settings are not available yet" description="The current backend does not provide account preference endpoints." /></Card></>;
}

