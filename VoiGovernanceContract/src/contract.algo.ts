import {
  Contract,
  GlobalState,
  Account,
  uint64,
  bytes,
  Uint64,
  op,
  Global,
  Txn,
  BoxMap,
  log,
  assert,
  Bytes,
} from '@algorandfoundation/algorand-typescript'

// Helper function to pad a number with leading zeros
// Returns bytes instead of string for PuyaTS compatibility
function padNumber(n: uint64, length: uint64): bytes {
    const numStr = op.itob(n)
    const numLen = op.len(numStr)
    
    // Calculate how many zeros we need to add
    let zerosNeeded: uint64
    if (length > numLen) {
        zerosNeeded = length - numLen
    } else {
        zerosNeeded = Uint64(0)
    }
    
    // Build the padded result using concat
    let result = Bytes('')
    let i = Uint64(0)
    while (i < zerosNeeded) {
        result = op.concat(result, Bytes('0'))
        i = i + Uint64(1)
    }
    result = op.concat(result, numStr)
    
    return result
}

export class VoiGovernance extends Contract {
  // Administrative control stored in Global State
  admin = GlobalState<Account>({ initialValue: Txn.sender })

  // Configuration constant
  maxSlots = GlobalState<uint64>({ initialValue: Uint64(10) })

  // Box storage mapping for proposal slots
  slots = BoxMap<uint64, bytes>({ keyPrefix: 'slot_' })

  // Box storage mapping for the whitelist array
  whitelistBox = BoxMap<string, Account[]>({ keyPrefix: '' })

