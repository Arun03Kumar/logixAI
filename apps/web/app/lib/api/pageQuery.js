/** Query string for paged list endpoints: ?limit=&cursor= plus any filters that are set. */
export const pageQuery = ({ cursor, limit, ...filters }) => {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
  return params.toString();
};
