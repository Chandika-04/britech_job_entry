from pydantic import BaseModel, ConfigDict, Field


class MaterialOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    active: bool


class MaterialAddIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class MaterialActiveIn(BaseModel):
    active: bool


class MaterialOrderIn(BaseModel):
    ids: list[int]


class CertTemplateOut(BaseModel):
    id: str
    description: str | None = None
    text: str = ""
    rowversion: str | None = None
    part_count: int = 0


class CertTemplateCreateIn(BaseModel):
    id: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=60)
    text: str = Field(default="", max_length=20000)


class CertTemplateUpdateIn(BaseModel):
    description: str | None = Field(default=None, max_length=60)
    text: str = Field(default="", max_length=20000)
    rowversion: str | None = None
