LOT = "Lot"
EACH = "Each"


def normalize_unit(value: str | None) -> str:
    """ShopKeeper job units are only Lot or Each."""
    return LOT if value and "lot" in value.strip().lower() else EACH
