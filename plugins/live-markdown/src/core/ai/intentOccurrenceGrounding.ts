/** Grounds protocol literal strings without allowing substring matches inside ASCII identifiers. */
export function hasGroundedIntentLiteral(instruction: string, literal: string): boolean {
  if (!literal) return false;
  let from = 0;
  while (from <= instruction.length - literal.length) {
    const index = instruction.indexOf(literal, from);
    if (index < 0) return false;
    const left = instruction[index - 1];
    const right = instruction[index + literal.length];
    const word = (value: string | undefined) => Boolean(value && /[A-Za-z0-9_]/u.test(value));
    if ((!/^[A-Za-z0-9_]/u.test(literal) || !word(left)) && (!/[A-Za-z0-9_]$/u.test(literal) || !word(right))) return true;
    from = index + 1;
  }
  return false;
}
