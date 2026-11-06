# Email templates (Pass 129)

These are the texts of the emails Supabase sends for MeasureOne's accounts: the invitation, the
reset link and so on. **They are the record, not the live copy.** Supabase keeps the live text in its
dashboard (Authentication, Emails, Templates), once per project, and the dashboard is not versioned.
So when a template changes, change the file here and paste the same text into the dashboard of
**both** projects (test and production). The words, and Supabase's placeholders, must match exactly.

| File | Dashboard template | Subject line |
|---|---|---|
| `invite.html` | Invite user | You're invited to MeasureOne |
| `confirmation.html` | Confirm sign up | Confirm your email for MeasureOne |
| `recovery.html` | Reset password | Reset your MeasureOne password |
| `email_change.html` | Change email address | Confirm your new MeasureOne email address |
| `reauthentication.html` | Reauthentication | Your MeasureOne confirmation code |

The file names are the ones Supabase's command-line tool uses, so these files can be used with it later.

## Rules

- **Keep Supabase's placeholders exactly as written** (`{{ .ConfirmationURL }}`, `{{ .Email }}`,
  `{{ .NewEmail }}`, `{{ .Token }}`). A typo does not show an error: the link just stops working.
  Which placeholder each file uses: `invite`, `recovery` and `confirmation` use `.ConfirmationURL`
  (`confirmation` and `recovery` also `.Email`); `email_change` uses `.ConfirmationURL`, `.Email` and
  `.NewEmail`; `reauthentication` uses `.Token` only.
- **No em dashes** in any of the text (the house rule for what people read).
- **No tracking.** The email service's open and click tracking must stay off (Resend's is off by
  default), or it rewrites the links and breaks them.
- Plain wording. Each email says why the person got it and that they can ignore it if it wasn't them.
  The text does not give how long a link lasts, so the setting can change without these files lying.
  How long it is lives in the project settings (Authentication, Sign In / Providers, Email, Email OTP
  expiration; Supabase's most is 24 hours).
- A footer line with the link to the privacy policy is added in Pass 133.

## Not changed here

- **Magic link.** The app has no magic-link sign-in, so that template is never sent.
- **The "security notification" emails** (password changed, email address changed, and so on) are
  only sent if switched on for the project. If one is ever switched on, it needs its own text here
  first, or it goes out in Supabase's wording.
