export interface ListEnvelope<T> {
  data: T[];
}

export function wrapList<T>(items: T[]): ListEnvelope<T> {
  return { data: items };
}
