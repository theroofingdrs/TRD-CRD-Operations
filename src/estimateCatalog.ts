export type EstimateCatalogItem = { category: string; description: string; unit: string };

const groups: Record<string, { unit: string; items: string[] }[]> = {
  "Roofing removal and installation": [
    { unit: "SQ", items: ["Remove composition shingles","Install composition shingles","Remove laminated architectural shingles","Install laminated architectural shingles","Remove three tab shingles","Install three tab shingles","Remove wood shingles","Install wood shingles","Remove wood shakes","Install wood shakes","Remove tile roofing","Install tile roofing","Remove slate roofing","Install slate roofing","Remove metal roofing panels","Install metal roofing panels","Remove built up roofing","Install built up roofing","Install modified bitumen roofing","Install TPO membrane roofing","Install PVC membrane roofing","Install EPDM membrane roofing","Install rolled roofing","Install mineral surfaced roll roofing","Install standing seam metal roofing","Install exposed fastener metal roofing","Install roof coating","Remove roof coating","Install synthetic underlayment","Install felt underlayment","Install ice and water barrier","Install self adhered membrane","Install starter course","Install ridge cap shingles","Install hip and ridge shingles","Install roof insulation","Install tapered roof insulation","Install cover board","Install vapor barrier","Install roof cover board","Install roof membrane overlay"] }
  ],
  "Roof accessories and flashing": [
    { unit: "LF", items: ["Install drip edge","Install rake edge metal","Install eave edge metal","Install step flashing","Install counter flashing","Install valley flashing","Install roof to wall flashing","Install apron flashing","Install gutter apron","Install custom bent flashing","Install perimeter edge metal","Install coping metal","Install ridge vent","Install continuous soffit vent","Install metal fascia trim","Install metal rake trim"] },
    { unit: "EA", items: ["Install box vent","Install turbine vent","Install powered roof vent","Install plumbing vent flashing","Install pipe boot","Install pipe jack","Replace pipe jack","Install HVAC roof vent","Install exhaust vent","Install bathroom exhaust cap","Install kitchen exhaust cap","Install skylight","Remove and reset skylight","Install roof hatch","Install roof drain","Install overflow drain","Install scupper","Install roof curb","Install chimney flashing","Install cricket or saddle","Install roof antenna flashing","Install satellite mount flashing"] }
  ],
  "Siding, fascia, soffit and exterior trim": [
    { unit: "SQ", items: ["Remove vinyl siding","Install vinyl siding","Remove fiber cement siding","Install fiber cement siding","Remove wood siding","Install wood siding","Remove engineered wood siding","Install engineered wood siding","Remove metal siding","Install metal siding","Install siding house wrap"] },
    { unit: "LF", items: ["Install siding starter strip","Install siding corner post","Install siding J channel","Install siding utility trim","Install siding undersill trim","Install siding mounting block","Remove fascia","Install fascia","Repair fascia","Remove soffit","Install soffit","Repair soffit","Install rake trim","Install frieze board","Install exterior trim","Install window trim","Install door trim","Install fascia wrap","Install aluminum trim coil","Install gutter apron"] }
  ],
  "Windows, screens and exterior accessories": [
    { unit: "EA", items: ["Replace window screen","Rescreen window frame","Detach and reset window screen","Replace screen frame","Replace window well cover","Replace shutter","Detach and reset shutter","Replace exterior light fixture","Detach and reset exterior light fixture","Replace house number or address plaque","Detach and reset mailbox"] }
  ],
  "HVAC and mechanical accessories": [
    { unit: "EA", items: ["Replace HVAC vent hood","Replace HVAC roof vent","Detach and reset HVAC equipment","Straighten HVAC condenser coil fins","Replace condenser coil guard","Replace condenser hail guard","Replace refrigerant line cover","Detach and reset mini split line set cover","Replace exhaust fan","Replace roof mounted exhaust fan","Replace vent cap"] }
  ],
  "Decking and sheathing": [
    { unit: "SF", items: ["Remove roof decking plywood","Replace roof decking plywood","Replace roof decking OSB","Replace plank roof decking","Install roof sheathing","Remove roof sheathing","Install roof decking overlay","Replace fascia sheathing","Replace damaged roof substrate","Install roof cover board","Replace deteriorated roof deck","Replace wall sheathing","Replace siding substrate","Install plywood overlay","Install OSB overlay"] }
  ],
  "Metal, carports and awnings": [
    { unit: "SF", items: ["Install metal carport roofing","Replace carport roof panels","Repair carport framing","Replace awning fabric","Replace metal awning","Repair awning frame","Install metal awning panels","Replace carport trim panels","Replace carport flashing","Straighten metal coil or trim"] },
    { unit: "LF", items: ["Fabricate and install sheet metal","Install custom metal flashing","Replace metal roof trim","Replace metal fascia coil","Replace metal rake trim"] }
  ],
  "Flat roofing and commercial systems": [
    { unit: "SQ", items: ["Remove TPO roofing","Install TPO roofing","Remove PVC roofing","Install PVC roofing","Remove EPDM roofing","Install EPDM roofing","Remove modified bitumen roofing","Install modified bitumen roofing","Remove built up roofing","Install built up roofing","Apply acrylic roof coating","Apply silicone roof coating","Apply polyurethane roof coating","Install base sheet","Install cap sheet","Install vapor retarder","Install roof insulation","Install tapered insulation","Install cover board","Install walkway pads"] },
    { unit: "LF", items: ["Install TPO seam cover strip","Install termination bar","Install perimeter flashing","Install expansion joint cover","Install metal edge termination","Install coping cap"] },
    { unit: "EA", items: ["Replace roof drain","Install roof drain insert","Replace overflow drain","Install scupper","Replace roof hatch","Replace expansion joint","Replace pitch pocket","Install pipe penetration boot"] }
  ],
  "Temporary protection and tarping": [
    { unit: "EA", items: ["Emergency roof tarp","Temporary roof dry in","Tarp swimming pool for roof work","Protect swimming pool during tear off","Tarp and protect flower beds","Protect landscaping and shrubs","Protect patio and deck","Protect windows and doors","Protect HVAC equipment","Protect exterior fixtures","Temporary weather protection","Remove temporary tarp","Install temporary roof covering"] }
  ],
  "Cleanup, debris and safety": [
    { unit: "EA", items: ["Jobsite cleanup","Magnetic nail sweep","Additional magnetic nail sweep","Final magnetic nail sweep","Debris removal","Roofing tear off debris haul away","Dump fee","Disposal fee","Final property cleanup","Protective ground covering removal","Collect and remove roofing debris","Clean gutters after roofing work","Clean driveway and walkways","Remove nails from landscaping","Final grounds inspection"] },
    { unit: "CY", items: ["Construction debris disposal","Roofing debris disposal"] }
  ],
  "Access and material handling": [
    { unit: "HR", items: ["Hand load roofing materials","Hand unload roofing materials","Hand carry materials to roof","Additional material handling due to limited access","Carry debris from roof to disposal area","Additional labor for restricted site access","Ladder setup and relocation","Scaffold or staging setup","Roof access setup","Additional labor for no equipment access","Manual debris handling"] },
    { unit: "EA", items: ["Additional mobilization","Crane or lift mobilization","Material lift setup","Temporary walkway protection"] }
  ],
  "Detach, reset and specialty items": [
    { unit: "EA", items: ["Detach and reset satellite dish","Detach and reset solar panel","Detach and reset gutter","Detach and reset downspout","Detach and reset awning","Detach and reset carport components","Detach and reset fence section","Detach and reset deck accessory","Detach and reset exterior equipment","Remove and replace pipe jack","Replace plumbing vent boot","Replace roof penetration flashing","Seal roof penetration","Replace chimney flashing","Replace skylight","Replace exhaust fan curb","Replace roof mounted equipment curb"] }
  ],
  "Labor, code and job conditions": [
    { unit: "SQ", items: ["Steep roof labor adjustment","High roof labor adjustment","Two story roof access labor adjustment"] },
    { unit: "HR", items: ["Additional setup and protection labor","Additional labor for occupied property","Additional labor for restricted work hours","Additional labor for complex roof access"] },
    { unit: "EA", items: ["Code required upgrade","Permit and inspection allowance","Temporary power or equipment","Roofing labor minimum","Service call minimum","Additional trip charge"] }
  ]
};

export const estimateCatalog: EstimateCatalogItem[] = Object.entries(groups).flatMap(([category, entries]) =>
  entries.flatMap(({ unit, items }) => items.map(description => ({ category, description, unit })))
);

export const estimateCatalogCategories = Object.keys(groups);
