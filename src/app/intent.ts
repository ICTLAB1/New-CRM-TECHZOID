/** "Open this record" or "start a new one", handed to a screen from the
 *  header search or the + New menu. `n` changes on every request, so asking
 *  twice for the same thing still acts twice. */
export interface Intent {
  kind: "open" | "new";
  id?: string;
  n: number;
}
