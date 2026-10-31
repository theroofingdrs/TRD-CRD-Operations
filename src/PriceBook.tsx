import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { estimateCatalog, estimateCatalogCategories } from "./estimateCatalog";

type DivisionId = "TRD" | "CRD";
type CatalogRow = { id?: string; category: string; item_code?: string | null; description: string; unit: string; unit_price: string; is_active: boolean; custom?: boolean };
const keyOf = (row: Pick<CatalogRow,"category"|"description"|"unit">) => [row.category,row.description,row.unit].join("::");

export default function PriceBook({ division, userId }: { division: DivisionId; userId: string }) {
  const [savedRows,setSavedRows] = useState<CatalogRow[]>([]);
  const [prices,setPrices] = useState<Record<string,string>>({});
  const [category,setCategory] = useState("All categories");
  const [search,setSearch] = useState("");
  const [customCategory,setCustomCategory] = useState("");
  const [customDescription,setCustomDescription] = useState("");
  const [customUnit,setCustomUnit] = useState("EA");
  const [customPrice,setCustomPrice] = useState("");
  const [busyKey,setBusyKey] = useState("");
  const [message,setMessage] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const {data,error} = await supabase.from("crm_price_book").select("id,category,item_code,description,unit,unit_price,is_active").eq("division_id",division).order("category").order("description");
    if (error) { setMessage(error.message); return; }
    const rows = (data || []).map((r:any) => ({...r,unit_price:r.unit_price == null ? "" : String(r.unit_price)})) as CatalogRow[];
    setSavedRows(rows);
    setPrices(Object.fromEntries(rows.map(r => [keyOf(r),r.unit_price])));
  },[division]);
  useEffect(()=>{void load();},[load]);
  const rows = useMemo(() => {
    const saved = new Map(savedRows.map(r=>[keyOf(r),r]));
    const base = estimateCatalog.map(item => {
      const existing=saved.get(keyOf(item));
      return {...item,id:existing?.id,item_code:existing?.item_code ?? null,unit_price:prices[keyOf(item)] ?? existing?.unit_price ?? "",is_active:existing?.is_active ?? true,custom:false};
    });
    const custom = savedRows.filter(r=>!estimateCatalog.some(item=>keyOf(item)===keyOf(r))).map(r=>({...r,unit_price:prices[keyOf(r)] ?? r.unit_price,custom:true}));
    return [...base,...custom].filter(r=>r.is_active && (category==="All categories" || r.category===category) && (!search.trim() || (r.description+" "+r.category+" "+r.unit).toLowerCase().includes(search.trim().toLowerCase())));
  },[savedRows,prices,category,search]);
  const categories = useMemo(()=>["All categories",...Array.from(new Set([...estimateCatalogCategories,...savedRows.map(r=>r.category)])).sort()], [savedRows]);
  async function saveRow(row:CatalogRow) {
    if(!supabase) return;
    const value=prices[keyOf(row)] ?? row.unit_price;
    if(value.trim()!=="" && (!Number.isFinite(Number(value)) || Number(value)<0)){setMessage("Enter a valid nonnegative unit price.");return;}
    setBusyKey(keyOf(row));setMessage("");
    const {error}=await supabase.from("crm_price_book").upsert({
      division_id:division,category:row.category,item_code:row.item_code || null,description:row.description.trim(),unit:row.unit,
      unit_price:value.trim()===""?null:Number(value),is_active:true,updated_by:userId,updated_at:new Date().toISOString()
    },{onConflict:"division_id,category,description,unit"});
    if(error)setMessage(error.message);else {setMessage("Saved "+row.description);await load();}
    setBusyKey("");
  }
  async function addCustom() {
    if(!customCategory.trim()||!customDescription.trim()){setMessage("Enter a category and item description.");return;}
    const row:CatalogRow={category:customCategory.trim(),description:customDescription.trim(),unit:customUnit,unit_price:customPrice,is_active:true,custom:true};
    await saveRow(row);
    setCustomDescription("");setCustomPrice("");
  }
  return <div className="content-stack"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">{division} PRICE BOOK</p><h2>{division==="TRD"?"Residential":"Commercial"} item and labor pricing</h2><p className="muted">Enter your approved price per unit. Blank prices remain unpriced and are never guessed. TRD and CRD have separate catalogs.</p></div></div>
    <div className="form-grid"><label>Category<select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>Search catalog<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search material, labor, flashing, disposal..." /></label></div>
    <p className="record-count">{rows.length} catalog items shown · {savedRows.filter(r=>r.unit_price!=="").length} priced items saved</p>
    <div className="table-wrap"><table><thead><tr><th>Category</th><th>Product / labor line</th><th>Unit</th><th>Price per unit ($)</th><th>Save</th></tr></thead><tbody>
      {rows.map(row=><tr key={keyOf(row)}><td>{row.category}{row.custom?<span className="subline">Custom item</span>:null}</td><td><strong>{row.description}</strong>{row.item_code?<span className="subline">Code: {row.item_code}</span>:null}</td><td>{row.unit}</td><td><input aria-label={"Price per "+row.unit+" for "+row.description} type="number" min="0" step="0.01" placeholder="Enter price" value={prices[keyOf(row)] ?? row.unit_price} onChange={e=>setPrices(current=>({...current,[keyOf(row)]:e.target.value}))} /></td><td><button className="secondary-button compact" type="button" disabled={busyKey===keyOf(row)} onClick={()=>void saveRow(row)}>{busyKey===keyOf(row)?"Saving...":"Save"}</button></td></tr>)}
      {!rows.length&&<tr><td colSpan={5}>No catalog items match this search.</td></tr>}
    </tbody></table></div>
  </section>
  <section className="panel"><div className="panel-heading"><div><p className="eyebrow">CUSTOM PRICE BOOK ITEM</p><h2>Add a product, material, or labor line</h2></div></div>
    <div className="form-grid"><label>Category<input value={customCategory} onChange={e=>setCustomCategory(e.target.value)} placeholder="Example: Specialty roofing" /></label><label>Description<input value={customDescription} onChange={e=>setCustomDescription(e.target.value)} placeholder="Describe the product or work" /></label><label>Unit<select value={customUnit} onChange={e=>setCustomUnit(e.target.value)}>{["SQ","SF","LF","EA","HR","DAY","WK","MO","LS","CY","SHEET","ROLL","GAL","BDL"].map(u=><option key={u}>{u}</option>)}</select></label><label>Price per unit ($)<input type="number" min="0" step="0.01" value={customPrice} onChange={e=>setCustomPrice(e.target.value)} placeholder="Leave blank until priced" /></label></div>
    <button className="primary-button" type="button" onClick={()=>void addCustom()}>Add custom item</button>
  </section>{message&&<p className="inline-message">{message}</p>}</div>;
}
