import { SettingsForm } from "@/features/settings/settings-form";

export default function SettingsPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Account preferences and notifications.
        </p>
      </div>
      <SettingsForm />
    </div>
  );
}
