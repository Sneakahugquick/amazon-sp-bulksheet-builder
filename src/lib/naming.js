function cleanNamePart(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-_\s]+$/g, "");
}

export function generatedStructureName(keyword) {
  const keywordText = cleanNamePart(keyword.text);
  const matchType = cleanNamePart(keyword.matchType);
  return `${keywordText}-${matchType}`;
}

export function generatedNames(keyword) {
  const structureName = generatedStructureName(keyword);
  return {
    campaignName: structureName.slice(0, 128),
    adGroupName: structureName.slice(0, 255),
  };
}
