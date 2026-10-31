import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase";

type PlaceSelection = { address: string; city: string; state: string; postalCode: string; latitude: number; longitude: number };
type AddressAutocompleteProps = { value: string; onChange: (value: string) => void; onPlaceSelected: (place: PlaceSelection) => void; required?: boolean; placeholder?: string; disabled?: boolean };

declare global { interface Window { google?: any; __roofDoctorsMapsPromise?: Promise<any> } }

function loadGoogleMaps(): Promise<any> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new Error("Google Maps API key is not configured."));
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (!window.__roofDoctorsMapsPromise) {
    window.__roofDoctorsMapsPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-roof-doctors-maps="true"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.google));
        existing.addEventListener("error", () => reject(new Error("Google Maps could not load.")));
        return;
      }
      const script = document.createElement("script");
      script.dataset.roofDoctorsMaps = "true";
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&libraries=places&v=weekly";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.google);
      script.onerror = () => reject(new Error("Google Maps could not load. Check API restrictions and billing."));
      document.head.appendChild(script);
    });
  }
  return window.__roofDoctorsMapsPromise;
}

function component(components: any[], type: string, useShort = false): string {
  const found = components.find(item => item.types?.includes(type));
  return found ? (useShort ? found.short_name : found.long_name) : "";
}

export function AddressAutocomplete({ value, onChange, onPlaceSelected, required, placeholder, disabled }: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const callbackRef = useRef(onPlaceSelected);
  const [mapsError, setMapsError] = useState("");
  useEffect(() => { callbackRef.current = onPlaceSelected; }, [onPlaceSelected]);
  useEffect(() => {
    let active = true;
    let autocomplete: any;
    let listener: any;
    loadGoogleMaps().then(google => {
      if (!active || !inputRef.current) return;
      autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
        types: ["address"],
        fields: ["address_components", "formatted_address", "geometry"]
      });
      listener = autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place.geometry?.location) { setMapsError("Select a suggested address to save its map location."); return; }
        const parts = place.address_components || [];
        const streetNumber = component(parts, "street_number");
        const route = component(parts, "route");
        const address = place.formatted_address || [streetNumber, route].filter(Boolean).join(" ");
        callbackRef.current({
          address,
          city: component(parts, "locality") || component(parts, "postal_town") || component(parts, "sublocality"),
          state: component(parts, "administrative_area_level_1", true),
          postalCode: component(parts, "postal_code"),
          latitude: place.geometry.location.lat(),
          longitude: place.geometry.location.lng()
        });
        setMapsError("");
      });
    }).catch(error => { if (active) setMapsError(error.message); });
    return () => { active = false; if (listener) listener.remove(); };
  }, []);
  return <div className="address-autocomplete-wrap">
    <input ref={inputRef} required={required} disabled={disabled} value={value} placeholder={placeholder || "Start typing a street address"} onChange={event => onChange(event.target.value)} autoComplete="off" />
    {mapsError && <small className="address-map-hint">{mapsError}</small>}
  </div>;
}

type MapProject = { project_id: string; property_id: string; division_id: "TRD" | "CRD"; project_name: string; project_type: string; status: string; completion_date: string | null; customer_name: string | null; property_name: string | null; address_line1: string; city: string; state: string; postal_code: string | null; latitude: number | null; longitude: number | null };

