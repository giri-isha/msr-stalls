# Stall Management — The Requester's Portal, Behind the Session

Date: 2026-09-15
Status: Approved, building

## Context

`2026-09-15-stalls-vendor-login-design.md` gave requesters an account and a
session, and used it for exactly one thing: gating `/stalls/apply` and the
submission behind it. That spec said plainly that the portal — "see the step
they are in and the form they can fill" — was already built and was not being
rebuilt. It was right that it existed. What it left is a module with **two
credentials that do not meet**:

| To do this | You need |
|---|---|
| Fill in a stall request form | the session cookie |
| See what happened to that request | a signed link from an email |

So a requester who registers, logs in and submits is returned to the form
picker, and logging in again a week later shows them the same four tiles. The
one question they came back to ask — *what happened to my request?* — is
answerable only from their inbox.

This spec joins the two. It adds no new view logic and no second opinion about
what a request still owes.

## Decisions

1. **The session is a second caller of the existing portal, not a second
   portal.** `statusView` and `stepLink` read nothing from the access link but
   `accountId` and `account.displayName` (`portal.ts:99`, `portal.ts:164`).
   They become account-shaped and both credentials call them. A second
   implementation of "what is outstanding" is the failure mode
   `onboarding.ts` was written to prevent — three screens, one
   `pendingSteps` — and a fourth caller must not reintroduce it.

2. **The emailed status link keeps working, unchanged.** Decision 10 of the
   login spec stands: those links are in inboxes now and are held by exactly
   the people furthest through onboarding. The session is another way in, not
   a replacement. Two ways in is correct for a transition.

3. **A status link does not become a login.** Following one mints no session.
   A status link is forwarded — to a business partner, to whoever handles the
   paperwork — and the whole design of `resolveAccessLink`'s purpose narrowing
   is that holding one link grants one thing. Promoting it to a session would
   silently widen every link already sent.

4. **The list lives at `/stalls/requests`, not on the apply page.** The apply
   page has one job and a gate in front of it. A page that is a form picker
   when you are signed out and a status board when you are signed in is two
   pages wearing one route.

5. **Requesting another stall stays available.** A vendor legitimately applies
   for more than one stall, and for more than one type; staff cannot create a
   request on their behalf. The list leads and the tiles remain, one link
   away. Nothing blocks on an undecided request.

6. **`GET /public/requests` sits beside `POST /public/requests`.** Same path,
   same credential, read against create. The public-routes file's rule — every
   route gated by exactly one of three credentials — holds; these join the
   SESSION column that `POST /requests` already occupies.

7. **Login lands on the requests page.** A returning requester logs in to ask
   what happened; a first-timer lands on an empty state one click from the
   forms. The previous destination, the form picker, answers only the second.

8. **No count on the apply page.** The signed-in link says "View your
   requests", not "You have 2". A count means a second fetch on a public page
   that today makes one, to decorate a link whose destination renders the
   count anyway.

## API

### Refactor — no behaviour change

```ts
statusView(db, account: StallAccount): Promise<PublicStatusResponse>
stepLink(db, deps, accountId: string, input: ContinueStepInput): Promise<{ url: string }>
```

The token routes pass `link.account` and `link.accountId`. Everything else in
both functions is untouched, and a regression test pins that `GET
/status/:token` returns the same view it did before.

### New routes

| Route | Credential | Body | Handler |
|---|---|---|---|
| `GET /public/requests` | session cookie | — | `statusView(prisma, account)` |
| `POST /public/requests/continue` | session cookie | `ContinueStepInput` | `stepLink(prisma, deps, account.id, body)` |

Statuses come from the existing mapping and are deliberately the same as the
token path's:

- no session, expired session, or a token of another purpose used as one →
  `UnknownAccessLinkError` → **404**
- a `reference` that is not this account's → **404**, indistinguishable from
  one that does not exist
- a step that is not outstanding → `StepNotOpenError` → **409**, which is what
  stops this becoming a way to mint a bank-form link for a request whose bank
  details are already in

## Web

| File | Change |
|---|---|
| `public/RequestCards.tsx` | **New.** The card list lifted out of `StatusPage` unchanged — reference, status copy, allocated zone and stalls, "Still to do", "Open the form". Props: the requests, and one `openStep(reference, step) => Promise<{ url }>`. |
| `public/MyRequests.tsx` | **New.** `/stalls/requests`. Loading → `Loading`. No session → `Navigate to='/stalls/login'`. No requests → "You haven't requested a stall yet" and a link to `/stalls/apply`. |
| `public/StatusPage.tsx` | Keeps its token, its expired-link card and its 404 copy; renders `RequestCards` with the token-based callback. |
| `public/FormPicker.tsx` | Signed in, a "View your requests" link above the tiles. The tiles do not move. |
| `public/Login.tsx` | Redirects to `/stalls/requests`. |
| `public/Submitted.tsx` | "Check your status" points at `/stalls/requests`; the emailed link is still mentioned. |
| `index.tsx` | `{ path: 'requests', element: <MyRequests /> }`. |
| `api.ts` | `getMyRequests()`, `continueMyStep(body)`. |

The link is minted on the click in both pages, never on render — the rule
`StatusPage` already states, so that refreshing does not mint a bank-form link
each time.

## Testing

API — `apps/api/test/my-requests.test.ts`:

- a session returns that account's requests and no one else's
- no cookie → 404
- a `BANK_FORM` token sent as the session cookie → 404
- continue mints a bank-form link when `BANK_FORM` is outstanding
- continue on a reference belonging to another account → 404
- continue on a step that is not outstanding → 409
- regression: `GET /status/:token` returns the same view after the refactor

Web — `public/MyRequests.test.tsx`:

- signed out redirects to the login
- renders the status copy and the pending chips
- "Open the form" assigns the minted URL
- the empty state links to the apply page

## What SSO deletes

Nothing in this document. Both routes are gated by `SESSION`, and the OIDC
callback mints the same `SESSION` link the password login mints today. This is
the part of the login work that outlives the password.

## Documents to amend

- `docs/requirements-traceability.md` — the portal row gains the session as a
  second way in; no row changes state.