  public changeAdmin(newAdmin: Account): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized: Only admin can change admin')
    this.admin.value = newAdmin
  }

  /**
   * Admin-only resolution of a proposal after voting has completed.
   * Can be called after voting expires or when all whitelisted wallets have voted.
   * resolution: 1 = Pass, 2 = Reject
   */
  public resolveProposal(slot: uint64, resolution: uint64): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized: Only admin can resolve proposals')
    assert(slot < this.maxSlots.value, 'Invalid slot index')
    assert(this.slots(slot).exists, 'Proposal slot not initialized')

    const data = this.slots(slot).value
    assert(op.substring(data, 0, 1) === Bytes('\x01'), 'Proposal is not active')

    const proposalId = op.btoi(op.substring(data, 1, 9))
    const yea = op.btoi(op.substring(data, 9, 17))
    const nay = op.btoi(op.substring(data, 17, 25))
    const abstain = op.btoi(op.substring(data, 25, 33))
    const expiration = op.btoi(op.substring(data, 33, 41))
    const voteMask = op.btoi(op.substring(data, 41, 49))

    assert(resolution === Uint64(1) || resolution === Uint64(2), 'Invalid resolution: Use 1=Approve, 2=Reject')

    const resolutionLabel = resolution === Uint64(1) ? Bytes('APPROVED') : Bytes('REJECTED')

    // Log ultra-compact resolution message (fits 16 bytes)
    const status = resolution === Uint64(1) ? Bytes('A') : Bytes('R')
    const pid = padNumber(proposalId, 3)
    const yeaStr = padNumber(yea, 1)
    const nayStr = padNumber(nay, 1)
    const abstainStr = padNumber(abstain, 1)
    log(op.concat(
      Bytes('P:'),
      op.concat(pid,
        op.concat(Bytes('|Y:'),
          op.concat(yeaStr,
            op.concat(Bytes('|N:'),
              op.concat(nayStr,
                op.concat(Bytes('|A:'),
                  op.concat(abstainStr,
                    op.concat(Bytes('|VF:'), status)
                  )
                )
              )
            )
          )
        )
      )
    ))

    const emptyPayload = op.concat(
      Bytes('\x00'),
      op.concat(
        op.itob(Uint64(0)),
        op.concat(
          op.itob(Uint64(0)),
          op.concat(
            op.itob(Uint64(0)),
            op.concat(
              op.itob(Uint64(0)),
              op.concat(op.itob(Uint64(0)), op.itob(Uint64(0)))
            )
          )
        )
      )
    )

    this.slots(slot).value = emptyPayload
  }

  public updateWhitelist(newWhitelist: Account[]): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized: Only admin can update whitelist')
    assert(Uint64(newWhitelist.length) <= this.maxSlots.value, 'Whitelist cannot exceed 10 wallets')

    // Write array to Box Storage under key "whitelist"
    this.whitelistBox('whitelist').value = [...newWhitelist]
  }

  public initializeProposal(slot: uint64, proposalId: uint64, duration: uint64): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized: Only admin can initialize proposals')
    assert(slot < this.maxSlots.value, 'Invalid slot index: Must be 0-9')

    if (this.slots(slot).exists) {
      const data = this.slots(slot).value
      const statusByte = op.substring(data, 0, 1)
      assert(statusByte === Bytes('\x01'), 'Slot is currently active with another proposal')
    }

    const expiration: uint64 = Global.latestTimestamp + duration

    const payload = op.concat(
      Bytes('\x01'),
      op.concat(
        op.itob(proposalId),
        op.concat(
          op.itob(Uint64(0)),
          op.concat(
            op.itob(Uint64(0)),
            op.concat(
              op.itob(Uint64(0)),
              op.concat(
                op.itob(Uint64(0)),
                op.concat(
                  op.itob(Uint64(0)),
                  op.itob(Uint64(0))
                )
              )
            )
          )
        )
      )
    )

    this.slots(slot).value = payload
  }

  public castVote(slot: uint64, voteType: uint64): void {
    assert(slot < this.maxSlots.value, 'Invalid slot index')
    assert(this.slots(slot).exists, 'Proposal slot not initialized')
    assert(this.whitelistBox('whitelist').exists, 'Whitelist box not initialized')

    const whitelist = [...this.whitelistBox('whitelist').value]
    let isWhitelisted = false
    let voterIndex: uint64 = Uint64(0)

    for (let i: uint64 = 0; i < whitelist.length; i++) {
      if (whitelist[i] === Txn.sender) {
        isWhitelisted = true
        voterIndex = Uint64(i)
        break
      }
    }

    assert(isWhitelisted, 'Unauthorized: Sender wallet is not whitelisted')

    const data = this.slots(slot).value
    assert(op.substring(data, 0, 1) === Bytes('\x01'), 'Proposal is not active')

    const proposalId = op.btoi(op.substring(data, 1, 9))
    let yea = op.btoi(op.substring(data, 9, 17))
    let nay = op.btoi(op.substring(data, 17, 25))
    let abstain = op.btoi(op.substring(data, 25, 33))
    const expiration = op.btoi(op.substring(data, 33, 41))
    let voteMask = op.btoi(op.substring(data, 41, 49))

    assert(Global.latestTimestamp <= expiration, 'Voting window has already expired')

    const voterBit = op.shl(Uint64(1), voterIndex)
    assert((voteMask & voterBit) === Uint64(0), 'Double-voting rejected: Wallet already voted')

    if (voteType === Uint64(1)) {
      yea = yea + Uint64(1)
    } else if (voteType === Uint64(2)) {
      nay = nay + Uint64(1)
    } else if (voteType === Uint64(3)) {
      abstain = abstain + Uint64(1)
    } else {
      assert(false, 'Invalid vote type: Use 1=Yea, 2=Nay, 3=Abstain')
    }

    voteMask = voteMask | voterBit
    const totalVotesCast: uint64 = yea + nay + abstain

    const updatedPayload = op.concat(
      Bytes('\x01'),
      op.concat(
        op.itob(proposalId),
        op.concat(
          op.itob(yea),
          op.concat(
            op.itob(nay),
            op.concat(
              op.itob(abstain),
              op.concat(op.itob(expiration), op.itob(voteMask))
            )
          )
        )
      )
    )

    this.slots(slot).value = updatedPayload

    if (totalVotesCast === Uint64(whitelist.length)) {
      this.finalizeAndClear(slot, proposalId, yea, nay, abstain, Bytes('All whitelisted wallets voted'), Bytes('R'))
    }
  }

  public resolveExpiredProposal(slot: uint64, resolution: uint64): void {
    assert(slot < this.maxSlots.value, 'Invalid slot index')
    assert(this.slots(slot).exists, 'Proposal slot not initialized')
    
    const data = this.slots(slot).value
    assert(op.substring(data, 0, 1) === Bytes('\x01'), 'Proposal is not active')
    
    const expiration = op.btoi(op.substring(data, 33, 41))
    assert(Global.latestTimestamp > expiration, 'Proposal voting window is still open')
    
    const proposalId = op.btoi(op.substring(data, 1, 9))
    const yea = op.btoi(op.substring(data, 9, 17))
    const nay = op.btoi(op.substring(data, 17, 25))
    const abstain = op.btoi(op.substring(data, 25, 33))

    const status = Bytes('E')
    const pid = padNumber(proposalId, 3)
    const yeaStr = padNumber(yea, 1)
    const nayStr = padNumber(nay, 1)
    const abstainStr = padNumber(abstain, 1)
    log(op.concat(
      Bytes('P:'),
      op.concat(pid,
        op.concat(Bytes('|Y:'),
          op.concat(yeaStr,
            op.concat(Bytes('|N:'),
              op.concat(nayStr,
                op.concat(Bytes('|A:'),
                  op.concat(abstainStr,
                    op.concat(Bytes('|VF:'), status)
                  )
                )
              )
            )
          )
        )
      )
    ))

    this.finalizeAndClear(slot, proposalId, yea, nay, abstain, Bytes('Expired resolved'), Bytes('E'))
  }

  public terminateProposal(slot: uint64, reason: bytes): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized: Only admin can terminate proposals')
    assert(slot < this.maxSlots.value, 'Invalid slot index')
    assert(this.slots(slot).exists, 'Proposal slot not initialized')

    const data = this.slots(slot).value
    assert(op.substring(data, 0, 1) === Bytes('\x01'), 'Proposal slot is not active')

    const proposalId = op.btoi(op.substring(data, 1, 9))
    const yea = op.btoi(op.substring(data, 9, 17))
    const nay = op.btoi(op.substring(data, 17, 25))
    const abstain = op.btoi(op.substring(data, 25, 33))

    this.finalizeAndClear(slot, proposalId, yea, nay, abstain, op.concat(Bytes('Terminated by Admin: '), reason), Bytes('T'))
  }

  private finalizeAndClear(slot: uint64, proposalId: uint64, yea: uint64, nay: uint64, abstain: uint64, reason: bytes, status: bytes): void {
    log(op.concat(
      Bytes('P:'),
      op.concat(padNumber(proposalId, 3),
        op.concat(Bytes('|Y:'),
          op.concat(padNumber(yea, 1),
            op.concat(Bytes('|N:'),
              op.concat(padNumber(nay, 1),
                op.concat(Bytes('|A:'),
                  op.concat(padNumber(abstain, 1),
                    op.concat(Bytes('|VF:'), status)
                  )
                )
              )
            )
          )
        )
      )
    ))

    const emptyPayload = op.concat(
      Bytes('\x00'),
      op.concat(
        op.itob(Uint64(0)),
        op.concat(
          op.itob(Uint64(0)),
          op.concat(
            op.itob(Uint64(0)),
            op.concat(
              op.itob(Uint64(0)),
              op.concat(op.itob(Uint64(0)), op.itob(Uint64(0)))
            )
          )
        )
      )
    )

    this.slots(slot).value = emptyPayload
  }
}