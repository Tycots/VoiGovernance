# VoiGovernance

VoiGovernance is an Algorand smart contract for a small, admin-controlled governance system. It supports a fixed set of proposal slots, a whitelist of eligible voters, and compact on-chain vote tracking using box storage. The contract is implemented in Algorand TypeScript (PuyaTS) and compiled to AVM bytecode.

## Overview

The contract allows an admin to:

- manage the governance admin address
- define the voter whitelist
- initialize a proposal in one of 10 available slots
- resolve active proposals or expired proposals
- terminate a proposal with a custom reason

Eligible wallets can:

- cast a vote only if they are on the whitelist
- vote once per proposal slot
- vote only while the proposal is active and before expiry

## Governance model

The contract enforces a simple voting model:

- Up to 10 slots are available (`maxSlots = 10`)
- Each slot stores a single proposal payload in a box
- A whitelist is stored in a dedicated box and can be updated by the admin
- Each proposal is encoded as a compact byte payload containing:
  - status byte
  - proposalId
  - yea count
  - nay count
  - abstain count
  - expiration timestamp
  - vote mask

## Contract state

### Global state

| Key | Type | Purpose |
|------|------|---------|
| `admin` | `address` | Address that is allowed to manage whitelist, proposals, and resolutions |
| `maxSlots` | `uint64` | Maximum number of proposal slots, currently 10 |

### Box storage

| Box | Key | Value | Purpose |
|------|-----|-------|---------|
| `slots` | `slot_<uint64>` | bytes | Active or cleared proposal data for a given slot |
| `whitelistBox` | `whitelist` | `address[]` | List of wallet addresses eligible to vote |

## Proposal lifecycle

Each proposal slot behaves like a state machine:

1. `initializeProposal(slot, proposalId, duration)`
   - verifies the caller is the admin
   - ensures the slot index is valid
   - checks the slot is not already active
   - stores a new proposal payload with status byte `0x01` (active)
   - sets expiration = latest timestamp + duration

2. `castVote(slot, voteType)`
   - only whitelisted wallet addresses can vote
   - vote type must be one of:
     - `1` = Yea
     - `2` = Nay
     - `3` = Abstain
   - double-voting is prevented using a bitmask keyed by whitelist index
   - proposal must still be active and not expired

3. `resolveProposal(slot, resolution)`
   - admin-only resolution of an active proposal
   - resolution must be `1` (approve) or `2` (reject)
   - then the slot is finalized and cleared

4. `resolveExpiredProposal(slot, resolution)`
   - allows the admin to resolve a proposal after the deadline
   - the proposal is finalized with expired status (`E`)

5. `terminateProposal(slot, reason)`
   - admin-only emergency termination
   - stores a reason string and marks the slot as terminated (`T`)

All finalization paths emit a log message for off-chain indexing and then clear the slot box.

## Key methods

### `changeAdmin(newAdmin)`

Changes the admin address. Only the current admin can call this.

### `updateWhitelist(newWhitelist)`

Replaces the whitelist with a new list of authorized voter addresses. The list length must not exceed the configured `maxSlots` value.

### `initializeProposal(slot, proposalId, duration)`

Initializes a new proposal in the given slot. The slot must not already be active.

### `castVote(slot, voteType)`

Allows a whitelisted wallet to cast a vote in the active proposal for that slot.

### `resolveProposal(slot, resolution)`

Admin resolves a proposal based on a final decision. Accepts `1` for approve and `2` for reject.

### `resolveExpiredProposal(slot, resolution)`

Allows expiration-based resolution after the voting window closes. The contract does not validate the same resolution values here, but the admin path is still restricted by the call pattern and the active-slot conditions.

### `terminateProposal(slot, reason)`

Admin can terminate a proposal and record a human-readable cause.

## Vote payload structure

The proposal data stored in each slot is a compact byte sequence. The payload is built in this order:

- status byte
- `proposalId` (8 bytes, big-endian/integer representation)
- `yea` (8 bytes)
- `nay` (8 bytes)
- `abstain` (8 bytes)
- `expiration` timestamp (8 bytes)
- `voteMask` (8 bytes)

The contract uses `voteMask` to enforce one vote per whitelist wallet. Each wallet occupies one bit based on its index in the whitelist array.

## Security notes

- Only the `admin` can update governance configuration, initialize proposals, and resolve/terminate them.
- Voter eligibility is controlled through the whitelist box, not by arbitrary addresses.
- Double-voting is rejected by checking the vote bit before updating the mask.
- Proposal expiry is checked against `Global.latestTimestamp` before vote acceptance.
- Finalization clears the proposal slot to avoid stale active state.

## Build and deployment

This contract is designed to be compiled with Algorand TypeScript/Puya and deployed to an Algorand network using standard app deployment tooling. After deployment:

1. call `updateWhitelist` with the eligible voting wallets
2. call `initializeProposal` with a slot, proposal identifier, and duration
3. allow the whitelist to `castVote`
4. resolve the proposal via `resolveProposal` or `resolveExpiredProposal`

## Example usage

```ts
// admin updates whitelist
app.updateWhitelist([accountA, accountB, accountC])

// admin starts a proposal in slot 0 for 10,000 rounds
app.initializeProposal(0, 42, 10000)

// whitelisted voter casts a Yea vote
app.castVote(0, 1)

// admin resolves it after voting ends
app.resolveProposal(0, 1)
```

## Notes

This contract is intentionally minimal and governance-focused rather than general-purpose DAO infrastructure. It is best suited for controlled governance workflows where a trusted admin manages proposal lifecycle and a fixed whitelist of voters participates.
