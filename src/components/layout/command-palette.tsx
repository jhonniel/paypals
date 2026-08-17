"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  LayoutDashboard,
  Receipt,
  Users,
  UserPlus,
  HandCoins,
  Settings,
  User,
  Upload,
  BarChart3,
  Shield,
  Search,
} from "lucide-react";
import { cn } from "@/utils/cn";
import type { Profile } from "@/types/database";

const baseNavItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Upload receipt", href: "/receipts/new", icon: Upload },
  { label: "Receipts", href: "/receipts", icon: Receipt },
  { label: "Groups", href: "/groups", icon: Users },
  { label: "Friends", href: "/friends", icon: UserPlus },
  { label: "Pal owes me", href: "/pal-owes-me", icon: HandCoins },
  { label: "Profile", href: "/profile", icon: User },
  { label: "Settings", href: "/settings", icon: Settings },
];

const adminNavItems = [
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Admin", href: "/admin", icon: Shield },
];

type SearchResult = {
  receipts: Array<{ id: string; merchant: string | null }>;
  groups: Array<{ id: string; name: string }>;
  people: Array<{ id: string; full_name: string | null; username: string | null }>;
};

export function CommandPalette({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile?: Profile | null;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult | null>(null);
  const navItems = profile?.is_admin
    ? [...baseNavItems, ...adminNavItems]
    : baseNavItems;

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((json) => {
          if (json?.data) setResults(json.data as SearchResult);
        })
        .catch(() => setResults(null));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  if (!open) return null;

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative mx-auto mt-[max(1rem,env(safe-area-inset-top))] w-full max-w-lg px-3 sm:mt-[15vh] sm:px-4">
        <Command
          className={cn(
            "glass overflow-hidden rounded-2xl shadow-2xl",
            "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
          )}
          shouldFilter={!results}
        >
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search or jump to…"
            className="h-14 w-full border-b border-border bg-transparent px-4 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
          />
          <Command.List className="max-h-[min(60dvh,18rem)] overflow-auto p-2 sm:max-h-72">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
              No results.
            </Command.Empty>
            {results && (
              <>
                {results.receipts.length > 0 && (
                  <Command.Group heading="Receipts">
                    {results.receipts.map((r) => (
                      <Command.Item
                        key={r.id}
                        value={`receipt-${r.id}`}
                        onSelect={() => go(`/receipts/${r.id}`)}
                        className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-sm aria-selected:bg-accent sm:py-2.5"
                      >
                        <Receipt className="h-4 w-4 text-muted-foreground" />
                        {r.merchant || "Untitled receipt"}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {results.groups.length > 0 && (
                  <Command.Group heading="Groups">
                    {results.groups.map((g) => (
                      <Command.Item
                        key={g.id}
                        value={`group-${g.id}`}
                        onSelect={() => go(`/groups/${g.id}`)}
                        className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-sm aria-selected:bg-accent sm:py-2.5"
                      >
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {g.name}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {results.people.length > 0 && (
                  <Command.Group heading="People">
                    {results.people.map((p) => (
                      <Command.Item
                        key={p.id}
                        value={`person-${p.id}`}
                        onSelect={() => go("/friends")}
                        className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-sm aria-selected:bg-accent sm:py-2.5"
                      >
                        <Search className="h-4 w-4 text-muted-foreground" />
                        {p.full_name || p.username || "User"}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </>
            )}
            <Command.Group heading="Navigation">
              {navItems.map((item) => (
                <Command.Item
                  key={item.href}
                  value={item.label}
                  onSelect={() => go(item.href)}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-sm aria-selected:bg-accent sm:py-2.5"
                >
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
