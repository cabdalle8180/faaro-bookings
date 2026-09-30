import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BedDouble, Building2, CarFront, Pencil, Plus } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ownerApi } from "../api/owner";
import { errorMessage } from "../api/client";
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, Select, UnavailableState } from "../components/UI";

function SavedImages({ images, title, removed, setRemoved, disabled }) {
  return <div className="owner-image-grid mt-4">{images.map((image) => <div className={`owner-image-item ${removed.includes(image.publicId) ? "removed" : ""}`} key={image.publicId}>
    <img src={image.url} alt={title} /><Button type="button" variant="secondary" className="btn-small" disabled={disabled}
      onClick={() => setRemoved((current) => current.includes(image.publicId) ? current.filter((id) => id !== image.publicId) : [...current, image.publicId])}>
      {removed.includes(image.publicId) ? "Keep image" : "Remove on save"}</Button>
  </div>)}</div>;
}

const categories = [
  { value: "hotel", label: "Hotel", icon: BedDouble },
  { value: "car_rental", label: "Rental vehicle", icon: CarFront },
  { value: "apartment", label: "Apartment", icon: Building2 },
];
const businessBlank = { name: "", description: "", category: "", contactPhone: "", city: "", address: "", openHours: "" };
const detailFields = {
  hotel: [["roomType", "Room type", "text"], ["beds", "Beds", "number"], ["capacity", "Guest capacity", "number"]],
  car_rental: [["make", "Make", "text"], ["model", "Model", "text"], ["seats", "Seats", "number"], ["plateNumber", "Plate number", "text"]],
  apartment: [["bedrooms", "Bedrooms", "number"], ["bathrooms", "Bathrooms", "number"], ["maxGuests", "Maximum guests", "number"]],
};
const emptyUnit = { code: "", title: "", price: "", description: "", address: "", active: false };
const categoryLabel = (value) => categories.find((category) => category.value === value)?.label || value;
const money = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);
const imageError = (files, existingCount = 0) => files.length + existingCount > 5 ? "You can save up to 5 images." :
  files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)
    ? "Use JPEG, PNG, or WebP images up to 5 MB each." : "";

