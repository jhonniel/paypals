/** Which primary nav item is active for the current pathname. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/dashboard" || href === "/receipts/new") return false;
  if (href === "/receipts") {
    return pathname.startsWith("/receipts/") && pathname !== "/receipts/new";
  }
  return pathname.startsWith(`${href}/`);
}
