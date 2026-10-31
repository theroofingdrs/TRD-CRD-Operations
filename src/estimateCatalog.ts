export type EstimateCatalogItem = { category: string; description: string; unit: string };

export const estimateCatalog: EstimateCatalogItem[] = [
  ...[
    "Remove composition shingles","Install composition shingles","Remove laminated architectural shingles","Install laminated architectural shingles","Remove wood shingles","Install wood shingles","Remove wood shakes","Install wood shakes","Remove tile roofing","Install tile roofing","Remove slate roofing","Install slate roofing","Remove metal roofing panels","Install metal roofing panels","Remove built up roofing","Install built up roofing","Install modified bitumen roofing","Install TPO membrane roofing","Install PVC membrane roofing","Install EPDM membrane roofing","Apply roof coating","Remove roof coating","Install roof insulation","Install cover board","Install tapered insulation","Install underlayment","Install synthetic underlayment","Install ice and water barrier","Install felt underlayment","Install starter course","Install ridge cap shingles","Install hip and ridge shingles","Install valley flashing","Install step flashing","Install counter flashing","Install drip edge","Install rake edge metal","Install eave edge metal","Install roof-to-wall flashing","Install cricket or saddle","Install roof ventilation","Install ridge vent","Install box vent","Install turbine vent","Install soffit vent","Install roof jack","Install pipe boot","Install pipe flashing","Install plumbing vent flashing","Install HVAC roof curb flashing","Install skylight flashing","Remove and reset skylight","Install roof drain","Install scupper","Install coping","Install perimeter edge metal"
  ].map(description => ({ category: "Roofing systems and accessories", description, unit: "SQ" })),
  ...[
    "Remove siding","Install vinyl siding","Install fiber cement siding","Install wood siding","Install engineered wood siding","Install metal siding","Install siding house wrap","Install siding starter strip","Install siding corner post","Install siding J channel","Install siding trim","Remove fascia","Install fascia","Repair fascia","Remove soffit","Install soffit","Repair soffit","Install rake trim","Install frieze board","Install exterior trim"
  ].map(description => ({ category: "Siding, fascia and exterior trim", description, unit: "LF" })),
  ...[
    "Replace window screen","Rescreen window frame","Detach and reset window screen","Replace screen frame","Replace HVAC vent hood","Replace HVAC roof vent","Detach and reset HVAC equipment","Straighten HVAC condenser coil fins","Replace condenser coil guard","Detach and reset satellite dish","Detach and reset solar panel","Detach and reset gutter","Detach and reset downspout","Detach and reset awning","Detach and reset carport components"
  ].map(description => ({ category: "Screens, HVAC and detach or reset", description, unit: "EA" })),
  ...[
    "Replace roof decking plywood","Replace roof decking OSB","Replace plank roof decking","Install roof sheathing","Remove roof sheathing","Install roof decking overlay","Replace fascia sheathing","Replace damaged substrate","Install roof cover board","Replace deteriorated roof deck"
  ].map(description => ({ category: "Decking and sheathing", description, unit: "SF" })),
  ...[
    "Install metal carport roofing","Replace carport roof panels","Repair carport framing","Replace awning fabric","Replace metal awning","Repair awning frame","Install custom metal flashing","Fabricate and install sheet metal","Straighten metal coil or trim","Replace metal roof trim"
  ].map(description => ({ category: "Metal, carports and awnings", description, unit: "SF" })),
  ...[
    "Emergency roof tarp","Temporary roof dry in","Tarp swimming pool for roof work","Protect swimming pool during tear off","Tarp and protect flower beds","Protect landscaping and shrubs","Protect patio and deck","Protect windows and doors","Protect HVAC equipment","Protect exterior fixtures","Temporary weather protection"
  ].map(description => ({ category: "Temporary protection and tarping", description, unit: "EA" })),
  ...[
    "Jobsite cleanup","Magnetic nail sweep","Additional magnetic nail sweep","Final magnetic nail sweep","Debris removal","Roofing tear off debris haul away","Dump fee","Disposal fee","Final property cleanup","Protective ground covering removal","Collect and remove roofing debris","Clean gutters after roofing work"
  ].map(description => ({ category: "Cleanup, debris and safety", description, unit: "EA" })),
  ...[
    "Hand load roofing materials","Hand unload roofing materials","Hand carry materials to roof","Additional material handling due to limited access","Carry debris from roof to disposal area","Additional labor for restricted site access","Ladder setup and relocation","Scaffold or staging setup","Roof access setup","Additional mobilization"
  ].map(description => ({ category: "Access and material handling", description, unit: "HR" })),
  ...[
    "Remove and replace pipe jack","Replace plumbing vent boot","Replace roof penetration flashing","Seal roof penetration","Replace chimney flashing","Replace skylight","Replace roof hatch","Replace exhaust fan curb","Replace roof mounted equipment curb","Replace gutter apron"
  ].map(description => ({ category: "Penetrations and specialty details", description, unit: "EA" })),
  ...[
    "Steep roof labor adjustment","High roof labor adjustment","Two story access labor adjustment","Additional setup and protection labor","Code required upgrade","Permit and inspection allowance","Temporary power or equipment","Roofing labor minimum","Service call minimum"
  ].map(description => ({ category: "Labor, code and job conditions", description, unit: "EA" }))
];

export const estimateCatalogCategories = [...new Set(estimateCatalog.map(item => item.category))];
