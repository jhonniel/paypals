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
          Enter items yourself, or scan a photo/PDF. Link it to a group you own when
          you&apos;re ready to split.
          {group ? " This receipt will be shared with your group." : ""}
        </p>
      </div>
      <ReceiptUploader groupId={group ?? null} />
    </div>
  );
}
