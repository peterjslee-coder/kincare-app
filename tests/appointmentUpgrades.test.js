/**
 * v1.106.29 / v1.106.30 — the client half of the appointment and profile work.
 *
 * mapsUrlFor is executed, because a maps URL that opens the wrong app or leaks an unencoded
 * address is exactly the kind of thing that reads fine and fails on a phone. The rest is
 * wiring, asserted as wiring.
 */
const fs = require("fs");
const path = require("path");
const { code } = require("./helpers/source");

const mapsUrlFor = (() => {
  const src = fs.readFileSync(path.join(__dirname, "..", "public/js/utils.js"), "utf8");
  const i0 = src.indexOf("const mapsUrlFor = window.mapsUrlFor =");
  const i1 = src.indexOf("\n};", i0) + 3;
  if (i0 === -1) throw new Error("mapsUrlFor not found");
  return (ua, maxTouchPoints = 0) => {
    const navigator = { userAgent: ua, maxTouchPoints };
    const window = {};
    // eslint-disable-next-line no-new-func
    return new Function("navigator", "window", src.slice(i0, i1) + "\nreturn mapsUrlFor;")(navigator, window);
  };
})();

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15";
const IPAD_OS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120";

describe("tapping an address", () => {
  test("an iPhone gets Apple Maps", () => {
    const url = mapsUrlFor(IPHONE)("Carilion Clinic, Radford");
    expect(url).toMatch(/^https:\/\/maps\.apple\.com\//);
  });

  test("an iPad reporting as a Mac is still an iPad", () => {
    // iPadOS 13+ sends a Macintosh UA. Touch points are what give it away, and getting this
    // wrong sends her to a browser tab asking her to install an app.
    expect(mapsUrlFor(IPAD_OS, 5)("Carilion Clinic")).toMatch(/maps\.apple\.com/);
    expect(mapsUrlFor(DESKTOP, 0)("Carilion Clinic")).toMatch(/google\.com\/maps/);
  });

  test("Android and desktop get Google Maps", () => {
    expect(mapsUrlFor(ANDROID)("Carilion Clinic")).toMatch(/^https:\/\/www\.google\.com\/maps\/search\//);
    expect(mapsUrlFor(DESKTOP)("Carilion Clinic")).toMatch(/^https:\/\/www\.google\.com\/maps\/search\//);
  });

  test("the address is encoded — an ampersand must not become a second parameter", () => {
    const url = mapsUrlFor(ANDROID)("Smith & Jones Clinic, Radford VA");
    expect(url).toContain("Smith%20%26%20Jones");
    expect(url.split("?")[1].split("&")).toHaveLength(2); // api=1 and query=... only
  });

  test("a blank address produces no link at all", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(mapsUrlFor(IPHONE)(v)).toBeNull();
    }
  });
});

describe("wired into the appointment", () => {
  const ev = code("public/js/components/CareEvents.js");

  test("the location is a button that opens the map", () => {
    expect(ev).toContain("mapsUrlFor(ev.location)");
    expect(ev).toContain("openExternalUrl(u)");
  });

  test("it uses openExternalUrl, not a bare target=_blank", () => {
    // WKWebView drops window.open after an await and Capacitor installs no download
    // delegate — the reason that helper exists (v1.105.49).
    const near = ev.slice(ev.indexOf("mapsUrlFor(ev.location)") - 400, ev.indexOf("mapsUrlFor(ev.location)") + 400);
    expect(near).not.toContain("target=\"_blank\"");
  });

  test("the address field is the autocomplete, not a bare text input", () => {
    // v1.106.31 — Pete: "The address should not be Freeform." AddressAutocomplete has
    // existed since v1.75.0 and was already used for care addresses; this field never got
    // it. It matters more now the address is a tappable map link — "Dr. Lambert" typed into
    // Maps finds nothing, and the caregiver is the one who discovers that in a car park.
    expect(ev).toContain("<AddressAutocomplete");
    expect(ev).toContain("onSelect={(sel) => setLocation(");
  });

  test("typing freely still works — the suggestions are a nudge, not a wall", () => {
    // "the clinic on Main" must not be rejected. AddressAutocomplete is a plain input when
    // no suggestion is picked, and the fallback branch is a plain input too.
    expect(ev).toContain("onChange={setLocation}");
    expect(ev).toContain("typeof AddressAutocomplete !== 'undefined'");
  });

  test("AddressAutocomplete is defined BEFORE CareEvents in the bundle", () => {
    const build = code("scripts/build-client.js");
    expect(build.indexOf("AddressAutocomplete.js")).toBeLessThan(build.indexOf("CareEvents.js"));
  });

  test("you appear in the picker, labelled as you, and sorted first", () => {
    expect(ev).toContain("pp.isYou ? 'You' : pp.first_name");
    expect(ev).toContain("pp.isYou ? 0 : pp.isCaregiver ? 1 : 2");
  });

  test("the form offers the people you can tag, and sends them", () => {
    expect(ev).toContain("/api/care-events/taggable/${recipientId}");
    expect(ev).toContain("attendee_user_ids: [...tagged]");
  });

  test("the sheet says who else is going", () => {
    expect(ev).toContain("ev.attendees.map((a) => a.first_name).join(', ')");
  });

  test("an appointment note posts to the care record, carrying the event", () => {
    // Not a field on care_events. If it were, iPAi would never see it and it would not be in
    // the care record — which is exactly what Pete objected to.
    expect(ev).toContain("apiFetch('/api/notes'");
    expect(ev).toContain("careEventId: ev.id");
  });

  test("the note box is double-submit locked", () => {
    // Daniel's note saved twice on Sep 11 at 14:27:14 and :15. A ref, not state.
    expect(ev).toContain("addingRef");
  });
});

describe("the caregiver profile page", () => {
  const page = code("public/js/components/CaregiverProfilePage.js");

  test("it is in the bundle, or nothing renders it", () => {
    expect(code("scripts/build-client.js")).toContain("js/components/CaregiverProfilePage.js");
  });

  test("app.js routes to it and guards a missing bundle entry", () => {
    const app = code("public/js/app.js");
    expect(app).toContain("currentPage === 'caregiver-profile'");
    expect(app).toContain("typeof CaregiverProfilePage !== 'undefined'");
  });

  test("tapping a caregiver opens it", () => {
    const list = code("public/js/components/Caregivers.js");
    expect(list).toContain("openCaregiverProfile(cg)");
    expect(list).toContain("__navigateTo('caregiver-profile')");
  });

  test("it shows the things Pete asked for", () => {
    for (const bit of ["cg.bio", "cg.yearsExperience", "cg.city", "cg.rating", "cg.specialties", "cg.photoUrl"]) {
      expect(page).toContain(bit);
    }
  });

  test("it does NOT publish her coordinates or phone number", () => {
    // The endpoint returns them; a browsing family has no need for either, and the
    // coordinates are her home address.
    for (const bit of ["latitude", "longitude", "phone"]) {
      expect(page).not.toContain(bit);
    }
  });

  test("an unrated caregiver reads as new, not as bad", () => {
    expect(page).toContain("is new here, not poorly rated");
  });

  test("the vouch badge is scoped to the family it was granted to", () => {
    // v1.64.0 — a vouch is per-family. Showing "vouched" to everyone would claim a check
    // that was never run.
    expect(page).toContain("cg.vouchedForYou");
    expect(page).toContain("Approved for your family");
  });
});

describe("she can change what the page says about her", () => {
  const acct = code("public/js/components/MyAccount.js");

  test("the bio and rates are in the account editor", () => {
    expect(acct).toContain("ed('bio', e.target.value)");
    expect(acct).toContain("rateDaytime");
  });

  test("they save to the caregiver record, not the user record", () => {
    expect(acct).toContain("apiFetch('/api/caregivers/me'");
  });

  test("a failed caregiver save is not reported as success", () => {
    // The class this codebase keeps finding: the export toast, the clipboard toast, the
    // reminder log. Saying "Profile updated" when her rate did not save is the same lie.
    expect(acct).toContain("Your details saved, but your bio and rates did not");
  });

  test("the dead editRates state is gone", () => {
    expect(acct).not.toContain("setEditRates");
  });
});

describe("the shadowed endpoint", () => {
  test("platform-config is registered before /:id, which used to swallow it", () => {
    const src = code("src/routes/caregivers.js");
    const cfg = src.indexOf('router.get("/platform-config"');
    const byId = src.indexOf('router.get("/:id"');
    expect(cfg).toBeGreaterThan(-1);
    expect(byId).toBeGreaterThan(-1);
    expect(cfg).toBeLessThan(byId);
  });

  test("the dead client fetch of it is gone", () => {
    // It 404'd on every hub load and the result went into state nothing rendered.
    expect(code("public/js/components/CaretakerHub.js")).not.toContain("platformConfig");
  });
});
