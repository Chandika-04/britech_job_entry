"""Match an extracted PO customer name to a ShopKeeper customer.

Order (first hit wins):
  1. alias      - a name a reviewer confirmed before
  2. exact      - normalized name equals normalized Company or Customer Number
  3. contains   - every word of one side appears in the other, on Company or
                  Customer Number ("MDC Vacuum Technologies" -> "MDC")

The result only decides what to pre-select and show. The reviewer still
confirms the customer before it is stored on the lines.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.services.shopkeeper.types import CustomerRecord

SUFFIXES = {
    "inc",
    "incorporated",
    "llc",
    "ltd",
    "limited",
    "corp",
    "corporation",
    "co",
    "company",
    "the",
    "lp",
    "llp",
    "pc",
    "plc",
}
EXPAND = {
    "mfg": "manufacturing",
    "mfr": "manufacturing",
    "intl": "international",
    "eng": "engineering",
    "engr": "engineering",
    "mach": "machining",
    "tech": "technology",
    "technologies": "technology",
    "assoc": "associates",
    "bros": "brothers",
    "svc": "services",
    "svcs": "services",
}
MAX_CANDIDATES = 10


def normalize(name: str | None) -> str:
    if not name:
        return ""
    s = name.lower().replace("&", " and ").replace("'", "").replace("\u2019", "")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    words = [EXPAND.get(w, w) for w in s.split()]
    return " ".join(w for w in words if w not in SUFFIXES)


@dataclass
class MatchResult:
    status: str
    normalized_name: str
    customer: CustomerRecord | None = None
    candidates: list[CustomerRecord] = field(default_factory=list)
    warning: str | None = None


def _words(value: str) -> set[str]:
    return set(value.split())


def _contains_score(key_words: set[str], customer: CustomerRecord) -> float:
    best = 0.0
    for other in (normalize(customer.company), normalize(customer.customer_number)):
        other_words = _words(other)
        if not other_words:
            continue
        if other_words <= key_words or key_words <= other_words:
            best = max(best, len(key_words & other_words) / len(key_words | other_words))
    return best


def match_customer(
    extracted_name: str | None,
    customers: list[CustomerRecord],
    aliases: dict[str, str],
) -> MatchResult:
    key = normalize(extracted_name)
    if not key:
        return MatchResult("none", key)

    active = [c for c in customers if c.active]
    by_number = {c.customer_number: c for c in customers}
    warning = None

    alias_number = aliases.get(key)
    if alias_number:
        target = by_number.get(alias_number)
        if target is not None and target.active:
            return MatchResult("alias", key, customer=target)
        if target is None:
            warning = f"Saved match {alias_number} no longer exists in ShopKeeper."
        else:
            warning = f"Saved match {alias_number} is inactive in ShopKeeper."

    exact = [c for c in active if key in (normalize(c.company), normalize(c.customer_number))]
    if len(exact) == 1:
        return MatchResult("exact", key, customer=exact[0], warning=warning)
    if len(exact) > 1:
        return MatchResult("ambiguous", key, candidates=exact[:MAX_CANDIDATES], warning=warning)

    key_words = _words(key)
    scored = [(score, c) for c in active if (score := _contains_score(key_words, c)) > 0]
    scored.sort(key=lambda item: (-item[0], item[1].customer_number))
    contains = [c for _, c in scored]
    if len(contains) == 1:
        return MatchResult("contains", key, customer=contains[0], warning=warning)
    if contains:
        return MatchResult("candidates", key, candidates=contains[:MAX_CANDIDATES], warning=warning)
    return MatchResult("none", key, warning=warning)
