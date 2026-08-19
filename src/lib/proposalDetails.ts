const STORAGE_KEY = 'voi-council-proposal-details'

type ProposalDetails = Record<string, string>

function readDetails(): ProposalDetails {
  if (typeof window === 'undefined') return {}
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value ? JSON.parse(value) as ProposalDetails : {}
  } catch {
    return {}
  }
}

export function getProposalDetail(proposalId: number): string {
  return readDetails()[String(proposalId)] ?? ''
}

export function saveProposalDetail(proposalId: number, detail: string): void {
  if (typeof window === 'undefined') return
  const details = readDetails()
  const normalized = detail.trim()
  if (normalized) details[String(proposalId)] = normalized
  else delete details[String(proposalId)]
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(details))
}
