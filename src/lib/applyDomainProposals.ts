/** Apply mined proposals onto a domain pack's glossary/pending files. */

import {
  classifyAndMergeProposals,
  loadDomainPack,
  saveGlossary,
  savePending,
  type TermProposal,
} from "./domain";

export function applyProposalsToDomainDir(
  domainDir: string,
  proposals: TermProposal[],
  meta: { lang: string; jobId?: string }
): {
  autoAdded: number;
  bumped: number;
  enqueued: number;
  pendingCount: number;
} {
  const pack = loadDomainPack(domainDir);
  const result = classifyAndMergeProposals(
    pack.terms,
    pack.pending,
    proposals,
    meta
  );
  saveGlossary(domainDir, result.glossary);
  savePending(domainDir, result.pending);
  return {
    autoAdded: result.autoAdded,
    bumped: result.bumped,
    enqueued: result.enqueued,
    pendingCount: result.pending.length,
  };
}
