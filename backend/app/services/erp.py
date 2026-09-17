"""Placeholder ERP boundary for Phase 2. Must not write to ShopKeeper."""


class ERPIntegrationService:
    def create_job(self, *args, **kwargs) -> None:
        raise NotImplementedError(
            "ShopKeeper integration is Phase 2 and is not implemented."
        )


erp_integration_service = ERPIntegrationService()
