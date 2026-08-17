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
          Select one or more photos from the same receipt — multiple files are combined
          into a single receipt with all line items. Choose multiple files only for pages
          of the same bill; use separate uploads for different bills.
          {group ? " All receipts will be shared with your group." : ""}
        </p>
      </div>
      <ReceiptUploader groupId={group ?? null} />
    </div>
  );
}
