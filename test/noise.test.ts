import { describe, expect, it } from "vitest";
import { isNoise, isRelevant, AD_CVD_RE, NOISE_PATTERNS } from "../src/topics.js";

// Keep examples are near-misses: removing or loosening the single pattern under
// test must flip its drop example to isNoise === false (keep examples never match
// any other noise pattern, verified against src/topics.ts).

describe("AD/CVD paperwork noise", () => {
  it("drops administrative review (initiation / results), keeps determinations", () => {
    expect(isNoise({ title: "Certain Steel Nails From Taiwan: Final Results of Antidumping Duty Administrative Review; 2023-2024" })).toBe(true);
    expect(isNoise({ title: "Certain Steel Nails From Taiwan: Initiation of Antidumping Duty Administrative Review" })).toBe(true);
    const keep = "Certain Steel Nails From Taiwan: Final Affirmative Determination of Sales at Less Than Fair Value";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops preliminary results, keeps preliminary determinations", () => {
    expect(isNoise({ title: "Certain Steel Nails From Taiwan: Preliminary Results of the Antidumping Duty Administrative Review" })).toBe(true);
    const keep = "Certain Steel Nails From Taiwan: Preliminary Determination of Sales at Less Than Fair Value";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops rescission of review, keeps antidumping duty orders", () => {
    expect(isNoise({ title: "Pure Magnesium From Israel: Rescission of Antidumping Duty Administrative Review" })).toBe(true);
    const keep = "Pure Magnesium From Israel: Antidumping Duty Order";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops scope rulings, keeps antidumping duty orders", () => {
    expect(isNoise({ title: "Certain Corrosion-Resistant Steel Products From Japan: Scope Ruling on the Antidumping Duty Order" })).toBe(true);
    const keep = "Certain Corrosion-Resistant Steel Products From Japan: Antidumping Duty Order";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops sunset reviews, keeps countervailing duty orders", () => {
    expect(isNoise({ title: "Certain Cold-Rolled Steel From Japan: Sunset Review of the Antidumping Duty Order" })).toBe(true);
    const keep = "Certain Cold-Rolled Steel From Japan: Countervailing Duty Order";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops new shipper reviews, keeps final determinations", () => {
    expect(isNoise({ title: "Certain Pasta From Italy: New Shipper Review" })).toBe(true);
    const keep = "Certain Pasta From Italy: Final Affirmative Determination of Sales at Less Than Fair Value";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops changed circumstances reviews, keeps preliminary affirmative countervailing determinations", () => {
    expect(isNoise({ title: "Steel Concrete Reinforcing Bars From Turkey: Changed Circumstances Review" })).toBe(true);
    const keep = "Steel Concrete Reinforcing Bars From Turkey: Preliminary Affirmative Countervailing Determination";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops opportunity to request administrative review, keeps antidumping duty orders", () => {
    expect(isNoise({ title: "Certain Frozen Warmwater Shrimp From India: Opportunity to Request Administrative Review" })).toBe(true);
    const keep = "Certain Frozen Warmwater Shrimp From India: Antidumping Duty Order";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops continuation of AD/CVD orders, keeps preliminary determinations", () => {
    expect(isNoise({ title: "Carbon and Certain Alloy Steel Wire Rod From Japan: Continuation of Antidumping Duty Order" })).toBe(true);
    const keep = "Carbon and Certain Alloy Steel Wire Rod From Japan: Preliminary Determination of Sales at Less Than Fair Value";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops covered merchandise referrals, keeps final determinations", () => {
    expect(isNoise({ title: "Hot-Rolled Steel Flat Products From Japan: Covered Merchandise Referral of the European Commission" })).toBe(true);
    const keep = "Hot-Rolled Steel Flat Products From Japan: Final Affirmative Determination of Sales at Less Than Fair Value";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops notices of court decision, keeps antidumping duty orders", () => {
    expect(isNoise({ title: "Silicon Metal From China: Notice of Court Decision Not in Harmony" })).toBe(true);
    const keep = "Silicon Metal From China: Antidumping Duty Order";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops circumvention inquiries, keeps antidumping and countervailing duty orders", () => {
    expect(isNoise({ title: "Certain Glass Containers From China: Circumvention Inquiry on the Antidumping Duty Orders" })).toBe(true);
    expect(isNoise({ title: "Certain Glass Containers From China: Anticircumvention Inquiry on the Countervailing Duty Order" })).toBe(true);
    const keep = "Certain Glass Containers From China: Antidumping and Countervailing Duty Orders";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops postponement of preliminary determination, keeps preliminary affirmative determinations", () => {
    expect(isNoise({ title: "Certain Polyester Staple Fiber From Korea: Postponement of Preliminary Determination of Sales at Less Than Fair Value" })).toBe(true);
    const keep = "Certain Polyester Staple Fiber From Korea: Preliminary Affirmative Determination of Sales at Less Than Fair Value";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops extensions of time limit, keeps preliminary determinations", () => {
    expect(isNoise({ title: "Certain Oil Country Tubular Goods From Turkey: Extension of Time Limit for Final Determination" })).toBe(true);
    const keep = "Certain Oil Country Tubular Goods From Turkey: Preliminary Determination of Sales at Less Than Fair Value";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops revocations of order, keeps countervailing duty orders", () => {
    expect(isNoise({ title: "Certain Carbon Steel Pipe From Korea: Revocation of the Antidumping Duty Order" })).toBe(true);
    const keep = "Certain Carbon Steel Pipe From Korea: Countervailing Duty Order";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops results-of inquiry notices, keeps antidumping duty orders", () => {
    expect(isNoise({ title: "Steel Wire Garment Hangers From Korea: Results of Antidumping Duty Inquiry" })).toBe(true);
    const keep = "Steel Wire Garment Hangers From Korea: Antidumping Duty Order";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops rescissions of review, keeps countervailing duty orders", () => {
    expect(isNoise({ title: "Brake Drums From China: Rescission of Countervailing Duty Review" })).toBe(true);
    const keep = "Brake Drums From China: Countervailing Duty Order";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops anticircumvention rulings, keeps final affirmative countervailing determinations", () => {
    expect(isNoise({ title: "Wire Hangers From Vietnam: Anticircumvention Ruling" })).toBe(true);
    const keep = "Wire Hangers From Vietnam: Final Affirmative Countervailing Duty Determination";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops final results of redetermination, keeps final affirmative determinations", () => {
    expect(isNoise({ title: "Honey From Brazil: Final Results of Redetermination Pursuant to Court Remand" })).toBe(true);
    const keep = "Honey From Brazil: Final Affirmative Determination of Sales at Less Than Fair Value";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });

  it("drops preliminary results of redetermination, keeps preliminary affirmative countervailing determinations", () => {
    expect(isNoise({ title: "Honey From Brazil: Preliminary Results of Redetermination" })).toBe(true);
    const keep = "Honey From Brazil: Preliminary Affirmative Countervailing Duty Determination";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });
});

