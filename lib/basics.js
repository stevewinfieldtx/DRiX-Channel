// The basics are a FIXED checklist in lifecycle order.
// The engine NEVER invents, reorders, or rewords them.
// Tier 1's only job is to decide Yes / No / Maybe per industry.
export const BASICS = [
  "Voice agent online — answers questions and handles the basics",
  "Scheduling appointments — books them into the calendar",
  "Calling to remind about an appointment",
  "Helping fill blank spots from cancellations",
  "Checking in on customer satisfaction after the fact",
  "Google review management",
  "Recurring re-engagement — renewal nudges, seasonal check-ins, next-purchase window"
];

// The decomposition lens for THIS use case (AI integration into a customer's environment).
// Dimensionality is what the data demands — this set is 10, not a forced 9.
export const DIMENSIONS = [
  "sales_cycle_stage",
  "role",
  "recency",
  "business_function",   // operations | sales | marketing | executive
  "temperature",         // hot | warm | cold
  "ai_readiness",        // can they absorb/own it internally
  "pain_type",           // revenue_capture | operational_drag | retention | visibility | compliance_risk
  "urgency",             // on_fire | this_quarter | someday
  "impact",
  "effort"               // includes integration surface
];

export const PAIN_BUCKETS = [
  "revenue_capture",
  "operational_drag",
  "retention",
  "visibility",
  "compliance_risk"
];

// Indicative fallback price bands (USD, total one-year contract value) by effort.
// Used ONLY when a live market search returns no usable comparables for a solution.
// These are rough, overridable anchors — recalibrate against real closes.
// Monthly = total / 12. Setup = one month's fee.
export const EFFORT_BANDS = {
  Quick:    { low: 8000,  high: 18000 },
  Moderate: { low: 18000, high: 45000 },
  Heavy:    { low: 45000, high: 90000 }
};