export function OwnerBusinessLive() {
  const [state, setState] = useState({ loading: true, business: null, error: "" });
  const [form, setForm] = useState(businessBlank);
  const [images, setImages] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef(null);
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const { data } = await ownerApi.business();
      setState({ loading: false, business: data, error: "" });
      setForm(Object.fromEntries(Object.keys(businessBlank).map((key) => [key, data[key] || ""])));
    } catch (cause) {
      if (cause.status === 404) { setState({ loading: false, business: null, error: "" }); setForm(businessBlank); }
      else setState((current) => ({ ...current, loading: false, error: errorMessage(cause) }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const submit = async (event) => {
    event.preventDefault(); setError(""); setMessage("");
    const validation = imageError(images, (state.business?.images?.length || 0) - removed.length);
    if (validation) { setError(validation); return; }
    setBusy(true);
    try {
      const payload = new FormData();
      for (const [key, value] of Object.entries(form)) payload.append(key, value);
      if (state.business) payload.append("retainedImageIds", JSON.stringify(state.business.images.filter((image) => !removed.includes(image.publicId)).map((image) => image.publicId)));
      images.forEach((file) => payload.append("images", file));
      const result = state.business ? await ownerApi.updateBusiness(payload) : await ownerApi.createBusiness(payload);
      setMessage(result.message); setImages([]); setRemoved([]); if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const field = (key, label, required = true) => <Input key={key} label={label} required={required} disabled={busy || state.business?.status === "suspended"}
    value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} />;
  return <>
    <PageHeader eyebrow="PARTNER HUB" title={state.business ? "Business Profile" : "Create Your Business"}
      description="Business → Unit → Publish. Manage the business registered to your authenticated owner account."
      action={state.business && <Link className="btn btn-dark" to="/owner/units/new"><Plus size={16} /> Add new unit</Link>} />
    {state.loading ? <LoadingState /> : state.error ? <ErrorState error={state.error} onRetry={load} /> :
      <div className="two-column-panels"><Card className="p-6">
        <h2 className="panel-title">{state.business ? "Business Details" : "Register Business Details"}</h2>
        {state.business && <Badge tone={state.business.status === "active" ? "green" : "orange"}>{state.business.status}</Badge>}
        <form onSubmit={submit} className="owner-unit-form">
          <div className="unit-form-grid">
            {field("name", "Business name")}
            <Select label="Category" required disabled={busy || Boolean(state.business)} value={form.category}
              onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>
              <option value="">Select category</option>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
            </Select>
            {field("contactPhone", "Contact phone")}{field("city", "City")}{field("address", "Address")}{field("openHours", "Opening hours")}
          </div>
          <label className="field mt-4"><span className="field-label">Description</span><textarea className="input" rows={4} disabled={busy || state.business?.status === "suspended"} value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label className="field mt-4"><span className="field-label">Add business images (up to 5 total, 5 MB each)</span><input ref={fileInput} className="input" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy || state.business?.status === "suspended"}
            onChange={(event) => setImages(Array.from(event.target.files || []))} /></label>
          {state.business?.images?.length > 0 && <SavedImages images={state.business.images} title={state.business.name} removed={removed} setRemoved={setRemoved} disabled={busy || state.business.status === "suspended"} />}
          {error && <p className="form-alert error" role="alert">{error}</p>}{message && <p className="form-alert success" role="status">{message}</p>}
          <Button type="submit" loading={busy} disabled={state.business?.status === "suspended"} className="mt-5">{state.business ? "Save business changes" : "Create business"} <ArrowRight size={16} /></Button>
        </form>
      </Card><Card className="p-6"><h2 className="panel-title">Marketplace Status</h2><p className="text-sm text-slate-600 mt-3">Save your business details, add a unit with its actual specifications and rate, then publish it to the customer catalog.</p>
        {state.business ? <><div className="status-list mt-5"><span>Business<strong>{state.business.name}</strong></span><span>Category<strong>{categoryLabel(state.business.category)}</strong></span><span>Status<Badge tone={state.business.status === "active" ? "green" : "orange"}>{state.business.status}</Badge></span></div>
          {state.business.status === "suspended" ? <UnavailableState compact title="Business suspended" description="Only an administrator can resolve a business suspension. Its units are hidden from customers." /> : <Link className="btn btn-secondary mt-5" to="/owner/units">Manage units <ArrowRight size={16} /></Link>}
        </> : <EmptyState title="No business registered yet" description="Enter your real business details in this form." />}
        <p className="field-hint mt-4">The business category is fixed after creation so unit specifications stay consistent.</p>
      </Card></div>}
  </>;
}

export function OwnerUnitsLive() {
  const location = useLocation();
  const [state, setState] = useState({ loading: true, business: null, units: [], error: "", missing: false });
  const [filter, setFilter] = useState("all");
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const business = await ownerApi.business();
      const units = await ownerApi.units();
      setState({ loading: false, business: business.data, units: units.data, error: "", missing: false });
    } catch (cause) { setState((current) => ({ ...current, loading: false, error: cause.status === 404 ? "" : errorMessage(cause), missing: cause.status === 404 })); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const publish = async (unit) => {
    setBusyId(unit._id); setActionError("");
    try { if (unit.active) await ownerApi.deactivateUnit(unit._id); else await ownerApi.updateUnit(unit._id, { active: true }); await load(); }
    catch (cause) { setActionError(errorMessage(cause)); }
    finally { setBusyId(""); }
  };
  const units = state.units.filter((unit) => filter === "all" || (filter === "published" ? unit.active : !unit.active));
  return <><PageHeader eyebrow="PARTNER HUB" title="Units & Inventory" description="Create, edit, and publish units belonging to your business."
    action={<Link className="btn btn-primary" to="/owner/units/new"><Plus size={16} /> Add new unit</Link>} />
    {location.state?.message && <p className="form-alert success" role="status">{location.state.message}</p>}
    {actionError && <p className="form-alert error" role="alert">{actionError}</p>}
    {state.loading ? <LoadingState /> : state.error ? <ErrorState error={state.error} onRetry={load} /> : state.missing ?
      <EmptyState title="Create your business first" description="Every unit must belong to your business." action={<Link className="btn btn-primary" to="/owner/business">Set up business</Link>} /> :
      <Card className="overflow-hidden"><div className="table-panel-head"><div><h2>Unit Management &amp; Live Catalog</h2><p>{state.business.name} · {categoryLabel(state.business.category)}</p></div><div className="owner-filter-tabs">{["all", "published", "draft"].map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All units" : value === "published" ? "Published" : "Unpublished"}</button>)}</div></div>
        {state.business.status === "suspended" && <p className="form-alert error mx-5">Business suspended. Its units are hidden from the customer catalog.</p>}
        <div className="table-wrap"><table className="data-table"><thead><tr><th>UNIT ASSET &amp; CATEGORY</th><th>BASE RATE</th><th>CATALOG STATUS</th><th>ACTIONS</th></tr></thead><tbody>
          {units.length === 0 ? <tr><td colSpan={4}><EmptyState title="No units to display" description="Add a unit using your real room, vehicle, or apartment details." /></td></tr> : units.map((unit) => <tr key={unit._id}><td><div className="owner-unit-cell">{unit.images?.[0]?.url ? <img src={unit.images[0].url} alt={unit.title} /> : <span className="round-icon"><BedDouble size={20} /></span>}<div><strong>{unit.title}</strong><small>{unit.code} · {categoryLabel(state.business.category)}</small></div></div></td>
            <td><strong>{money(unit.price)}</strong><small>per {state.business.category === "car_rental" ? "day" : "night"}</small></td>
            <td><Badge tone={unit.active && state.business.status === "active" ? "green" : "orange"}>{state.business.status !== "active" ? "Business suspended" : unit.active ? "Published" : "Unpublished"}</Badge></td>
            <td><div className="flex flex-wrap gap-2"><Link className="btn btn-secondary btn-small" to={`/owner/units/${unit._id}/edit`}><Pencil size={14} /> Edit</Link><Button variant={unit.active ? "secondary" : "primary"} className="btn-small" loading={busyId === unit._id} disabled={Boolean(busyId) || state.business.status !== "active"} onClick={() => publish(unit)}>{unit.active ? "Unpublish" : "Publish"}</Button></div></td></tr>)}
        </tbody></table></div><div className="table-panel-head"><p>{state.units.length} saved unit(s). Published units are visible to customers and visitors when the business is active.</p></div>
      </Card>}
  </>;
}

export function OwnerUnitEditorLive() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, business: null, unit: null, error: "", missing: false });
  const [form, setForm] = useState(emptyUnit);
  const [images, setImages] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submission = useRef(false);
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    let business;
    try {
      business = (await ownerApi.business()).data;
      const unit = id ? (await ownerApi.unit(id)).data : null;
      const detailKey = business.category === "car_rental" ? "car" : business.category;
      setForm({ ...emptyUnit, ...(unit || {}), ...(unit?.details?.[detailKey] || {}) });
      setState({ loading: false, business, unit, error: "", missing: false });
    } catch (cause) { setState({ loading: false, business: business || null, unit: null, error: cause.status === 404 && !business ? "" : errorMessage(cause), missing: cause.status === 404 && !business }); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const field = (key, label, type = "text", required = true) => <Input key={key} label={label} type={type} required={required} disabled={busy}
    min={type === "number" ? 1 : undefined} step={key === "price" ? "0.01" : type === "number" ? "1" : undefined} value={form[key] ?? ""}
    onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} />;
  const submit = async (event) => {
    event.preventDefault(); if (submission.current) return; setError("");
    const validation = imageError(images, (state.unit?.images?.length || 0) - removed.length);
    if (validation) { setError(validation); return; }
    submission.current = true; setBusy(true);
    try {
      const publishValue = event.nativeEvent.submitter?.value;
      const published = publishValue === "true" ? true : publishValue === "false" ? false : form.active;
      const category = state.business.category;
      const detailKey = category === "car_rental" ? "car" : category;
      const details = Object.fromEntries(detailFields[category].map(([key, , type]) => [key, type === "number" ? Number(form[key]) : form[key]]));
      const payload = new FormData();
      for (const key of ["code", "title", "price", "description", "address"]) payload.append(key, form[key] ?? "");
      if (state.unit) payload.append("retainedImageIds", JSON.stringify(state.unit.images.filter((image) => !removed.includes(image.publicId)).map((image) => image.publicId)));
      payload.append("active", String(published)); payload.append("details", JSON.stringify({ [detailKey]: details }));
      images.forEach((file) => payload.append("images", file));
      const result = id ? await ownerApi.updateUnit(id, payload) : await ownerApi.createUnit(payload);
      navigate("/owner/units", { state: { message: `${result.message}. ${result.data.active ? "Published to the customer catalog." : "Saved as unpublished."}` } });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { submission.current = false; setBusy(false); }
  };
  return <><PageHeader eyebrow="PARTNER HUB" title={id ? "Edit Unit" : "Add New Unit to Marketplace"}
    description="Enter the actual specifications and rate for this unit."
    action={<Link className="btn btn-secondary" to="/owner/units"><ArrowLeft size={16} /> All units</Link>} />
    {state.loading ? <LoadingState /> : state.error ? <ErrorState error={state.error} onRetry={load} /> : state.missing ?
      <EmptyState title="Create your business first" action={<Link className="btn btn-primary" to="/owner/business">Set up business</Link>} /> : state.business.status !== "active" ?
        <UnavailableState title="Business suspended" description="An active business is required to save or publish units." /> :
        <Card className="unit-composer"><div className="unit-composer-head"><div><span className="round-icon orange"><Plus size={21} /></span><div><h2>{id ? "Unit Specification" : "Add New Unit to Marketplace"}</h2><p>{state.business.name} · Unit details &amp; publishing</p></div></div><Badge tone="green">{id && state.unit.active ? "Published" : "Unpublished"}</Badge></div>
          <form onSubmit={submit} className="unit-composer-body"><span className="eyebrow">UNIT VERTICAL</span><div className="vertical-picker">{categories.map(({ value, label, icon: Icon }) => <button type="button" key={value} className={value === state.business.category ? "selected" : ""} disabled><Icon size={18} /> {label}</button>)}</div>
            <div className="unit-form-grid">{field("title", "Unit name / designation")}{field("code", "Unit code")}{field("price", "Base rate (USD)", "number")}{detailFields[state.business.category].map(([key, label, type]) => field(key, label, type))}{field("address", "Unit address (optional)", "text", false)}</div>
            <label className="field mt-4"><span className="field-label">Description</span><textarea className="input" rows={4} value={form.description} disabled={busy} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
            {state.unit?.images?.length > 0 && <SavedImages images={state.unit.images} title={state.unit.title} removed={removed} setRemoved={setRemoved} disabled={busy} />}
            <label className="field mt-4"><span className="field-label">Add images (up to 5 total, 5 MB each)</span><input className="input" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => setImages(Array.from(event.target.files || []))} /></label>
            <div className="availability-preview"><div><strong>Availability &amp; Publishing</strong><small>Calendar editing unavailable</small></div><div className="calendar-skeleton" aria-label="Availability calendar unavailable">{Array.from({ length: 14 }, (_, index) => <div key={index}><span>DAY {index + 1}</span><strong>—</strong><small>No data</small></div>)}</div><p className="text-sm text-slate-600 mt-3">Published units appear in the customer catalog. Unpublishing hides a unit from new bookings and preserves existing reservations. Reservations are checked for the customer's selected dates. Date-specific rates and calendar editing are not supported by the current backend.</p></div>
            {error && <p className="form-alert error" role="alert">{error}</p>}
            <div className="unit-composer-footer"><span>Rate is charged per {state.business.category === "car_rental" ? "day" : "night"}. Currency: USD.</span><div><Button type="submit" value="keep" name="publish" variant="secondary" loading={busy}>{state.unit?.active ? "Save changes" : "Save unpublished"}</Button><Button type="submit" value="true" name="publish" loading={busy}>Save &amp; Publish <ArrowRight size={16} /></Button></div></div>
          </form>
        </Card>}
  </>;
}
