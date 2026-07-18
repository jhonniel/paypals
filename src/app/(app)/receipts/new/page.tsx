import { ReceiptUploader } from "@/features/receipts/receipt-uploader";

export default function NewReceiptPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Upload receipt
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Drag & drop, camera, clipboard, or PDF — OCR extracts items automatically.
        </p>
      </div>
      <ReceiptUploader />
    </div>
  );
}
