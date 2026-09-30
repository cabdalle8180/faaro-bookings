import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Building2, CalendarDays, CreditCard, Plus, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ownerApi } from "../api/owner";
import { errorMessage } from "../api/client";
import { paidBooking } from "../utils/booking";
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, UnavailableState } from "../components/UI";

const money = (value, currency = "USD") => value == null ? "—" :
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);

export function OwnerDashboardLive() {
  const [state, setState] = useState({ loading: true, business: null, units: [], bookings: [], error: "", missing: false });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const business = await ownerApi.business();
      const [units, bookings] = await Promise.all([ownerApi.units(), ownerApi.bookings()]);
      setState({ loading: false, business: business.data, units: units.data || [], bookings: bookings.data || [], error: "", missing: false });
    } catch (cause) { setState((current) => ({ ...current, loading: false, error: cause.status === 404 ? "" : errorMessage(cause), missing: cause.status === 404 })); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = state.bookings.filter((item) => paidBooking(item) && new Date(item.startDate).toISOString().slice(0, 10) >= today);
  const arrivals = upcoming.filter((item) => new Date(item.startDate).toISOString().slice(0, 10) === today);
  const published = state.business?.status === "active" ? state.units.filter((unit) => unit.active).length : 0;
  return <><PageHeader eyebrow="PARTNER HUB" title={state.business?.name || "Partner Hub"} description="Business → Unit → Publish. Your real catalog and confirmed reservations."
    action={<Link to="/owner/units/new" className="btn btn-dark"><Plus size={17} /> Add new unit</Link>} />
    {state.loading ? <LoadingState /> : state.error ? <ErrorState error={state.error} onRetry={load} /> : state.missing ?
      <EmptyState title="Set up your business" description="Create your business before adding rooms, vehicles, or apartments."
        action={<Link className="btn btn-primary" to="/owner/business">Create business <ArrowRight size={16} /></Link>} /> : <>
      <div className="owner-metrics">
        <Card className="metric-card owner-metric"><div><span className="metric-label">REVENUE</span><strong>—</strong><small>Payout reporting unavailable</small></div><CreditCard size={20} /></Card>
        <Card className="metric-card owner-metric"><div><span className="metric-label">PUBLISHED UNITS</span><strong>{published}</strong><small>Visible in customer catalog</small></div><Building2 size={20} /></Card>
        <Card className="metric-card owner-metric"><div><span className="metric-label">UPCOMING CHECK-INS</span><strong>{upcoming.length}</strong><small>Confirmed bookings</small></div><CalendarDays size={20} /></Card>
        <Card className="metric-card owner-metric"><div><span className="metric-label">ESCROW PAYOUTS</span><strong>—</strong><small>Payout API unavailable</small></div><ShieldCheck size={20} /></Card>
      </div>
      <div className="owner-dashboard-mid"><Card className="p-6"><div className="panel-heading"><div><h2>Today's Check-in / Pickup Console</h2><p>Confirmed arrivals for your business today.</p></div></div>
        {arrivals.length === 0 ? <EmptyState title="No arrivals today" /> : <div className="booking-list">{arrivals.slice(0, 5).map((booking) => <Link className="booking-list-row" to={`/owner/bookings/${booking._id}`} key={booking._id}><div><Badge tone="green">Confirmed</Badge><h2>{booking.unitId?.title || "Unit"}</h2><p>{booking.customerId?.fullName} · {new Date(booking.startDate).toLocaleDateString()}</p></div><ArrowRight size={16} /></Link>)}</div>}
      </Card><Card className="p-6"><div className="panel-heading"><div><h2>Marketplace Status</h2><p>Current business status.</p></div><Badge tone={state.business.status === "active" ? "green" : "orange"}>{state.business.status}</Badge></div><div className="status-list"><span><Building2 size={17} /> Business Profile <strong>{state.business.name}</strong></span><span><ShieldCheck size={17} /> Published Units <strong>{published}</strong></span></div><Link className="btn btn-secondary mt-5" to="/owner/business">Manage business</Link></Card></div>
      <Card className="overflow-hidden mt-6"><div className="table-panel-head"><div><h2>Unit Management &amp; Live Catalog</h2><p>Saved units and their publishing status.</p></div><Link className="btn btn-primary btn-small" to="/owner/units/new"><Plus size={15} /> Add new unit</Link></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>UNIT ASSET</th><th>BASE RATE</th><th>CATALOG STATUS</th><th>ACTIONS</th></tr></thead><tbody>
          {state.units.length === 0 ? <tr><td colSpan={4}><EmptyState title="No units yet" description="Add a unit with its actual specifications, then publish it." /></td></tr> : state.units.slice(0, 5).map((unit) => <tr key={unit._id}><td><strong>{unit.title}</strong><small>{unit.code}</small></td><td>{money(unit.price, unit.currency)}</td><td><Badge tone={unit.active && state.business.status === "active" ? "green" : "orange"}>{state.business.status !== "active" ? "Business suspended" : unit.active ? "Published" : "Unpublished"}</Badge></td><td><Link className="btn btn-secondary btn-small" to={`/owner/units/${unit._id}/edit`}>Edit unit</Link></td></tr>)}
        </tbody></table></div><div className="table-panel-head"><Link className="text-link" to="/owner/units">Manage all units <ArrowRight size={16} /></Link></div>
      </Card>
    </>}
  </>;
}

