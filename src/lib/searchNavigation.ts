export interface SearchJumpRange {
  from: number;
  to: number;
}

export function findSearchJumpRange(content: string, rawQuery: string): SearchJumpRange | null {
  const query = rawQuery.trim();
  if (!query) return null;

  const from = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (from < 0) return null;

  return {
    from,
    to: from + query.length,
  };
}
