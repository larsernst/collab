# Collaboration Server Architecture

This directory contains the approved Phase 0 architecture for the self-hosted collaboration server.

The collaboration server is a separate Rust service that becomes authoritative for hosted vaults. Existing local vaults remain owned by the Tauri application and continue to use the current filesystem-backed behavior.

## Documents

- [Hosted Vault Domain Model](./hosted-vault-domain.md)
- [REST and WebSocket Protocol](./protocol.md)
- [Security, Operations, and Compatibility](./security-operations.md)
- [Workspace and Verification](./workspace-verification.md)
- [Server Development and Compose](./development.md)
- [Deployment Topology and Upgrade Compatibility](./deployment-topology.md)
- [Server Backups](./backups.md)
- [Upgrade and Failed-Migration Recovery](./upgrade-recovery.md)
- [TLS, Security Headers, and Secret Rotation](./tls-and-secrets.md)
- [Dependency and Container Vulnerability Scanning](./vulnerability-scanning.md)
- [Load Testing](./load-testing.md)
- [Release Security Review](./security-review.md)
- [Multi-Architecture Server Images](./container-images.md)
- [Admin Web Interface](./admin-web.md)
- [ADR 0001: Authentication and Sessions](./adr/0001-authentication-and-sessions.md)
- [ADR 0002: Hosted Vault Storage](./adr/0002-hosted-vault-storage.md)
- [ADR 0003: CRDT Persistence](./adr/0003-crdt-persistence.md)
- [ADR 0004: Offline Synchronization](./adr/0004-offline-synchronization.md)

## Core Boundary

Hosted vault synchronization has two independent authorities:

1. Document content for notes, Kanban boards, and canvases is synchronized through CRDT documents.
2. Vault structure is synchronized through an ordered server manifest and idempotent structural operations.

Binary assets are immutable blobs referenced by file revisions. Presence and rich awareness are ephemeral and never become canonical vault content.

## Implementation Order

The server must first support authenticated, online-only hosted vault CRUD. Live CRDT collaboration and full offline synchronization are later phases built on the same stable file IDs, manifest sequence, and authorization rules.
