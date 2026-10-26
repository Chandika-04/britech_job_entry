import { PartMatchSection } from "@/components/po/PartMatch";
import { focusNextEmpty } from "@/lib/utils";
import type { LineItem, LineItemDraft, PartCandidate, PoDetail } from "@/types/po";

import { poCustomerCode } from "./helpers";

export function LinePartMatch({
  item,
  index,
  line,
  po,
  disabled,
  remountKey,
  onUsePart,
  onBeforeCreatePart,
  onError,
}: {
  item: LineItemDraft;
  index: number;
  line?: LineItem;
  po: PoDetail;
  disabled?: boolean;
  remountKey?: string | number;
  onUsePart: (index: number, part: PartCandidate) => void | Promise<void>;
  onBeforeCreatePart?: () => Promise<boolean>;
  onError?: (message: string) => void;
}) {
  return (
    <PartMatchSection
      key={remountKey ?? line?.id ?? `new-${index}`}
      initialPartNumber={item.customer_part_number}
      initialRevision={item.revision}
      selectedPartNumber={line?.resolved_part_number}
      selectedRevision={line?.resolved_part_revision}
      selectedPmLinkId={line?.resolved_pm_linkid}
      disabled={disabled}
      lineIndex={index}
      lineId={line?.id}
      poId={po.id}
      extractedDescription={item.description}
      customerCode={line?.resolved_customer_code || poCustomerCode(po)}
      onBeforeCreatePart={onBeforeCreatePart}
      onError={onError}
      onUse={(part) => onUsePart(index, part)}
      onAfterUse={() => focusNextEmpty([`qty-line-${index}`, `price-line-${index}`, `due-line-${index}`])}
    />
  );
}
