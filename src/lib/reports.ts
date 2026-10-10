/** Why a rider can be reported. "not_a_woman" only applies to women-only rides. */
export const REPORT_REASONS = [
  { value: "not_a_woman", label: "Not a woman", womenOnly: true },
  { value: "unsafe_behaviour", label: "Unsafe behaviour" },
  { value: "harassment", label: "Harassment" },
  { value: "fake_profile", label: "Not the person in their profile" },
  { value: "no_show", label: "Didn't show up" },
  { value: "other", label: "Something else" },
] as const;
