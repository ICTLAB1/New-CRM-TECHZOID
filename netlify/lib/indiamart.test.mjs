import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_DAYS, MAX_WINDOW_DAYS, classify, crmIdFor, customerFieldsFrom, imTimestamp,
  leadsFrom, noteFrom, pincodeIn, plainText, pullUrl, queryId, queryTimeMs, queryTypeLabel,
  tidyPhone, windowFor,
} from "./indiamart.mjs";

/**
 * Tested against payloads captured from the live IndiaMART API, not against
 * invented ones. The failure this guards is not a crash — it is a mapping
 * that quietly drops the buyer's phone number on every lead and is noticed
 * weeks later.
 */

/** IndiaMART's own published Push sample. */
const PUSH_SAMPLE = {
  CODE: 200,
  STATUS: "SUCCESS",
  RESPONSE: {
    SUBJECT: "Requirement for Testing by indiamart ",
    QUERY_TIME: "2024-04-10 11:17:14",
    QUERY_TYPE: "B",
    SENDER_CITY: "Noida",
    SENDER_NAME: "Indiamart",
    SENDER_EMAIL: "abcdeprabhat@indiamart.com",
    SENDER_PHONE: "0120-2222222",
    SENDER_STATE: "Uttar Pradesh",
    CALL_DURATION: "",
    QUERY_MESSAGE: "I want to purchase an Empty Mineral Water Bottle. Kindly send me price and other details.",
    SENDER_MOBILE: "+91-9999999999",
    SENDER_ADDRESS: "Sec 135, Noida, Uttar Pradesh",
    SENDER_COMPANY: "Indiamart Intermesh pvt Ltd.",
    SENDER_PINCODE: "201304",
    QUERY_MCAT_NAME: "Mineral Water Bottle",
    RECEIVER_MOBILE: "",
    UNIQUE_QUERY_ID: "111111111",
    SENDER_EMAIL_ALT: "xxxxxxxxxxx@indiamart.com",
    SENDER_PHONE_ALT: "0120-11111111",
    SENDER_MOBILE_ALT: "+91-1111111111",
    QUERY_PRODUCT_NAME: "Mineral Water Bottle",
    SENDER_COUNTRY_ISO: "IN",
  },
};

/** A real 2022 Pull response. Note it carries only 19 of the 22 fields —
 *  no SUBJECT, no SENDER_PINCODE, no QUERY_MCAT_NAME — and a lead with no
 *  email and no company at all. Both are ordinary. */
const PULL_2022 = {
  CODE: 200,
  STATUS: "SUCCESS",
  MESSAGE: "",
  TOTAL_RECORDS: 2,
  RESPONSE: [
    {
      UNIQUE_QUERY_ID: "2243859917",
      QUERY_TYPE: "W",
      QUERY_TIME: "2022-09-17 09:34:45",
      SENDER_NAME: "Ravi Kumar",
      SENDER_MOBILE: "+91-8384869226",
      SENDER_EMAIL: "",
      SENDER_COMPANY: "",
      SENDER_ADDRESS: "KTR Colony, Hyderabad, Telangana,         500072",
      SENDER_CITY: "Hyderabad",
      SENDER_STATE: "Telangana",
      SENDER_COUNTRY_ISO: "IN",
      QUERY_PRODUCT_NAME: "Fuel Pressure Regulator Sensor",
      QUERY_MESSAGE:
        "I want to buy Fuel Pressure Regulator Sensor.\r\rBefore purchasing I would like to know the price details.<br> Quantity :   1<br> Quantity Unit :   piece<br>",
      CALL_DURATION: "",
      RECEIVER_MOBILE: "",
    },
    {
      UNIQUE_QUERY_ID: 2243945858,
      QUERY_TYPE: "P",
      QUERY_TIME: "2022-09-17 11:02:10",
      SENDER_NAME: "Suresh",
      SENDER_MOBILE: "+91-9100843314",
      SENDER_EMAIL: "",
      SENDER_COMPANY: "",
      SENDER_ADDRESS: "",
      CALL_DURATION: "42 sec",
      RECEIVER_MOBILE: "+91-9711492098",
    },
  ],
};