describe("Section 232 override", () => {
  it("lets Section 232 titles through AD/CVD noise but still drops corrections", () => {
    const with232 = "Section 232 Steel Nails: Preliminary Results of Antidumping Duty Administrative Review";
    expect(isNoise({ title: with232 })).toBe(false); // AD/CVD pattern overridden
    expect(isNoise({ title: "Steel Nails: Preliminary Results of Antidumping Duty Administrative Review" })).toBe(true); // same title without "Section 232" is noise
    expect(isNoise({ title: `${with232}; Correction` })).toBe(true); // only AD/CVD is overridden
    const keep = "Section 232 Steel Nails: Preliminary Determination of Sales at Less Than Fair Value";
    expect(isNoise({ title: keep })).toBe(false);
  });
});

describe("other noise patterns", () => {
  it("drops information collection / OMB / paperwork reduction, keeps other records notices", () => {
    expect(isNoise({ title: "Agency Information Collection Activities; Comment Request" })).toBe(true);
    expect(isNoise({ title: "Reports, Forms and Recordkeeping Requirements: Submission to OMB for Review and Approval" })).toBe(true);
    expect(isNoise({ title: "Paperwork Reduction Act of 1995; Proposed Collection" })).toBe(true);
    const keep = "Agency Records Management Activities: Submission of Proposed Data Collection Procedures";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops Sunshine Act only when anchored at the start", () => {
    expect(isNoise({ title: "Sunshine Act Meetings" })).toBe(true);
    expect(isNoise({ title: "Notice under the Sunshine Act" })).toBe(false);
  });

  it("drops self-regulatory organization notices only when anchored at the start", () => {
    const drops = [
      "Self-Regulatory Organizations; Example Exchange LLC; Notice of Filing and Immediate Effectiveness of a Proposed Rule Change To Amend the Fee Schedule",
      "Self-Regulatory Organizations; Example Exchange LLC; Notice of Filing of a Proposed Rule Change To Amend Pricing for Market Data",
      "Self-Regulatory Organizations; Example Clearing LLC; Notice of Designation of a Longer Period for Commission Action on a Proposed Rule Change",
      "Self-Regulatory Organizations; Example Clearing Inc.; Notice of Designation of Longer Period for Commission Action on Proposed Rule Change",
      "Self-Regulatory Organizations; Example Exchange; Order Granting Extension of Time",
      "Self-Regulatory Organizations; Example Exchange; Notice of Filing of a Proposed Rule Change To Make Technical Changes to Rule 1.1",
      "Self-Regulatory Organizations; Example Exchange; Notice of Filing of a Proposed Rule Change To Make Conforming Changes",
    ];
    for (const title of drops) {
      expect(isNoise({ title })).toBe(true);
    }
    const keeps = [
      "Self-Regulatory Organizations; Example Exchange LLC; Notice of Filing of a Proposed Rule Change To List and Trade Shares of a Bitcoin Trust",
      "Fee Schedule Notice for Port Operators",
      "Self-Regulatory Organizations; Example Exchange; Notice of Filing To List Options on Coffee Futures",
    ];
    for (const title of keeps) {
      expect(isNoise({ title })).toBe(false);
    }
  });

  it("drops petitions for rulemaking / reconsideration, keeps other petitions", () => {
    expect(isNoise({ title: "Petition for Rulemaking To Require Rear Impact Protection" })).toBe(true);
    expect(isNoise({ title: "Petition for Reconsideration of the Guidance Document" })).toBe(true);
    const keep = "Grant of a Petition for Exemption";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops commercial gauger / laboratory notices, keeps certified status applications", () => {
    expect(isNoise({ title: "Commercial Gauger and Laboratory Program: Request for Applications" })).toBe(true);
    const keep = "Importer Inspection Program: Application for Certified Gauger and Laboratory Status";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops lists of rules to be reviewed, keeps other regulatory planning notices", () => {
    expect(isNoise({ title: "Regulatory Planning and Review: List of Rules To Be Reviewed" })).toBe(true);
    const keep = "Regulatory Planning and Review: Unified Agenda of Rules";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops '; Correction' suffix and 'Correction' prefix, keeps mid-title corrections", () => {
    expect(isNoise({ title: "Antidumping Duty Order on Certain Steel Nails From Taiwan; Correction" })).toBe(true);
    expect(isNoise({ title: "Correction: Ocean Shipping Reform Act Registration" })).toBe(true);
    const keep = "Corrective Action Plans for Export Compliance Programs";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops technical correction titles where the correction is the whole change", () => {
    expect(isNoise({ title: "Export Administration Regulations; Technical Corrections" })).toBe(true);
    expect(isNoise({ title: "Technical Correction to the Entity List" })).toBe(true);
    expect(isNoise({ title: "Example Rule; Technical Correction" })).toBe(true);
    expect(isNoise({ title: "Amendments to Swap Rules: Technical Corrections" })).toBe(true);
  });

  it("keeps technical corrections that accompany substantive additions", () => {
    const keeps = [
      "Entity List Additions; Technical Correction and Additions of Entities",
      "Additions to the Entity List and Technical Corrections",
      "Technical Corrections and Conforming Amendments to Export Rules",
      "Technical Standards for Swap Execution Facilities",
    ];
    for (const title of keeps) {
      expect(isNoise({ title })).toBe(false);
    }
  });

  it("drops SEC longer-period / review-period-extension notices even without an SRO prefix", () => {
    expect(isNoise({ title: "Example Clearing Agency; Notice of Designation of Longer Period for Commission Action on an Advance Notice" })).toBe(true);
    expect(isNoise({ title: "Example Exchange; Notice of Extension of Review Period for a Proposed Rule Change" })).toBe(true);
  });

  it("drops SRO filings where clarification is the whole change, keeps clarifications paired with substantive changes", () => {
    expect(isNoise({ title: "Self-Regulatory Organizations; Example Exchange; Notice of Filing of a Proposed Rule Change To Clarify Rule 4.2" })).toBe(true);
    expect(isNoise({ title: "Self-Regulatory Organizations; Example Exchange; Notice of Filing of Clarifying Changes to Rule 7" })).toBe(true);
    const keeps = [
      "Self-Regulatory Organizations; Example Exchange; Notice of Filing of a Proposed Rule Change To Amend Its Listing Standards and To Clarify Rule 5.1",
      "Self-Regulatory Organizations; Example Exchange; Notice of Filing of a Proposed Rule Change To Adopt New Rule 900 and To Clarify Existing Text",
      "Self-Regulatory Organizations; Example Exchange; Notice of Filing of a Proposed Rule Change To List and Trade Shares of a Bitcoin Trust and Clarify Rule 14.11",
    ];
    for (const title of keeps) {
      expect(isNoise({ title })).toBe(false);
    }
  });

  it("drops marine-mammal incidental take authorizations, keeps other marine notices", () => {
    expect(isNoise({ title: "Taking Marine Mammals Incidental to Cable Landing Construction" })).toBe(true);
    expect(isNoise({ title: "Incidental Take Authorization for Subsea Cable Survey" })).toBe(true);
    const keep = "Marine Terminal Operator Registration";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops C-prefixed correction documentNumbers, keeps plain ones", () => {
    const title = "Ocean Shipping Reform Act: Registration of Carriers";
    expect(isNoise({ title, documentNumber: "C1-2025-123" })).toBe(true);
    expect(isNoise({ title, documentNumber: "C2-2025-456" })).toBe(true);
    expect(isNoise({ title, documentNumber: "2025-123" })).toBe(false);
  });

  it("drops tariff-rate quota notices, keeps other quota notices", () => {
    expect(isNoise({ title: "Establishment of a Tariff-Rate Quota for Raw Cane Sugar" })).toBe(true);
    const keep = "Establishment of an Import Quota for Raw Cane Sugar";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops denials of export privileges, keeps reinstatements", () => {
    expect(isNoise({ title: "Order Denying Export Privileges; John Smith" })).toBe(true);
    expect(isNoise({ title: "Temporary Denial of Export Privileges; Jane Doe" })).toBe(true);
    const keep = "Reinstatement of Export Privileges";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops Privacy Act of 1974 notices, keeps other Privacy Act notices", () => {
    expect(isNoise({ title: "Privacy Act of 1974; Matching Program" })).toBe(true);
    const keep = "Privacy Act Systems of Records Modernization";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops advisory committee notices, keeps advisory panel notices", () => {
    expect(isNoise({ title: "Charter: National Advisory Committee on Shipbuilding" })).toBe(true);
    const keep = "Renewal of the Advisory Panel on Shipbuilding";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops performance review board notices, keeps other performance notices", () => {
    expect(isNoise({ title: "Senior Executive Service: Performance Review Board Members" })).toBe(true);
    const keep = "Senior Executive Service: Performance Appraisal Review Board";
    expect(isNoise({ title: keep })).toBe(false);
  });

  it("drops annual continuation-of-national-emergency notices, keeps declaring/expanding national emergencies", () => {
    expect(isNoise({ title: "Continuation of the National Emergency With Respect to Example Country" })).toBe(true);
    // expanded-scope/imposition continuations are substantive, not annual boilerplate
    expect(isNoise({ title: "Continuation of the National Emergency With Respect to the PRC and Expansion of Scope" })).toBe(false);
    expect(isNoise({ title: "Continuation of the National Emergency With Respect to Example Country and Imposition of Additional Tariffs" })).toBe(false);
    const keep1 = "Declaring a National Emergency With Respect to Example Imports";
    expect(isNoise({ title: keep1 })).toBe(false);
    const keep2 = "Expanding the Scope of the National Emergency With Respect to Example Country";
    expect(isNoise({ title: keep2 })).toBe(false);
  });

  it("drops FTA textile short-supply / commercial-availability notices, keeps USMCA automotive reports", () => {
    expect(isNoise({ title: "Determination Under the Textile and Apparel Commercial Availability Provision of the Dominican Republic-Central America-United States Free Trade Agreement" })).toBe(true);
    expect(isNoise({ title: "Additions to the Short Supply List Under the CAFTA-DR" })).toBe(true);
    const keep = "USMCA Automotive Rules of Origin: Economic Impact and Operation, 2027 Report";
    expect(isNoise({ title: keep })).toBe(false);
    expect(isRelevant({ title: keep })).toBe(true);
  });
});

describe("noise pattern coverage", () => {
  it("covers every NOISE_PATTERNS entry (add a test when adding a pattern)", () => {
    expect(NOISE_PATTERNS.length).toBe(19);
  });

  it("AD_CVD_RE is the first noise pattern (Section 232 override depends on identity)", () => {
    expect(NOISE_PATTERNS[0]).toBe(AD_CVD_RE);
  });
});
