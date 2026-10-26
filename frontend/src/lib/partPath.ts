export function pictureFileName(path: string | null | undefined): string {
  const value = (path || "").trim();
  if (!value) return "";
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || value;
}
