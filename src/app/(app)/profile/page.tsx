import { ProfileForm } from "@/features/profile/profile-form";

export default function ProfilePage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Manage your public identity.
        </p>
      </div>
      <ProfileForm />
    </div>
  );
}
