import { ReceiptUploader } from "@/features/receipts/receipt-uploader";

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group } = await searchParams;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          New receipt
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Scan one receipt at a time. If you have multiple receipts in one transaction
          — or one long receipt that doesn&apos;t fit in the camera — upload or capture
          each one separately. Each photo is OCR-scanned before you add the next.
          {group ? " All receipts will be shared with your group." : ""}
        </p>
      </div>
      <ReceiptUploader groupId={group ?? null} />
    </div>
  );
}