describe("what came back", () => {
  it("reads leads out of a Pull array and a Push object alike", () => {
    expect(leadsFrom(PULL_2022)).toHaveLength(2);
    expect(leadsFrom(PUSH_SAMPLE)).toHaveLength(1);
    expect(leadsFrom({})).toEqual([]);
    expect(leadsFrom({ RESPONSE: null })).toEqual([]);
  });

  it("treats 'no leads in that window' as success, not failure", () => {
    /* The single most common answer a five-minute poller gets. Calling it
       an error would mean an error every five minutes, forever. */
    const verdict = classify(200, {
      CODE: 204, STATUS: "FAILURE",
      MESSAGE: "There are no leads in the given time duration. Please try for a different duration.",
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.empty).toBe(true);
    expect(verdict.leads).toEqual([]);
  });

  it("knows which failures are worth retrying and which need a person", () => {
    expect(classify(200, { CODE: 429 })).toMatchObject({ ok: false, retry: true, reason: "rate-limited" });
    expect(classify(200, { CODE: 500 })).toMatchObject({ ok: false, retry: true, reason: "their-fault" });
    /* An expired or wrong key cannot be retried into working. */
    expect(classify(200, { CODE: 401 })).toMatchObject({ ok: false, retry: false, reason: "bad-key" });
    expect(classify(200, { CODE: 400 })).toMatchObject({ ok: false, retry: false, reason: "bad-request" });
  });

  it("decides on the body, because they answer HTTP 200 either way", () => {
    expect(classify(200, PULL_2022).ok).toBe(true);
    expect(classify(200, { CODE: "429" }).retry).toBe(true);
    /* A string CODE and a numeric CODE mean the same thing. */
    expect(classify(200, { CODE: "200", RESPONSE: [] }).ok).toBe(true);
  });

  it("falls back to the status line when there is no body at all", () => {
    expect(classify(502, null)).toMatchObject({ ok: false, retry: true });
  });
});

describe("asking for a window", () => {
  it("formats the timestamp the way their worked example does", () => {
    /* Three-letter month, no separator before the hour, IST. 09:00 UTC is
       14:30 in India. */
    expect(imTimestamp(new Date("2026-09-06T09:00:00Z"))).toBe("06-Sep-202614:30:00");
  });

  it("never writes hour 24 for midnight", () => {
    /* 18:30 UTC is exactly midnight IST, and some engines render that as
       "24" — a value their parser has no reason to accept. */
    expect(imTimestamp(new Date("2026-09-06T18:30:00Z"))).toMatch(/^07-Sep-202600:/);
  });

  it("overlaps the last window on purpose", () => {
    const now = new Date("2026-09-06T12:00:00Z");
    const since = new Date("2026-09-06T11:55:00Z");
    const w = windowFor(now, since, 300);
    /* Five minutes before where the last poll finished: a lead recorded a
       moment after our clock closed the window is still caught. */
    expect(w.start.toISOString()).toBe("2026-09-06T11:50:00.000Z");
    expect(w.end).toBe(now);
  });

  it("never asks for more than the seven days they allow", () => {
    const now = new Date("2026-09-06T12:00:00Z");
    const ancient = new Date("2020-01-01T00:00:00Z");
    const w = windowFor(now, ancient, 300);
    const days = (w.end.getTime() - w.start.getTime()) / 86400_000;
    expect(days).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
  });

  it("starts a first-ever poll at the widest window allowed", () => {
    const now = new Date("2026-09-06T12:00:00Z");
    const w = windowFor(now, null);
    const days = (w.end.getTime() - w.start.getTime()) / 86400_000;
    expect(days).toBeCloseTo(MAX_WINDOW_DAYS, 5);
    expect(MAX_HISTORY_DAYS).toBe(365);
  });

  it("copes with a stored cursor in the future", () => {
    /* A clock skew or a hand-edited setting must not produce a window that
       runs backwards. */
    const now = new Date("2026-09-06T12:00:00Z");
    const w = windowFor(now, new Date("2026-09-07T12:00:00Z"), 300);
    expect(w.start.getTime()).toBeLessThan(w.end.getTime());
  });

  it("url-encodes the key, which contains slashes and plus signs", () => {
    const w = windowFor(new Date("2026-09-06T09:00:00Z"), null);
    const url = pullUrl("mRyyE71u4H/AS/eq4XCO7l2Ko1rNlDRk==", w);
    expect(url).not.toMatch(/key=[^&]*\//);
    expect(url).toContain("glusr_crm_key=mRyyE71u4H%2FAS%2Feq4XCO7l2Ko1rNlDRk%3D%3D");
    expect(url).toContain("start_time=");
    expect(url).toContain("end_time=");
  });
});

describe("one lead, mapped", () => {
  const [webLead, callLead] = PULL_2022.RESPONSE;

  it("keys on their id, whether it arrives quoted or not", () => {
    expect(queryId(webLead)).toBe("2243859917");
    /* The second record's id is a JSON number, not a string. */
    expect(queryId(callLead)).toBe("2243945858");
    expect(crmIdFor(queryId(callLead))).toBe("im-2243945858");
  });

  it("gives the same lead the same row id every time it is fetched", () => {
    /* Windows overlap by design, so every lead arrives at least twice. */
    expect(crmIdFor(queryId(webLead))).toBe(crmIdFor(queryId({ ...webLead })));
  });

  it("strips the country code off an Indian mobile so it matches a customer on file", () => {
    /* The CRM's duplicate check compares the last ten digits. */
    expect(tidyPhone("+91-8384869226")).toBe("8384869226");
    expect(tidyPhone("+91-9999999999")).toBe("9999999999");
  });

  it("leaves a landline and anything unrecognised alone", () => {
    /* An STD code is not improved by being cut off. */
    expect(tidyPhone("0120-2222222")).toBe("0120-2222222");
    expect(tidyPhone("+1-415-555-0100")).toBe("+1-415-555-0100");
    expect(tidyPhone("")).toBe("");
    expect(tidyPhone(undefined)).toBe("");
  });

  it("uses the person's name when there is no company, rather than a blank row", () => {
    const fields = customerFieldsFrom(webLead);
    expect(fields.company).toBe("Ravi Kumar");
    expect(fields.contact).toBe("Ravi Kumar");
  });

  it("prefers the real company name when there is one", () => {
    expect(customerFieldsFrom(PUSH_SAMPLE.RESPONSE).company).toBe("Indiamart Intermesh pvt Ltd.");
  });

  it("never invents a field the lead did not carry", () => {
    /* Merging over an existing customer must not wipe what a salesperson
       typed, so a blank is an absent key, not an empty string. */
    const fields = customerFieldsFrom(webLead);
    expect(fields).not.toHaveProperty("email");
    expect(Object.values(fields).every((v) => v !== "")).toBe(true);
  });

  it("digs the pincode out of the address when the field is missing", () => {
    /* This 2022 record has no SENDER_PINCODE at all. */
    expect(webLead.SENDER_PINCODE).toBeUndefined();
    expect(customerFieldsFrom(webLead).pincode).toBe("500072");
  });

  it("does not mistake a phone number in an address for a pincode", () => {
    expect(pincodeIn("Call 9876543210, Delhi")).toBe("");
    expect(pincodeIn("Sec 135, Noida 201304")).toBe("201304");
    expect(pincodeIn("")).toBe("");
  });

  it("refuses a pincode sitting in the city field", () => {
    const odd = { ...webLead, SENDER_CITY: "500072" };
    expect(customerFieldsFrom(odd)).not.toHaveProperty("city");
  });

  it("keeps an alternate number only when it is a different number", () => {
    const fields = customerFieldsFrom(PUSH_SAMPLE.RESPONSE);
    expect(fields.phone).toBe("9999999999");
    const same = { SENDER_MOBILE: "+91-9999999999", SENDER_MOBILE_ALT: "+91-9999999999" };
    expect(customerFieldsFrom(same)).not.toHaveProperty("altPhone");
  });

  it("does not shorten a number that cannot be an Indian mobile", () => {
    /* IndiaMART's published sample uses +91-1111111111, which no Indian
       mobile can be — they begin 6 to 9. Cutting the country code off a
       number we cannot identify would produce a plausible-looking ten
       digits that dials nothing, so it is kept exactly as it arrived. */
    expect(tidyPhone("+91-1111111111")).toBe("+91-1111111111");
    expect(customerFieldsFrom(PUSH_SAMPLE.RESPONSE).altPhone).toBe("+91-1111111111");
    /* A real one is shortened. */
    expect(tidyPhone("+91-6384869226")).toBe("6384869226");
  });

  it("takes the alternate email when the main one is blank", () => {
    const lead = { SENDER_EMAIL: "", SENDER_EMAIL_ALT: "buyer@example.com" };
    expect(customerFieldsFrom(lead).email).toBe("buyer@example.com");
  });

  it("survives a lead carrying almost nothing", () => {
    expect(() => customerFieldsFrom({})).not.toThrow();
    expect(customerFieldsFrom({})).toEqual({});
  });
});

describe("the enquiry itself", () => {
  const [webLead, callLead] = PULL_2022.RESPONSE;

  it("becomes a timeline note, not a customer attribute", () => {
    /* What they asked for is a conversation. A second enquiry from the same
       buyer must read as history, not overwrite the first. */
    const note = noteFrom(webLead);
    expect(note.type).toBe("enquiry");
    expect(note.user).toBe("IndiaMART");
    expect(note.text).toContain("Fuel Pressure Regulator Sensor");
    /* Their run of spaces is collapsed on purpose — this is their layout,
       not the buyer's words, and it reads as broken in a timeline. */
    expect(note.text).toContain("Quantity : 1");
    expect(note.text).toContain("Quantity Unit : piece");
  });

  it("unpicks the HTML their message arrives wrapped in", () => {
    const text = plainText(webLead.QUERY_MESSAGE);
    expect(text).not.toContain("<br>");
    expect(text).not.toContain("\r");
    expect(plainText("a &amp; b &lt;tag&gt;")).toBe("a & b <tag>");
    expect(plainText("<script>alert(1)</script>hi")).toBe("alert(1)hi");
  });

  it("reads their timestamp as IST, not as the local clock", () => {
    /* 09:34:45 IST is 04:04:45 UTC. Reusing the start_time format here
       would shift every lead by five and a half hours. */
    expect(new Date(queryTimeMs(webLead)).toISOString()).toBe("2022-09-17T04:04:45.000Z");
  });

  it("falls back to now for a lead with no usable time", () => {
    expect(queryTimeMs({ QUERY_TIME: "" })).toBeGreaterThan(0);
    expect(queryTimeMs({})).toBeGreaterThan(0);
  });

  it("records how long a phone lead lasted", () => {
    expect(noteFrom(callLead).text).toContain("42 sec");
  });

  it("names the enquiry type, and passes an unknown one through politely", () => {
    expect(queryTypeLabel("W")).toBe("Direct enquiry");
    expect(queryTypeLabel("B")).toBe("Buy lead");
    expect(queryTypeLabel("P")).toBe("Phone call");
    /* Two codes integrators report with no official source behind them. */
    expect(queryTypeLabel("WA")).toBe("WhatsApp enquiry");
    /* Anything new they invent must not crash a poller. */
    expect(queryTypeLabel("ZZ")).toBe("Enquiry");
    expect(queryTypeLabel(undefined)).toBe("Enquiry");
  });

  it("gives a note some text even when the lead carried no message", () => {
    expect(noteFrom({ UNIQUE_QUERY_ID: "1", QUERY_TYPE: "P" }).text).toContain("Phone call");
  });
});
