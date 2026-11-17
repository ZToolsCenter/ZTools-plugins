export async function runGuardedNavigation(
  canLeave: () => Promise<boolean>,
  transition: () => void | Promise<void>
): Promise<boolean> {
  if (!(await canLeave())) return false;
  await transition();
  return true;
}
