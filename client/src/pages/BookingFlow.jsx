import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BedDouble, CalendarDays, CreditCard, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { catalogApi } from "../api/catalog";
import { useCatalog, CatalogResults, ImageGallery } from "../components/Catalog";
import { customerApi } from "../api/customer";
import { errorMessage } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { paidBooking, displayStatus, paymentReturnTitle } from "../utils/booking";
import { Badge, Brand, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SiteFooter, SiteHeader } from "../components/UI";

const money = (value, currency = "USD") => value == null ? "—" :
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
const today = () => new Date().toISOString().slice(0, 10);

function UnitSpecifications({ unit }) {
  const details = unit.details || {};
  const entries = [
    ["Room type", details.hotel?.roomType], ["Beds", details.hotel?.beds], ["Guest capacity", details.hotel?.capacity],
    ["Make", details.car?.make], ["Model", details.car?.model], ["Seats", details.car?.seats],
    ["Bedrooms", details.apartment?.bedrooms], ["Bathrooms", details.apartment?.bathrooms], ["Maximum guests", details.apartment?.maxGuests],
  ].filter(([, value]) => value != null);
  return entries.length ? <div className="profile-fields mt-5">{entries.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div> : null;
}

function PendingBookingActions({ booking, onUpdate }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (booking.status !== "progress" || paidBooking(booking)) return null;
  const act = async (action) => {
    setBusy(action); setError(""); setMessage("");
    try {
      if (action === "cancel") {
        await customerApi.cancelPendingBooking(booking._id);
        await onUpdate();
      } else {
        const result = await customerApi.booking(booking._id, true);
        if (result.data.checkout?.state === "open" && result.data.checkout.url) {
          window.location.assign(result.data.checkout.url);
          return;
        }
        await onUpdate();
        setMessage(result.data.checkout?.state === "expired" ? "This payment session has expired. Select dates to make a new reservation." :
          result.data.checkout?.state === "preparing" ? "Your payment session is being prepared. Refresh this booking shortly." :
          "Stripe is processing the payment. Your booking will update after payment confirmation.");
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  };
  return <div className="mt-5"><div className="flex flex-wrap gap-3"><Button loading={busy === "resume"} disabled={Boolean(busy)} onClick={() => act("resume")}><CreditCard size={17} /> Resume secure payment</Button><Button variant="secondary" loading={busy === "cancel"} disabled={Boolean(busy)} onClick={() => act("cancel")}>Cancel unpaid hold</Button></div>{booking.expiresAt && <p className="text-sm text-slate-600 mt-3">Payment hold expires {new Date(booking.expiresAt).toLocaleString()}.</p>}{message && <p className="form-alert mt-3" role="status">{message}</p>}{error && <p className="form-alert error mt-3" role="alert">{error}</p>}</div>;
}

export function CustomerCatalog({ filters = {}, compact = false }) {
  const [params] = useSearchParams();
  const appliedFilters = { category: params.get("category"), q: params.get("q"),
    startDate: params.get("startDate"), endDate: params.get("endDate"), guests: params.get("guests"), ...filters };
  const state = useCatalog(appliedFilters);
  return <>{!compact && <PageHeader eyebrow="CUSTOMER SPACE" title="Explore Available Units" description="Rooms, apartments, and vehicles currently published by active businesses." />}
    <CatalogResults state={state} filters={appliedFilters} />
  </>;
}

export function CustomerUnitDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [guests, setGuests] = useState(params.get("guests") || "1");
  const currentId = useRef(id); currentId.current = id;
  const [unit, setUnit] = useState(null);
  const [business, setBusiness] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(params.get("startDate") || "");
  const [endDate, setEndDate] = useState(params.get("endDate") || "");
  const [quote, setQuote] = useState(null);
  const [checking, setChecking] = useState(false);
  const availabilityRequest = useRef(null);
  const selectedStart = params.get("startDate") || "";
  const selectedEnd = params.get("endDate") || "";
  const selectedGuests = params.get("guests") || "1";
  useEffect(() => {
    availabilityRequest.current?.abort(); setChecking(false); setQuote(null);
    setStartDate(selectedStart); setEndDate(selectedEnd); setGuests(selectedGuests);
    return () => availabilityRequest.current?.abort();
  }, [id, selectedStart, selectedEnd, selectedGuests]);
  const load = useCallback(async () => {
    setLoading(true); setError(""); setUnit(null); setBusiness(null); setQuote(null);
    try {
      const unitResult = await catalogApi.unit(id);
      const businessResult = await catalogApi.business(unitResult.data.businessId);
      if (currentId.current === id) { setUnit(unitResult.data); setBusiness(businessResult.data); }
    } catch (cause) { if (currentId.current === id) setError(errorMessage(cause)); }
    finally { if (currentId.current === id) setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const check = async (event) => {
    event.preventDefault(); availabilityRequest.current?.abort();
    const controller = new AbortController(); availabilityRequest.current = controller;
    setChecking(true); setError(""); setQuote(null);
    try { const result = await catalogApi.availability(id, startDate, endDate, { guests, signal: controller.signal }); if (!controller.signal.aborted && currentId.current === id) setQuote(result.data); }
    catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  };
  if (loading) return <LoadingState />;
  if (!unit) return <ErrorState error={error} onRetry={load} />;
  return <><PageHeader eyebrow="CUSTOMER SPACE" title={unit.title} description={`${business?.name || ""}${business?.city ? ` · ${business.city}` : ""}`} action={<Link className="btn btn-secondary" to="/search"><ArrowLeft size={16} /> All units</Link>} />
    <div className="booking-detail-grid"><Card className="overflow-hidden"><ImageGallery images={unit.images} title={unit.title} />
      <div className="p-6"><Badge tone="green">{business?.category?.replaceAll("_", " ") || "Unit"}</Badge><h2 className="panel-title mt-3">About this unit</h2>{business && <Link className="text-link mt-3" to={`/listing/${business._id}`}>View {business.name} &amp; business images</Link>}<p className="text-slate-600 mt-2">{unit.description || "No description has been provided."}</p><p className="text-sm mt-4">{unit.address || business?.address || business?.city}</p><UnitSpecifications unit={unit} /></div></Card>
      <Card className="p-6"><h2 className="panel-title">Check availability</h2><p className="text-sm text-slate-600 mt-2">Current unit rate: {money(unit.price, unit.currency)} per day or night. The final amount is calculated by the server.</p><form onSubmit={check} className="booking-date-form"><label>Start date<input className="input" type="date" min={today()} required disabled={checking} value={startDate} onChange={(event) => { setStartDate(event.target.value); setQuote(null); }} /></label><label>End date<input className="input" type="date" min={startDate || today()} required disabled={checking} value={endDate} onChange={(event) => { setEndDate(event.target.value); setQuote(null); }} /></label><label>Guests<input className="input" type="number" min="1" max={unit.details?.hotel?.capacity ?? unit.details?.apartment?.maxGuests ?? unit.details?.car?.seats} required disabled={checking} value={guests} onChange={(event) => { setGuests(event.target.value); setQuote(null); }} /></label><Button type="submit" loading={checking}>Check dates</Button></form>{error && <p className="form-alert error" role="alert">{error}</p>}{quote && <div className="booking-quote"><Badge tone={quote.available ? "green" : "orange"}>{quote.available ? "Available" : "Unavailable"}</Badge><p>{quote.quantity} day(s) · {money(quote.totalAmount, quote.currency)} total</p>{quote.available && <Link className="btn btn-primary" to={`/checkout?${new URLSearchParams({ unitId: id, startDate, endDate, guests })}`}>Continue to checkout <ArrowRight size={16} /></Link>}</div>}</Card></div>
  </>;
}

export function BookingCheckout() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const unitId = params.get("unitId");
  const guests = params.get("guests") || "1";
  const [document, setDocument] = useState(null);
  const [unit, setUnit] = useState(null);
  const [business, setBusiness] = useState(null);
  const startDate = params.get("startDate") || "";
  const endDate = params.get("endDate") || "";
  const [quote, setQuote] = useState(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(Boolean(unitId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    setDocument(null); setUnit(null); setBusiness(null);
    if (!unitId) { setLoading(false); return; }
    setLoading(true); setUnit(null); setBusiness(null); setError("");
    let active = true;
    customerApi.unit(unitId).then(async (unitResult) => {
      const businessResult = await customerApi.business(unitResult.data.businessId);
      if (active) { setUnit(unitResult.data); setBusiness(businessResult.data); }
    }).catch((cause) => active && setError(errorMessage(cause)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [unitId]);
  useEffect(() => {
    setQuote(null);
    if (!unitId || !startDate || !endDate) { setChecking(false); return; }
    setChecking(true);
    const controller = new AbortController();
    let active = true;
    customerApi.availability(unitId, startDate, endDate, { signal: controller.signal, guests })
      .then((result) => { if (active) { setQuote(result.data); setError(""); } })
      .catch((cause) => { if (active && cause.name !== "AbortError") { setQuote(null); setError(errorMessage(cause)); } })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; controller.abort(); };
  }, [unitId, startDate, endDate, guests]);
  const changeDate = (key, value) => {
    setQuote(null); setError("");
    const next = new URLSearchParams(params); next.set(key, value); setParams(next, { replace: true });
  };
  const submit = async () => {
    if (submitting.current || !unit || !quote?.available || checking) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      const fields = { unitId, businessId: unit.businessId, startDate, endDate, guests };
      let body = fields;
      if (document) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(document.type) || document.size > 5 * 1024 * 1024) throw new Error("Use a JPEG, PNG, or WebP document up to 5 MB.");
        body = new FormData(); Object.entries(fields).forEach(([key, value]) => body.append(key, value)); body.append("document", document);
      }
      const result = await customerApi.createBooking(body);
      if (!result.checkoutUrl) throw new Error("The payment link was missing from the booking response.");
      window.location.assign(result.checkoutUrl);
    } catch (cause) { setError(errorMessage(cause)); setBusy(false); submitting.current = false; }
  };
  return <div className="checkout-page"><header className="checkout-header"><div className="container flex items-center justify-between"><Brand /><span className="checkout-pill"><LockKeyhole size={16} /> Secure Stripe checkout</span><Link to={unitId ? `/units/${unitId}?${new URLSearchParams({ startDate, endDate, guests })}` : "/customer/catalog"} className="text-link"><ArrowLeft size={16} /> Back to units</Link></div></header>
    <main className="container checkout-content"><Card className="checkout-step"><div className="step-circle">2</div><div><h1>Secured Reservation &amp; Payment</h1><p>Check dates, then continue to Stripe to complete payment.</p></div><Badge tone="orange">Booking pending until payment</Badge></Card>
      {loading ? <LoadingState /> : !unit ? <ErrorState error={error || "Choose an available unit to begin checkout."} onRetry={() => window.location.assign("/customer/catalog")} /> :
        <div className="checkout-columns"><div className="checkout-main"><Card className="checkout-block"><div className="checkout-block-head"><span>1</span><h2>Traveler &amp; Contact Information</h2><Badge>Primary Guest</Badge></div><div className="checkout-fields"><label>Full Legal Name<input className="input" value={user?.fullName || ""} readOnly /></label><div className="two-fields"><label>Email Address<input className="input" value={user?.email || ""} readOnly /></label><label>Mobile Phone<input className="input" value={user?.phone || ""} readOnly /></label></div></div></Card>
          <Card className="checkout-block"><div className="checkout-block-head"><span>2</span><h2>Dates &amp; Payment Authorization</h2><Badge tone="blue">Stripe hosted</Badge></div><div className="two-fields"><label>START DATE<input className="input" type="date" min={today()} disabled={busy} value={startDate} onChange={(event) => changeDate("startDate", event.target.value)} /></label><label>END DATE<input className="input" type="date" min={startDate || today()} disabled={busy} value={endDate} onChange={(event) => changeDate("endDate", event.target.value)} /></label></div><label className="field mt-4">Guests<input className="input" type="number" min="1" max={unit.details?.hotel?.capacity ?? unit.details?.apartment?.maxGuests ?? unit.details?.car?.seats} disabled={busy} value={guests} onChange={(event) => changeDate("guests", event.target.value)} /></label><label className="field mt-4">Booking document (optional)<input className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => setDocument(event.target.files?.[0] || null)} /><small>JPEG, PNG, or WebP up to 5 MB. Only your business owner can access the uploaded document.</small></label><div className="info-strip mt-5"><ShieldCheck size={20} /> Your card details are collected by Stripe after you continue. Your reservation is confirmed after Stripe verifies payment.</div></Card>
          {error && <p className="form-alert error" role="alert">{error} <Link className="text-link" to="/customer/bookings">View my bookings</Link></p>}{checking && <LoadingState label="Checking dates and calculating your total…" />}<Button className="w-full justify-center checkout-pay" onClick={submit} disabled={!quote?.available || busy || checking} loading={busy}><LockKeyhole size={18} /> Continue to secure payment</Button><p className="checkout-disclaimer">The reservation is held for a limited time. Returning to this page does not confirm payment.</p></div>
          <aside className="checkout-aside"><Card className="checkout-summary"><h2>Reservation Summary</h2>{unit.images?.[0]?.url ? <img className="booking-summary-image" src={unit.images[0].url} alt={unit.title} /> : <div className="summary-art"><BedDouble size={46} /></div>}<h3 className="panel-title mt-4">{unit.title}</h3><p className="text-sm text-slate-600">{business?.name} · {business?.city}</p><div className="summary-pair"><span>STAY DATES<strong>{startDate || "—"} – {endDate || "—"}</strong></span><span>DURATION<strong>{quote?.quantity || "—"} days</strong></span></div><h3>Price Breakdown</h3><div className="price-line"><span>Unit rate</span><span>{money(quote?.unitPrice, quote?.currency)}</span></div><div className="price-line"><span>Subtotal</span><span>{money(quote?.subtotal, quote?.currency)}</span></div><div className="price-line total"><span>Total Due Now</span><strong>{money(quote?.totalAmount, quote?.currency)}</strong></div>{quote && <Badge tone={quote.available ? "green" : "orange"}>{quote.available ? "Available for these dates" : "Unavailable for these dates"}</Badge>}</Card></aside></div>}</main><SiteFooter /></div>;
}

export function PaymentReturn({ kind }) {
  const [params] = useSearchParams();
  const bookingId = params.get("bookingId");
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pollingEnded, setPollingEnded] = useState(false);
  const pollCount = useRef(0);
  const inFlight = useRef(null);
  const currentBookingId = useRef(bookingId);
  currentBookingId.current = bookingId;
  const load = useCallback(async () => {
    if (!bookingId) { setError("No booking reference was supplied."); setLoading(false); return; }
    if (inFlight.current === bookingId) return;
    inFlight.current = bookingId;
    try {
      const result = await customerApi.syncPayment(bookingId);
      if (currentBookingId.current === bookingId) { setBooking(result.data); setError(""); }
    } catch (cause) { if (currentBookingId.current === bookingId) setError(errorMessage(cause)); }
    finally {
      if (currentBookingId.current === bookingId) setLoading(false);
      if (inFlight.current === bookingId) inFlight.current = null;
    }
  }, [bookingId]);
  useEffect(() => {
    setBooking(null); setLoading(true); setError(""); setPollingEnded(false); pollCount.current = 0;
    load();
  }, [load]);
  useEffect(() => {
    if (kind !== "success" || !booking || booking.status !== "progress" || paidBooking(booking) || error || pollingEnded) return;
    const timer = window.setInterval(() => {
      if (++pollCount.current >= 60) { setPollingEnded(true); return; }
      load();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [kind, booking?.status, booking?.isValid, error, pollingEnded, load]);
  return <><SiteHeader /><main className="container payment-return"><Card className="p-8"><Badge tone={paidBooking(booking) ? "green" : "orange"}>{kind === "success" ? "PAYMENT RETURN" : "CHECKOUT EXIT"}</Badge><h1 className="text-3xl font-bold mt-4">{paymentReturnTitle(booking, kind)}</h1><p className="text-slate-600 mt-3">{paidBooking(booking) ? "Your payment is confirmed in the booking record." : booking?.status === "expired" ? "This unpaid reservation has been released. Choose a unit and dates to try again." : kind === "cancel" ? "Payment has not been confirmed. You can resume Stripe Checkout or cancel your unpaid hold." : "Your reservation status is read from the backend. We are waiting for verified Stripe payment confirmation."}</p>{loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={load} /> : booking && <><div className="receipt-preview mt-6"><div className="receipt-cell"><span>BOOKING CODE</span><strong>{booking.code}</strong></div><div className="receipt-cell"><span>STATUS</span><strong>{displayStatus(booking)}</strong></div><div className="receipt-cell"><span>DATES</span><strong>{new Date(booking.startDate).toLocaleDateString()} – {new Date(booking.endDate).toLocaleDateString()}</strong></div><div className="receipt-cell"><span>TOTAL</span><strong>{money(booking.totalAmount, booking.currency)}</strong></div></div>{pollingEnded && <p className="form-alert mt-4" role="status">Payment confirmation is taking longer than expected. Refresh the status or check My bookings shortly. Do not make another payment.</p>}<PendingBookingActions booking={booking} onUpdate={load} /></>}<div className="flex flex-wrap gap-3 mt-6"><Link className="btn btn-primary" to="/customer/bookings">My bookings <ArrowRight size={16} /></Link><Button variant="secondary" onClick={load}>Refresh status</Button>{paidBooking(booking) && <Link className="btn btn-secondary" to={`/customer/bookings/${booking._id}`}>View reservation</Link>}{["expired", "cancelled"].includes(booking?.status) && <Link className="btn btn-secondary" to="/customer/catalog">Explore units</Link>}</div></Card></main><SiteFooter /></>;
}

export function CustomerBookingsLive() {
  const [state, setState] = useState({ loading: true, bookings: [], error: "" });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try { const result = await customerApi.bookings(); setState({ loading: false, bookings: result.data || [], error: "" }); }
    catch (cause) { setState((current) => ({ ...current, loading: false, error: errorMessage(cause) })); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <><PageHeader eyebrow="CUSTOMER SPACE" title="My Bookings" description="Reservations and payment status from your FAARO account." action={<Link to="/customer/catalog" className="btn btn-primary">Explore units <ArrowRight size={16} /></Link>} /><Card className="p-6">{state.loading ? <LoadingState /> : state.error ? <ErrorState error={state.error} onRetry={load} /> : state.bookings.length === 0 ? <EmptyState title="No bookings yet" description="Choose a unit to start your first reservation." /> : <div className="booking-list">{state.bookings.map((booking) => <Link to={`/customer/bookings/${booking._id}`} className="booking-list-row" key={booking._id}><div><Badge tone={paidBooking(booking) ? "green" : "orange"}>{displayStatus(booking)}</Badge><h2>{booking.unitId?.title || "Unit unavailable"}</h2><p>{booking.businessId?.name || "Business"} · {new Date(booking.startDate).toLocaleDateString()} – {new Date(booking.endDate).toLocaleDateString()}</p></div><strong>{money(booking.totalAmount, booking.currency)}</strong><ArrowRight size={17} /></Link>)}</div>}</Card></>;
}

export function CustomerBookingDetailLive() {
  const { id } = useParams();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const result = await customerApi.booking(id); setBooking(result.data); setError(""); }
    catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { setBooking(null); setLoading(Boolean(id)); if (id) load(); }, [id, load]);
  return <>
    <PageHeader eyebrow="CUSTOMER SPACE" title="Booking Details" description="Your reservation and payment record."
      action={<Link className="btn btn-secondary" to="/customer/bookings"><ArrowLeft size={16} /> My bookings</Link>} />
    {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={load} /> : !booking ? <EmptyState title="No booking selected" /> :
      <Card className="p-6">
        <Badge tone={paidBooking(booking) ? "green" : "orange"}>{displayStatus(booking)}</Badge>
        <h2 className="panel-title mt-4">{booking.unitId?.title || "Unit unavailable"}</h2>
        <p className="text-slate-600">{booking.businessId?.name}</p>
        <div className="receipt-preview mt-5">
          <div className="receipt-cell"><span>BOOKING CODE</span><strong>{booking.code}</strong></div>
          <div className="receipt-cell"><span>DATES</span><strong>{new Date(booking.startDate).toLocaleDateString()} – {new Date(booking.endDate).toLocaleDateString()}</strong></div>
          <div className="receipt-cell"><span>UNIT RATE AT BOOKING</span><strong>{money(booking.unitPrice, booking.currency)}</strong></div>
          <div className="receipt-cell"><span>BOOKING TOTAL</span><strong>{money(booking.totalAmount, booking.currency)}</strong></div>
          <div className="receipt-cell"><span>PAYMENT</span><strong>{paidBooking(booking) ? "paid" : booking.paymentStatus}</strong></div>
        </div>
        <PendingBookingActions booking={booking} onUpdate={load} />
      </Card>}
  </>;
}

