import type { AuthError } from "@supabase/supabase-js";

export type AuthErrorKind = "wrong_password" | "existing_email" | "unverified_email" | "other";

/** Turn Supabase auth errors into messages people understand. */
export function describeAuthError(error: AuthError): { kind: AuthErrorKind; message: string } {
  switch (error.code) {
    case "invalid_credentials":
      // Supabase deliberately doesn't say whether the email exists.
      return { kind: "wrong_password", message: "Wrong email or password. Check both and try again." };
    case "email_not_confirmed":
      return {
        kind: "unverified_email",
        message: "Your email isn't verified yet. Open the link we sent to your inbox, then log in.",
      };
    case "user_already_exists":
    case "email_exists":
      return { kind: "existing_email", message: "An account with this email already exists. Log in instead." };
    case "weak_password":
      return { kind: "other", message: "That password is too weak. Use at least 8 characters with a number." };
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return { kind: "other", message: "Too many attempts. Wait a minute and try again." };
    case "email_address_invalid":
      return { kind: "other", message: "That email address can't be used. Try another one." };
    default:
      return { kind: "other", message: error.message };
  }
}
