import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BedDouble, Building2 } from "lucide-react";
import { Link } from "react-router-dom";
import { catalogApi, catalogQuery } from "../api/catalog";
import { errorMessage } from "../api/client";
import { Badge, Card, EmptyState, ErrorState, LoadingState } from "./UI";

export const money = (value, currency = "USD") => value == null ? "—" :
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);

export function useCatalog(filters = {}) {
  const query = catalogQuery(filters);
  const [attempt, retry] = useState(0);
  const [state, setState] = useState({ loading: true, units: [], businesses: [], error: "" });
  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: "" }));
    const options = { signal: controller.signal };
    Promise.all([catalogApi.units(Object.fromEntries(new URLSearchParams(query)), options), catalogApi.businesses(options)])
      .then(([units, businesses]) => setState({ loading: false, units: units.data, businesses: businesses.data, error: "" }))
      .catch((error) => { if (!controller.signal.aborted) setState({ loading: false, units: [], businesses: [], error: errorMessage(error) }); });
    return () => controller.abort();
  }, [query, attempt]);
  return { ...state, retry: useCallback(() => retry((value) => value + 1), []) };
}

export function CatalogImage({ src, alt, className = "", large = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} /> :
    <div className={`booking-unit-art ${large ? "large" : ""}`}><BedDouble size={38} /><span className="text-sm">Image unavailable</span></div>;
}

export function ImageGallery({ images = [], title }) {
  return images.length ? <div className="booking-gallery">{images.map((image, index) =>
    <a key={image.publicId || image.url || index} href={image.url} target="_blank" rel="noreferrer" aria-label={`Open ${title} image ${index + 1}`}>
      <CatalogImage src={image.url} alt={`${title} — image ${index + 1}`} />
    </a>)}</div> : <CatalogImage alt={title} large />;
}

export function UnitCards({ units, businesses, filters = {} }) {
  const selected = catalogQuery({ startDate: filters.startDate, endDate: filters.endDate, guests: filters.guests });
  return <div className="booking-unit-grid">{units.map((unit) => {
    const business = businesses.find((item) => item._id === unit.businessId);
    return <Card className="booking-unit-card" key={unit._id}>
      <CatalogImage src={unit.images?.[0]?.url || business?.images?.[0]?.url} alt={unit.title} />
      <div className="p-5"><Badge tone="green">{business?.category?.replaceAll("_", " ") || "Unit"}</Badge>
        <h2 className="panel-title mt-3">{unit.title}</h2>
        {business && <Link className="text-link mt-1" to={`/listing/${business._id}${selected ? `?${selected}` : ""}`}>{business.name}{business.city ? ` · ${business.city}` : ""}</Link>}
        <p className="text-sm text-slate-600 mt-3">{unit.description}</p>
        <div className="booking-unit-bottom"><strong>{money(unit.price, unit.currency)}<small className="block text-xs font-normal">per {business?.category === "car_rental" ? "day" : "night"}</small></strong>
          <Link className="btn btn-dark btn-small" to={`/units/${unit._id}${selected ? `?${selected}` : ""}`}>View unit <ArrowRight size={15} /></Link></div>
      </div>
    </Card>;
  })}</div>;
}

export function BusinessCards({ businesses }) {
  return <div className="booking-unit-grid">{businesses.map((business) => <Link key={business._id} className="card booking-unit-card" to={`/listing/${business._id}`}>
    <CatalogImage src={business.images?.[0]?.url} alt={business.name} />
    <div className="p-5"><Badge tone="blue"><Building2 size={13} /> Business</Badge><h3 className="panel-title mt-3">{business.name}</h3><p>{business.city}</p><span className="text-link mt-3">View business & units <ArrowRight size={15} /></span></div>
  </Link>)}</div>;
}

export function CatalogResults({ state, filters = {}, category, showBusinesses = false }) {
  if (state.loading) return <LoadingState />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.retry} />;
  const businesses = state.businesses.filter((business) => !category || business.category === category);
  const units = state.units.filter((unit) => businesses.some((business) => business._id === unit.businessId));
  return <>{showBusinesses && businesses.length > 0 && <div className="mb-6"><BusinessCards businesses={businesses} /></div>}
    {units.length ? <UnitCards units={units} businesses={businesses} filters={filters} /> : <EmptyState title="No units match your search" description="Try another category, destination, price range, or dates." />}</>;
}
