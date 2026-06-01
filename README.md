# packablock-demo

A dedicated integration workspace demonstrating independent release cycles and verifying the end-to-end (E2E) zero-trust cryptographic chain validation loop between the `pblk` client and the Fastify `packablock-registry` server.

## 🚀 Automated E2E Test Suite

We have built a fully automated E2E test runner (`e2e-run.sh`) that manages and asserts the entire cryptographic lifecycle:

1. **Onboarding**: Registers the mock repo (`demouser/demo-repo`) dynamically on the registry server to fetch credentials.
2. **Initialization**: Seeds a fresh local package chain (`pblk init`).
3. **Ledger Modification**: Appends direct dependencies to the blockchain log (`pblk append`).
4. **Standalone Audit**: Performs cryptographically sealed offline integrity validations (`pblk check`).
5. **Anchoring Checkpoint**: Synchronizes the local log with the registry server (`pblk push`).
6. **Registry Auditing**: Cryptographically validates the log against server-side receipts (`pblk check --server`).
7. **Attestation Packaging**: Compiles a lightweight, metadata-only Pack archive (`pblk pack`).
8. **Archive Verification**: Directly validates the secure `pack.tar.gz` (`pblk check pack.tar.gz`).
9. **Key Rollover**: Coordinates cryptographic key rotations, archiving the old log history into cold storage and creating a linked rollover genesis block in a transactional, rollback-safe block creation loop (`pblk rollover`).
10. **Cold Archives Ingestion**: Queries the registry REST endpoints to assert that the historical epoch was archived correctly.

### Running the E2E Suite

Ensure the VM registry database environment is clean, then run the script directly:

```bash
./e2e-run.sh
```

*(Note: The E2E script is self-healing. If a local registry server is not currently running on port 3030, it automatically boots up a temporary, sandboxed registry instance in the background, executes the full suite, and cleans it up cleanly on exit.)*
