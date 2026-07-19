import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReceiptEditor } from "@/features/receipts/receipt-editor";
import { SplitAssignPanel } from "@/features/splits/split-assign-panel";

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <ReceiptEditor receiptId={id} />
      <SplitAssignPanel receiptId={id} currentUserId={user.id} />
    </div>
  );
}
