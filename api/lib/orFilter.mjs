/**
 * PostgREST's `or` filter string, as structured terms.
 *
 * `"email.ilike.%acme%,company.eq.Acme"` becomes two terms. Split on the
 * first two dots only, because a VALUE may contain dots — a domain, a
 * decimal, a version number — and splitting on all of them would quietly
 * truncate it.
 *
 * Nothing here is a security boundary: the server checks every column and
 * operator against the live catalog and binds every value. A term this
 * mis-parses produces a rejected query, not a dangerous one.
 */
export function parseOrFilter(filter) {
  return String(filter)
    .split(",")
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const first = piece.indexOf(".");
      const second = piece.indexOf(".", first + 1);
      if (first < 1 || second < 0) throw new Error(`Malformed or() term: ${piece}`);
      return {
        col: piece.slice(0, first),
        op: piece.slice(first + 1, second),
        value: piece.slice(second + 1),
      };
    });
}
