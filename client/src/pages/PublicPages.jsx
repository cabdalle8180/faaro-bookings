import { useState } from "react";
import { ArrowLeft, ArrowRight, BedDouble, Building2, CalendarDays, CarFront, CircleHelp, CreditCard, Filter, LockKeyhole, MapPin, Search, ShieldCheck, SlidersHorizontal, Users, Wifi } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { catalogApi } from "../api/catalog";
import { errorMessage } from "../api/client";
import { useCatalog, CatalogResults, ImageGallery } from "../components/Catalog";
import { CustomerCatalog, CustomerUnitDetail } from "./BookingFlow";
import { Badge, Brand, Button, Card, EmptyState, SiteFooter, SiteHeader, UnavailableState, LoadingState, ErrorState } from "../components/UI";

// Navigation categories only; no listing records are bundled.
const categories = [
  { key: "hotel", label: "Hotels", icon: BedDouble, description: "Stays and suites" },
  { key: "car_rental", label: "Cars", icon: CarFront, description: "Vehicle rentals" },
  { key: "apartment", label: "Apartments", icon: Building2, description: "Homes and villas" },
];

function SectionTitle({ eyebrow, title, description, action }) {
  return <div className="section-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

function CategoryTile({ item }) {
  const Icon = item.icon;
  return <Link to={`/search?category=${item.key}`} className={`category-tile category-${item.key}`}><div className="category-art"><Icon size={84} strokeWidth={1.1} /></div><div className="category-tile-bottom"><span className="category-tag">{item.label.toUpperCase()}</span><h3>{item.label}</h3><p>{item.description}</p><span>Explore {item.label.toLowerCase()} <ArrowRight size={15} /></span></div></Link>;
}

function CatalogSection({ eyebrow, title, description, category, state }) {
  return <section className="catalog-section"><SectionTitle eyebrow={eyebrow} title={title} description={description}
    action={<Link className="text-link" to={`/search?category=${category}`}>View all <ArrowRight size={15} /></Link>} />
    <CatalogResults state={state} category={category} showBusinesses />
  </section>;
}
export function HomePage() {
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [guests, setGuests] = useState("");
  const [category, setCategory] = useState("hotel");
  const [query, setQuery] = useState("");
  const submit = (event) => { event.preventDefault(); navigate(`/search?${new URLSearchParams({ category, q: query, startDate, endDate, guests })}`); };
  return <><SiteHeader /><main><section className="home-hero"><div className="container hero-inner"><Badge tone="blue"><ShieldCheck size={13} /> FAARO STAYS &amp; MOBILITY</Badge><h1>Find your perfect stay or ride</h1><p>Explore hotels, apartments, and rental cars in one place.</p><div className="hero-tabs">{categories.map(({ key, label, icon: Icon }) => <button key={key} className={category === key ? "active" : ""} onClick={() => setCategory(key)}><Icon size={16} />{label}</button>)}</div><form className="hero-search" onSubmit={submit}><label><MapPin size={19} /><span><small>WHERE</small><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search destinations, airport, city" /></span></label><label><CalendarDays size={19} /><span><small>CHECK-IN</small><input type="date" aria-label="Check-in date" min={new Date().toISOString().slice(0, 10)} value={startDate} onChange={(event) => setStartDate(event.target.value)} required={Boolean(endDate)} /></span></label><label><CalendarDays size={19} /><span><small>CHECK-OUT</small><input type="date" aria-label="Check-out date" min={startDate || new Date().toISOString().slice(0, 10)} value={endDate} onChange={(event) => setEndDate(event.target.value)} required={Boolean(startDate)} /></span></label><label><Users size={19} /><span><small>WHO</small><input type="number" min="1" placeholder="Guests" aria-label="Guests" value={guests} onChange={(event) => setGuests(event.target.value)} /></span></label><Button type="submit" aria-label="Search"><Search size={20} /></Button></form><div className="hero-note">Browse published units. Choose dates to see availability and a price for your stay or rental.</div></div></section><section className="explore-section"><div className="container"><SectionTitle eyebrow="INTEGRATED DISCOVERY" title="Explore FAARO" description="Choose the kind of journey you’re planning." /><div className="category-grid">{categories.map((item) => <CategoryTile item={item} key={item.key} />)}</div></div></section><div className="container"><CatalogSection state={catalog} eyebrow="STAYS" title="Popular Stays & Hotels" description="Explore our hotels and their published rooms." category="hotel" /><CatalogSection state={catalog} eyebrow="MOBILITY" title="Trending Fleet & Vehicles" description="Browse available rental businesses and vehicles." category="car_rental" /><CatalogSection state={catalog} eyebrow="HOMES" title="Curated Apartments & Villas" description="Discover apartments and their published units." category="apartment" /></div><section className="why-section"><div className="container"><SectionTitle eyebrow="THE FAARO PLATFORM" title="One place for every journey" description="A single account links your available FAARO services." /><div className="feature-grid"><Card><ShieldCheck size={24} /><h3>Secure sign-in</h3><p>Sign in to manage your reservations and payments.</p></Card><Card><Users size={24} /><h3>Role-based access</h3><p>Customer, owner, and admin workspaces are kept separate.</p></Card><Card><Building2 size={24} /><h3>Managed businesses</h3><p>Administrators can create and manage business ownership.</p></Card><Card><CircleHelp size={24} /><h3>Clear availability</h3><p>Choose dates and check the current price before booking.</p></Card></div><div className="partner-banner"><div><span className="eyebrow">FAARO PARTNER NETWORK</span><h2>Partner with FAARO</h2><p>Business accounts are set up by an administrator in the current platform.</p></div><Link className="btn btn-primary" to="/register">Create a customer account <ArrowRight size={17} /></Link></div></div></section></main><SiteFooter /></>;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") || "all";
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [query, setQuery] = useState(params.get("q") || "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const changeCategory = (value) => { const next = new URLSearchParams(params); if (value === "all") next.delete("category"); else next.set("category", value); setParams(next); };
  return <><SiteHeader /><main className="search-page"><div className="search-toolbar"><div className="container search-toolbar-inner"><div><MapPin size={19} /><strong>{query || "Explore all destinations"}</strong><Badge tone="blue">Published units</Badge></div><div className="search-toolbar-controls"><button className={category === "all" ? "active" : ""} onClick={() => changeCategory("all")}>All Verticals</button>{categories.map((item) => <button key={item.key} className={category === item.key ? "active" : ""} onClick={() => changeCategory(item.key)}>{item.label}</button>)}<select className="input" aria-label="Sort results" disabled><option>Sort: Recommended</option></select></div></div></div><div className="container search-layout"><aside className={`filter-card card ${filtersOpen ? "filters-open" : ""}`}><div className="filter-heading"><h2><Filter size={19} /> Filters</h2><button type="button" className="filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>{filtersOpen ? "Hide filters" : "Show filters"}</button><button onClick={() => { setMinimum(""); setMaximum(""); setQuery(""); setParams({}); }}>Reset all</button></div><div className="filter-group"><h3>Vertical Category</h3><label className={category === "all" ? "filter-option selected" : "filter-option"}><input type="radio" checked={category === "all"} onChange={() => changeCategory("all")} />All Stays &amp; Mobility</label>{categories.map((item) => <label key={item.key} className={category === item.key ? "filter-option selected" : "filter-option"}><input type="radio" checked={category === item.key} onChange={() => changeCategory(item.key)} />{item.label}</label>)}</div><div className="filter-group"><h3>Destination</h3><input className="input" value={query} placeholder="Search city or destination" onChange={(event) => setQuery(event.target.value)} /><button className="text-link mt-3" onClick={() => { const next = new URLSearchParams(params); if (query) next.set("q", query); else next.delete("q"); setParams(next); }}>Apply search</button></div><div className="filter-group"><h3>Price Range</h3><p>Per night or rental day</p><div className="two-fields"><input className="input" type="number" min="0" placeholder="Min" value={minimum} onChange={(event) => setMinimum(event.target.value)} /><input className="input" type="number" min="0" placeholder="Max" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></div></div><div className="filter-group"><h3>Dates &amp; guests</h3>{[["startDate", "Check-in", "date"], ["endDate", "Check-out", "date"], ["guests", "Guests", "number"]].map(([key, label, type]) => <label className="field" key={key}><span>{label}</span><input className="input" type={type} min={type === "number" ? "1" : new Date().toISOString().slice(0, 10)} value={params.get(key) || ""} onChange={(event) => { const next = new URLSearchParams(params); if (event.target.value) next.set(key, event.target.value); else next.delete(key); setParams(next); }} /></label>)}</div><div className="filter-group"><h3>Guest &amp; Driver Rating</h3><div className="rating-options"><button disabled>☆ 4.5+</button><button disabled>☆ 4.8+</button><button disabled>☆ 5.0</button></div></div><div className="filter-group"><h3>Features &amp; Amenities</h3>{["Free Wi-Fi", "Pool & Cabanas", "EV charging", "Automatic transmission", "Ocean view", "Instant book"].map((label) => <label className="checkbox-line muted" key={label}><input type="checkbox" disabled />{label}</label>)}<small className="field-hint">Category, destination, and price filters use real unit data. Rating and amenity filters are unavailable.</small></div></aside><section className="search-results"><div className="search-summary"><div><span className="eyebrow">MARKETPLACE RESULTS</span><h1>Find a stay or ride</h1><p>Browse published units and choose dates. Sign in when you are ready to book.</p></div><SlidersHorizontal size={22} /></div><CustomerCatalog filters={{ category, q: query, min: minimum, max: maximum }} compact /></section></div></main><SiteFooter /></>;
}

export function ListingDetailPage() {
  const { id } = useParams();
  const [state, setState] = useState({ loading: Boolean(id), business: null, error: "" });
  const load = useCallback(async (signal) => {
    if (!id) return;
    setState({ loading: true, business: null, error: "" });
    try { const result = await catalogApi.business(id, { signal }); if (!signal?.aborted) setState({ loading: false, business: result.data, error: "" }); }
    catch (error) { if (!signal?.aborted) setState({ loading: false, business: null, error: errorMessage(error) }); }
  }, [id]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);
  const business = state.business;
  return <><SiteHeader /><main className="detail-page"><div className="container">
    <div className="breadcrumbs"><Link to="/">Home</Link><span>/</span><Link to="/search">Explore</Link><span>/</span><span>{business?.name || "Business details"}</span></div>
    {!id ? <EmptyState title="Choose a business" action={<Link className="btn btn-primary" to="/search">Explore units</Link>} /> : state.loading ? <LoadingState /> : state.error ? <ErrorState error={state.error} onRetry={() => load()} /> : business && <>
      <div className="detail-title"><div><Badge tone="orange">{business.category.replaceAll("_", " ")}</Badge><h1>{business.name}</h1><p><MapPin size={15} /> {business.city} · {business.address}</p></div><Link to="/search" className="btn btn-secondary btn-small"><ArrowLeft size={16} /> Back to results</Link></div>
      <Card className="overflow-hidden"><ImageGallery images={business.images} title={business.name} /></Card>
      <div className="detail-columns"><div className="detail-body"><Card className="detail-host"><div className="detail-host-top"><span className="round-icon"><Building2 size={21} /></span><div><strong>{business.name}</strong><p>{business.description || "No description has been provided."}</p></div></div></Card>
        <section className="detail-section"><h2>Available Units at This Property</h2><p>Select a room, apartment, or vehicle to check dates and reserve.</p><CustomerCatalog compact filters={{ businessId: id }} /></section>
      </div><aside className="detail-aside"><Card className="reservation-card"><h2 className="panel-title">Business information</h2><div className="profile-fields mt-5"><div><span>Address</span><strong>{business.address}</strong></div><div><span>City</span><strong>{business.city}</strong></div><div><span>Contact phone</span><a href={`tel:${business.contactPhone}`}>{business.contactPhone}</a></div><div><span>Opening hours</span><strong>{business.openHours}</strong></div></div><p>Choose a unit to see its rate, capacity, and availability.</p></Card></aside></div>
    </>}
  </div></main><SiteFooter /></>;
}

export function UnitDetailPage() {
  return <><SiteHeader /><main className="detail-page"><div className="container"><CustomerUnitDetail /></div></main><SiteFooter /></>;
}
