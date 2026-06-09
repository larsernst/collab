# ADR 0001: Authentication and Sessions

- Status: Accepted
- Date: 2026-06-09

## Decision

The first self-hosted server uses server-managed users with username and password authentication.

- Passwords are hashed with Argon2id using per-password salts and parameters stored with each hash.
- The first administrator is created through a one-time bootstrap command. Bootstrap credentials are never accepted after an administrator exists.
- Access tokens are short-lived signed tokens with a 15-minute lifetime and are kept in memory by the native client.
- Refresh tokens are opaque random 256-bit values, stored hashed in PostgreSQL, rotated on every use, and revoked as a token family when reuse is detected.
- The native client stores only the refresh token in the operating system credential store.
- REST requests use `Authorization: Bearer <access-token>`.
- WebSocket clients obtain a single-use, 60-second WebSocket ticket from an authenticated REST endpoint. Tokens are never placed in WebSocket URLs.
- Authorization always derives the user from the validated server session. Client-supplied user IDs are display or correlation data only.
- Administrators can disable users and revoke individual or all user sessions.
- Password reset is administrator-driven in the first release. Email delivery and public signup are out of scope.

## Rationale

This model works for trusted self-hosted teams without requiring an external identity provider. Short-lived access tokens limit exposure, while rotating opaque refresh tokens allow reliable revocation from native clients.

## Consequences

- OIDC/SSO can be added later as another authentication provider without changing vault memberships.
- The server must maintain session, refresh-token-family, and authentication audit records.
- Login, refresh, bootstrap, invitation acceptance, and WebSocket-ticket issuance require rate limits.
- Authentication secrets and raw tokens must never be logged.
