import { LandingPage } from "@/features/landing/landing-page";
import { OAuthHomeCatch } from "@/features/auth/oauth-home-catch";

export default function HomePage() {
  return (
    <>
      <OAuthHomeCatch />
      <LandingPage />
    </>
  );
}
