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
  abimethod,
} from '@algorandfoundation/algorand-typescript'

function padNumber(n: uint64, minLength: uint64): bytes {
  let str: bytes = Bytes('')
  let temp: uint64 = n

  if (temp === Uint64(0)) {
    str = Bytes('0')
  } else {
    while (temp > Uint64(0)) {
      const digit: uint64 = temp % Uint64(10)
      // Explicitly type asciiDigit as bytes and pass explicit uint64 variables to op.extract
      const asciiDigit: bytes = op.extract(Bytes('0123456789'), digit, Uint64(1))
      str = op.concat(asciiDigit, str)
      temp = temp / Uint64(10)
    }
  }

  // Prepend leading zero characters until target length is reached
  while (op.len(str) < minLength) {
    str = op.concat(Bytes('0'), str)
  }

  return str
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

  @abimethod()
  public changeAdmin(newAdmin: Account): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized: Only admin can change admin')
    this.admin.value = newAdmin
  }

  @abimethod()
  public updateWhitelist(newWhitelist: Account[]): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized: Only admin can update whitelist')
    assert(Uint64(newWhitelist.length) <= this.maxSlots.value, 'Whitelist cannot exceed 10 wallets')

    this.whitelistBox('whitelist').value = [...newWhitelist]
  }

  @abimethod()
  public initializeProposal(slot: uint64, proposalId: uint64, duration: uint64): void {
    assert(Txn.sender === this.admin.value, 'Unauthorized: Only admin can initialize proposals')
    assert(slot < this.maxSlots.value, 'Invalid slot index: Must be 0-9')

    // FIX 1: Corrected assertion so re-initializing works when status is inactive (\x00)
    if (this.slots(slot).exists) {
      const data = this.slots(slot).value
      const statusByte = op.substring(data, 0, 1)
      assert(statusByte !== Bytes('\x01'), 'Slot is currently active with another proposal')
    }

    const expiration: uint64 = Global.latestTimestamp + duration

    // FIX 2: Correctly pack all 49 bytes including expiration and initial voteMask (0)
    const payload = op.concat(
      Bytes('\x01'),
      op.concat(
        op.itob(proposalId),
        op.concat(
          op.itob(Uint64(0)), // Yea
          op.concat(
            op.itob(Uint64(0)), // Nay
            op.concat(
              op.itob(Uint64(0)), // Abstain
              op.concat(
                op.itob(expiration), // Expiration timestamp
                op.itob(Uint64(0))   // Vote mask
              )
            )
          )
        )
      )
    )

    this.slots(slot).value = payload
  }

  @abimethod()
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

  @abimethod()
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

    assert(resolution === Uint64(1) || resolution === Uint64(2), 'Invalid resolution: Use 1=Approve, 2=Reject')

    const status = resolution === Uint64(1) ? Bytes('A') : Bytes('R')
    this.finalizeAndClear(slot, proposalId, yea, nay, abstain, Bytes('Resolved by Admin'), status)
  }

  @abimethod()
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

    this.finalizeAndClear(slot, proposalId, yea, nay, abstain, Bytes('Expired resolved'), Bytes('E'))
  }

  @abimethod()
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

  private finalizeAndClear(
    slot: uint64,
    proposalId: uint64,
    yea: uint64,
    nay: uint64,
    abstain: uint64,
    reason: bytes,
    status: bytes
  ): void {
    // FIX 3: ASCII formatting using updated padNumber()
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

    this.slots(slot).delete()
  }
}