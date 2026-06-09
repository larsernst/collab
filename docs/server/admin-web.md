# Admin Web Interface

## Implementation Status

The initial Phase 2 administration slice is implemented. It includes bootstrap,
browser login/logout, the dashboard shell, user creation, disabling, session
revocation, read-only vault inventory, and redacted audit views.

Still pending in Phase 2: invitations, password self-service and dedicated reset
controls, richer storage/operational summaries, browser automation,
accessibility auditing, and the native login flow.

## Purpose

The self-hosted server includes a small browser-based administration interface.
It improves first-run setup and routine operation without turning the future
general-purpose web app into a Phase 2 requirement.

The interface uses the Collab visual language: existing themes, accent colors,
typography, spacing, shared control patterns, and clear document-style top bars.
It is responsive for desktop and tablet administration, but it is not a vault
editor.

## Delivery Boundary

Phase 2 delivers:

- First-administrator bootstrap and admin login.
- User creation, invitations, disabling, password resets, and session revocation.
- A dashboard showing server health, version, uptime, storage summaries, and
  counts for users, sessions, invitations, and hosted vaults.
- Recent redacted audit events and actionable operational warnings.
- A read-only hosted-vault inventory with name, owner, member count, status,
  storage usage when available, and last activity.

Phase 3 expands the same interface with:

- Hosted-vault details and activity.
- Member and role management.
- Archive, delete, import, export, and storage-management actions.

Later phases may add collaboration metrics, backup state, and upgrade guidance.
Editing vault content remains outside the admin interface.

## Application Shape

The admin interface should live as a focused React application under
`apps/admin-web/`. It should reuse or extract Collab design tokens and suitable
shared UI primitives without coupling the browser bundle to Tauri APIs.

Production builds emit static assets served on the same origin as the server API
through the gateway. Client-side routing lives below `/admin/`; API calls remain
under `/api/v1/admin/`.

Initial routes:

- `/admin/bootstrap`
- `/admin/login`
- `/admin/`
- `/admin/users`
- `/admin/users/{userId}`
- `/admin/vaults`
- `/admin/audit`

## Browser Security

- Browser sessions use `Secure`, `HttpOnly`, and appropriate `SameSite` cookies.
- State-changing requests require CSRF protection.
- Admin pages and APIs require a server-verified active administrator session.
- A strict Content Security Policy forbids arbitrary scripts and remote content.
- Authentication state and secrets are never persisted in browser local storage.
- Login, bootstrap, invitation, and password-reset endpoints are rate-limited.
- Every administration mutation creates an audit event.

The browser never receives raw container logs, environment variables, stack
traces, authorization headers, cookies, tokens, password material, or invitation
secrets. The dashboard consumes typed, redacted audit events and operational
summaries produced by the server.

## Dashboard Data

The dashboard may display:

- Liveness/readiness and degraded dependency state.
- Server, protocol, and database schema versions.
- Process uptime and last successful migration time.
- User, active-session, invitation, and hosted-vault counts.
- Database and blob-storage usage summaries.
- Recent redacted audit events.
- Typed operational warnings such as failed login spikes, storage pressure,
  migration failures, or unavailable dependencies.

Detailed metrics, raw log aggregation, and production alerting remain Phase 7
work.

## Testing Expectations

- Component and state tests for every management workflow.
- API contract tests for every dashboard and administration endpoint.
- Authorization tests proving non-admin sessions cannot access pages or APIs.
- CSRF, cookie, rate-limit, redaction, and session-revocation tests.
- Browser-level tests for bootstrap, login, user creation, invitation, disabling,
  session revocation, logout, and dashboard degraded states.
- Accessibility checks for keyboard navigation, labels, focus management,
  contrast, loading states, empty states, and error states.