export function CompletedProjectsMap() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [projects, setProjects] = useState<MapProject[]>([]);
  const [divisionFilter, setDivisionFilter] = useState("ALL");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const located = projects.filter(project => project.latitude != null && project.longitude != null);
  const visible = located.filter(project => divisionFilter === "ALL" || project.division_id === divisionFilter);

  useEffect(() => {
    let active = true;
    if (!supabase) { setError("Database connection is unavailable."); setLoading(false); return; }
    supabase.rpc("crm_owner_completed_projects_map").then(({ data, error: queryError }) => {
      if (!active) return;
      if (queryError) setError(queryError.message);
      else setProjects((data || []) as MapProject[]);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    loadGoogleMaps().then(google => {
      if (!active || !mapElement.current) return;
      mapRef.current = new google.maps.Map(mapElement.current, {
        center: { lat: 33.4255, lng: -94.0477 },
        zoom: 7,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        mapTypeId: "roadmap"
      });
      setMapReady(true);
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; markersRef.current.forEach(marker => marker.setMap(null)); };
  }, []);

  useEffect(() => {
    if (!mapReady || !window.google || !supabase) return;
    let cancelled = false;
    const client = supabase;
    const geocoder = new window.google.maps.Geocoder();
    const pending = projects.filter(project => project.property_id && project.latitude == null && project.longitude == null && project.address_line1);
    pending.forEach(project => {
      const address = [project.address_line1, project.city, project.state, project.postal_code].filter(Boolean).join(", ");
      geocoder.geocode({ address }, async (results: any[], status: string) => {
        if (cancelled || status !== "OK" || !results?.[0]?.geometry?.location) return;
        const location = results[0].geometry.location;
        const latitude = location.lat();
        const longitude = location.lng();
        await client.rpc("crm_owner_save_property_coordinates", { p_property_id: project.property_id, p_latitude: latitude, p_longitude: longitude });
        if (!cancelled) setProjects(current => current.map(item => item.property_id === project.property_id ? { ...item, latitude, longitude } : item));
      });
    });
    return () => { cancelled = true; };
  }, [mapReady, projects]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google) return;
    const google = window.google;
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];
    const bounds = new google.maps.LatLngBounds();
    visible.forEach(project => {
      const position = { lat: Number(project.latitude), lng: Number(project.longitude) };
      const marker = new google.maps.Marker({ map: mapRef.current, position, title: project.project_name || "Completed project" });
      const info = new google.maps.InfoWindow({ content: '<div style="font:13px Arial;max-width:260px"><strong>' + escapeHtml(project.project_name || "Completed project") + '</strong><p>' + escapeHtml([project.address_line1, project.city, project.state, project.postal_code].filter(Boolean).join(", ")) + '</p><p>' + escapeHtml(project.division_id + " · " + (project.project_type || "Roofing")) + '</p><p>' + escapeHtml(project.customer_name || "Customer not recorded") + '</p><p>' + escapeHtml(project.completion_date ? new Date(project.completion_date + "T12:00:00").toLocaleDateString() : "Completion date not recorded") + '</p></div>' });
      marker.addListener("click", () => info.open({ anchor: marker, map: mapRef.current }));
      markersRef.current.push(marker);
      bounds.extend(position);
    });
    if (visible.length) mapRef.current.fitBounds(bounds);
  }, [visible, mapReady]);

  return <div className="content-stack">
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">OWNER ONLY · TRD + CRD</p><h2>Completed project locations</h2><p className="muted">Every completed CRM project with a property location. Select a pin to view its details.</p></div>
        <label className="map-filter-label">Division<select value={divisionFilter} onChange={event => setDivisionFilter(event.target.value)}><option value="ALL">Both divisions</option><option value="TRD">TRD residential</option><option value="CRD">CRD commercial</option></select></label>
      </div>
      <div className="map-stat-row"><strong>{projects.length} completed projects</strong><span>{visible.length} mapped locations</span><span>{projects.length - located.length} missing coordinates</span></div>
      {error && <p className="inline-message">{error}</p>}
      {loading && <p className="muted">Loading completed project records...</p>}
      <div ref={mapElement} className="completed-project-map" role="application" aria-label="Map of completed roofing projects" />
      {!loading && projects.length === 0 && <p className="muted">No completed projects were found in the CRM yet.</p>}
      {!loading && projects.length > 0 && located.length === 0 && <p className="inline-message">Completed projects exist, but none have saved map coordinates. Select their property addresses again using autocomplete to geocode them.</p>}
    </section>
  </div>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}
