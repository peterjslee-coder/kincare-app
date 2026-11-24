/**
 * v1.126.4 — a picked business keeps its name; a street address is not doubled.
 * Pete, 10/28: look up "Betty's church" and tie it to an appointment.
 */
describe("googlePlaceDetails label", () => {
  const realFetch = global.fetch;
  beforeEach(() => { process.env.GOOGLE_MAPS_API_KEY = "test-key"; jest.resetModules(); });
  afterEach(() => { global.fetch = realFetch; delete process.env.GOOGLE_MAPS_API_KEY; });

  const reply = (body) => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => body })); };
  const comps = [
    { types: ["street_number"], shortText: "100", longText: "100" },
    { types: ["route"], shortText: "Main St", longText: "Main Street" },
    { types: ["locality"], longText: "Blacksburg", shortText: "Blacksburg" },
    { types: ["administrative_area_level_1"], shortText: "VA", longText: "Virginia" },
    { types: ["postal_code"], shortText: "24060", longText: "24060" },
  ];

  test("a church keeps its name in front of the address", async () => {
    reply({ id: "ChIJchurch000", displayName: { text: "Blacksburg Baptist Church" }, formattedAddress: "100 Main St, Blacksburg, VA 24060, USA", location: { latitude: 37.2, longitude: -80.4 }, addressComponents: comps });
    const d = await require("../src/utils/maps").googlePlaceDetails("ChIJchurch000");
    expect(d.label).toBe("Blacksburg Baptist Church, 100 Main St, Blacksburg, VA 24060, USA");
    expect(d.address).toBe("100 Main St, Blacksburg, VA 24060, USA");
    expect(d).toMatchObject({ line1: "100 Main Street", city: "Blacksburg", state: "VA", zip: "24060" });
  });

  test("a street address is not repeated", async () => {
    reply({ id: "ChIJaddr00000", displayName: { text: "100 Main St" }, formattedAddress: "100 Main St, Blacksburg, VA 24060, USA", location: { latitude: 37.2, longitude: -80.4 }, addressComponents: comps });
    const d = await require("../src/utils/maps").googlePlaceDetails("ChIJaddr00000");
    expect(d.label).toBe("100 Main St, Blacksburg, VA 24060, USA");
  });
});