export function OwnerBookingsLive() {
  const [state, setState] = useState({ loading: true, bookings: [], error: "" });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try { const result = await ownerApi.bookings(); setState({ loading: false, bookings: result.data || [], error: "" }); }
    catch (cause) { setState((current) => ({ ...current, loading: false, error: errorMessage(cause) })); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <><PageHeader eyebrow="PARTNER HUB" title="Bookings & Escrow" description="Paid reservations for your business." />{state.loading ? <LoadingState /> : state.error ? <ErrorState error={state.error} onRetry={load} /> : <Card className="p-6">{state.bookings.length === 0 ? <EmptyState title="No paid bookings yet" /> : <div className="booking-list">{state.bookings.map((booking) => <Link className="booking-list-row" to={`/owner/bookings/${booking._id}`} key={booking._id}><div><Badge tone="green">{booking.status}</Badge><h2>{booking.unitId?.title || "Unit"}</h2><p>{booking.customerId?.fullName} · {new Date(booking.startDate).toLocaleDateString()} – {new Date(booking.endDate).toLocaleDateString()}</p></div><strong>{money(booking.totalAmount, booking.currency)}</strong><ArrowRight size={16} /></Link>)}</div>}</Card>}</>;
}

export function OwnerBookingDetailLive() {
  const { id } = useParams();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState("");
  const [verifying, setVerifying] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setBooking(null); setCode(""); setResult(""); try { const response = await ownerApi.booking(id); setBooking(response.data); setError(""); }
    catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const verify = async (event) => {
    event.preventDefault(); if (verifying) return; setVerifying(true); setResult(""); setError("");
    try { const response = await ownerApi.checkBooking(id, code); setResult(response.message); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setVerifying(false); }
  };
  return <><PageHeader eyebrow="PARTNER HUB" title="Booking Details" description="Reservation details for your business." />{loading ? <LoadingState /> : error && !booking ? <ErrorState error={error} onRetry={load} /> : booking && <div className="two-column-panels"><Card className="p-6"><Badge tone="green">{booking.status}</Badge><h2 className="panel-title mt-4">{booking.unitId?.title}</h2><div className="profile-fields mt-5"><div><span>Customer</span><strong>{booking.customerId?.fullName}</strong></div><div><span>Email</span><strong>{booking.customerId?.email}</strong></div><div><span>Phone</span><strong>{booking.customerId?.phone}</strong></div><div><span>Guests</span><strong>{booking.guests ?? 1}</strong></div><div><span>Dates</span><strong>{new Date(booking.startDate).toLocaleDateString()} – {new Date(booking.endDate).toLocaleDateString()}</strong></div><div><span>Rate at booking</span><strong>{money(booking.unitPrice, booking.currency)}</strong></div><div><span>Total charged</span><strong>{money(booking.totalAmount, booking.currency)}</strong></div><div><span>Payment</span><strong>{booking.paymentStatus}</strong></div></div>{booking.documentAccessUrl && <a className="btn btn-secondary mt-5" href={booking.documentAccessUrl} target="_blank" rel="noreferrer">View booking document</a>}<Button variant="secondary" className="mt-5" onClick={load}>Refresh booking</Button></Card><Card className="p-6"><h2 className="panel-title">Verify booking code</h2><p className="text-sm text-slate-600 mt-2">Ask the customer for their booking code at check-in or pickup. This verifies the code; it does not record a completed handover.</p><form onSubmit={verify} className="mt-5"><Input disabled={verifying} label="Booking code" value={code} onChange={(event) => setCode(event.target.value)} required /><Button type="submit" loading={verifying} className="mt-4">Verify code</Button></form>{result && <p className="form-alert success" role="status">{result}</p>}{error && <p className="form-alert error" role="alert">{error}</p>}</Card></div>}</>;
}

